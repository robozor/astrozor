"""Shared sanitizers for chat messages.

Both the place-scoped chat (``apps.chat.api``) and the sprint-scoped
chat (``apps.citizen.api``) flow user input through the same set of
helpers — HTML scrubbing, attachment URL allowlisting, YouTube auto-
linking, and the ``zoo_subject`` attachment validator that powers the
Zooniverse-subject preview cards inside sprint discussions.

The functions are pure: they take the untrusted payload and return
the cleaned shape, suitable for storing on ``Message.text`` /
``Message.attachments`` without further processing.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from urllib.parse import parse_qs, urlparse

import bleach
from django.conf import settings

# ---------------------------------------------------------------------------
# HTML allowlist
# ---------------------------------------------------------------------------


ALLOWED_TAGS = [
    "b", "strong",
    "i", "em",
    "u",
    "s", "strike", "del",
    "code",
    "p", "br",
    "ul", "ol", "li",
    "a",
    "img",
]
ALLOWED_ATTRS: dict[str, list[str]] = {
    "a": ["href", "title", "rel", "target"],
    "img": ["src", "alt", "title", "width", "height", "style"],
}
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


# ---------------------------------------------------------------------------
# Attachment host allowlists
# ---------------------------------------------------------------------------


def _internal_media_prefix() -> str:
    return (getattr(settings, "MEDIA_URL", "/media/") or "/media/").rstrip("/") + "/"


_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}

# Hosts allowed for ``kind=zoo_subject`` attachment locations. Panoptes
# subject media lives on panoptes-uploads (S3 CDN); some older subjects
# point at static.zooniverse.org or *.amazonaws panoptes bucket. The
# deep-link URLs (classify_url, talk_url) live on www.zooniverse.org.
_ZOO_SUBJECT_MEDIA_HOSTS = {
    "panoptes-uploads.zooniverse.org",
    "static.zooniverse.org",
}
_ZOO_DEEPLINK_HOSTS = {"www.zooniverse.org", "zooniverse.org"}


def _is_safe_url(url: str, allowed_hosts: set[str]) -> bool:
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower()
    return host in allowed_hosts


def _img_attr_filter(tag: str, name: str, value: str) -> bool:
    """Bleach attribute callback locking ``<img>`` to our own MEDIA_URL
    and restricting the inline ``style`` attribute to a single
    ``width:`` declaration (so users can resize but not inject CSS).
    """
    if tag != "img":
        return name in ALLOWED_ATTRS.get(tag, [])
    if name == "src":
        return value.startswith(_internal_media_prefix())
    if name == "style":
        v = value.strip().rstrip(";").lower()
        return bool(re.fullmatch(r"width:\s*\d+(?:\.\d+)?(?:px|%)", v))
    if name in ("alt", "title", "width", "height"):
        return True
    return False


# ---------------------------------------------------------------------------
# Text sanitiser
# ---------------------------------------------------------------------------


def _chat_max_length() -> int:
    """Read the admin-configured per-message length limit. Falls back to
    5000 if MapInfra is unreachable (e.g. early test setup)."""
    try:
        from apps.admin_panel.models import MapInfra

        return MapInfra.get().chat_text_max_length or 5000
    except Exception:
        return 5000


def safe_text(text: str) -> str:
    """Sanitize chat HTML against the allowlist and truncate to the
    admin-configured per-message length. ``<img>`` src must be on our
    own MEDIA_URL; ``style`` must be a single width declaration."""
    attrs = {**ALLOWED_ATTRS, "img": _img_attr_filter}
    cleaned = bleach.clean(
        text,
        tags=ALLOWED_TAGS,
        attributes=attrs,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    return cleaned[: _chat_max_length()]


# ---------------------------------------------------------------------------
# YouTube helpers
# ---------------------------------------------------------------------------


def extract_youtube_id(url: str) -> str:
    """Best-effort extract video_id from common YouTube URL shapes.

    Recognized:
      - https://www.youtube.com/watch?v=ID
      - https://youtu.be/ID
      - https://www.youtube.com/embed/ID
      - https://www.youtube.com/shorts/ID
    """
    try:
        u = urlparse(url)
    except Exception:
        return ""
    host = (u.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return ""
    if host == "youtu.be":
        return u.path.lstrip("/").split("/")[0][:32]
    if u.path == "/watch":
        v = parse_qs(u.query).get("v", [""])[0]
        return v[:32]
    parts = [p for p in u.path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("embed", "shorts", "v"):
        return parts[1][:32]
    return ""


_YT_URL_RE = re.compile(
    r"https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|embed/|shorts/|v/)|youtu\.be/)[A-Za-z0-9_\-]{6,32}\S*",
    re.IGNORECASE,
)


def auto_youtube_attachments(text: str) -> list[dict]:
    """Find bare YouTube URLs in body text, convert each unique video
    to an attachment envelope. Used so the client renders an embed
    even when the user just pasted a link."""
    seen: set[str] = set()
    out: list[dict] = []
    for m in _YT_URL_RE.finditer(text):
        url = m.group(0)
        vid = extract_youtube_id(url)
        if not vid or vid in seen:
            continue
        seen.add(vid)
        out.append(
            {
                "kind": "youtube",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "video_id": vid,
                "title": "",
                "mime": "",
            }
        )
    return out


# ---------------------------------------------------------------------------
# Attachment sanitiser
# ---------------------------------------------------------------------------


def _clean_zoo_subject(a) -> dict | None:
    """Validate a ``kind=zoo_subject`` attachment envelope.

    The envelope is produced by the subject resolver endpoint and
    fed back to POST verbatim. We re-validate every field here so a
    crafted POST can't smuggle in arbitrary URLs (defence-in-depth —
    the resolver already validates against Panoptes, but we don't
    trust the round-trip).

    Returns the normalised envelope or ``None`` to drop the
    attachment.
    """
    try:
        subject_id = (str(getattr(a, "subject_id", "") or "")).strip()[:24]
        project_zid = int(getattr(a, "project_zid", 0) or 0)
    except (TypeError, ValueError):
        return None
    if not subject_id.isdigit() or not project_zid:
        return None

    # New shape: ``media: [{url, mime}]`` — preserves MIME so the
    # renderer can pick ``<video>`` / ``<audio>`` / ``<img>``.
    # Legacy shape (older stored attachments): ``locations: [url, ...]``
    # without MIME — we still accept and re-emit as MIME-less media.
    media: list[dict] = []
    raw_media = getattr(a, "media", None) or []
    for item in raw_media:
        if isinstance(item, dict):
            url = item.get("url") or ""
            mime = (item.get("mime") or "")
        else:
            url = getattr(item, "url", "") or ""
            mime = getattr(item, "mime", "") or ""
        if isinstance(url, str) and _is_safe_url(url, _ZOO_SUBJECT_MEDIA_HOSTS):
            media.append({"url": url[:500], "mime": str(mime)[:80]})
        if len(media) >= 8:
            break
    if not media:
        raw_locations = getattr(a, "locations", None) or []
        for u in raw_locations:
            if isinstance(u, str) and _is_safe_url(u, _ZOO_SUBJECT_MEDIA_HOSTS):
                media.append({"url": u[:500], "mime": ""})
            if len(media) >= 8:
                break
    if not media:
        return None
    locations = [m["url"] for m in media]

    classify_url = (getattr(a, "classify_url", "") or "").strip()
    if classify_url and not _is_safe_url(classify_url, _ZOO_DEEPLINK_HOSTS):
        classify_url = ""
    talk_url = (getattr(a, "talk_url", "") or "").strip()
    if talk_url and not _is_safe_url(talk_url, _ZOO_DEEPLINK_HOSTS):
        talk_url = ""

    return {
        "kind": "zoo_subject",
        "subject_id": subject_id,
        "project_zid": project_zid,
        "media": media,
        "locations": locations,
        # ``url`` mirrors locations[0] so existing UI that reads
        # attachment.url for a thumbnail keeps working without a
        # zoo_subject branch.
        "url": locations[0],
        "classify_url": classify_url[:500],
        "talk_url": talk_url[:500],
        "title": (getattr(a, "title", "") or "")[:200],
        "mime": "",
        "video_id": "",
    }


def sanitize_attachments(items: Iterable) -> list[dict]:
    """Validate each attachment envelope. Drops anything that doesn't
    meet the per-kind rules:

      * ``image`` / ``video`` — URL must start with internal MEDIA_URL.
      * ``youtube`` — video_id is parsed from URL if missing.
      * ``zoo_subject`` — see ``_clean_zoo_subject`` (Zooniverse
        sprint chat only).

    Caps the result at 8 attachments per message (keeps render cheap).
    """
    internal_prefix = _internal_media_prefix()
    out: list[dict] = []
    for a in items:
        kind = getattr(a, "kind", "")
        url = (getattr(a, "url", "") or "").strip()

        if kind == "youtube":
            vid = getattr(a, "video_id", "") or extract_youtube_id(url)
            if not vid:
                continue
            out.append(
                {
                    "kind": "youtube",
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "video_id": vid,
                    "title": (getattr(a, "title", "") or "")[:200],
                    "mime": "",
                }
            )
            continue

        if kind in ("image", "video"):
            if not url or not url.startswith(internal_prefix):
                continue
            out.append(
                {
                    "kind": kind,
                    "url": url,
                    "mime": (getattr(a, "mime", "") or "")[:80],
                    "title": (getattr(a, "title", "") or "")[:200],
                    "video_id": "",
                }
            )
            continue

        if kind == "zoo_subject":
            cleaned = _clean_zoo_subject(a)
            if cleaned is not None:
                out.append(cleaned)
            continue

        # Unknown kind → silently drop.
    return out[:8]


# ---------------------------------------------------------------------------
# Output marshalling
# ---------------------------------------------------------------------------


def message_out(
    m,
    *,
    place_slug: str = "",
    sprint_slug: str = "",
    repo_id: str = "",
    issue_number: int | None = None,
) -> dict:
    """Marshal a Message to the wire shape. Caller passes whichever
    scope fields are relevant — the others stay empty so the frontend
    can disambiguate without looking up FKs.
    """
    if issue_number is None and m.issue_number is not None:
        issue_number = m.issue_number
    if not repo_id and m.gh_repo_id is not None:
        repo_id = str(m.gh_repo_id)
    return {
        "id": m.id,
        "place_slug": place_slug or (m.place.slug if m.place_id else ""),
        "sprint_slug": sprint_slug or (m.sprint.slug if m.sprint_id else ""),
        "repo_id": repo_id,
        "issue_number": issue_number,
        "parent_id": m.parent_id,
        "user_display_name": (
            m.user.profile.display_name or m.user.email.split("@")[0]
            if hasattr(m.user, "profile")
            else m.user.email.split("@")[0]
        ),
        "user_email": m.user.email,
        "text": m.text,
        "attachments": m.attachments or [],
        "created_at": m.created_at,
        "edited_at": m.edited_at,
    }
