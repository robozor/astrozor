"""Mastodon timeline endpoints.

Read-only views over the authenticated user's home timeline and over
any public hashtag timeline (no auth needed for the latter, but we
still use the user's instance so federation gets us the right view).
"""

from __future__ import annotations

import logging
import re

import httpx
from django.http import HttpRequest
from ninja import Router

from .models import Identity

router = Router(tags=["mastodon"])

log = logging.getLogger(__name__)


def _user_identity(user) -> Identity | None:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    return (
        Identity.objects.filter(user=user, provider="mastodon")
        .exclude(access_token="")
        .exclude(provider_instance="")
        .first()
    )


# Strip HTML in toot content — Mastodon returns HTML-encoded content_html
# that the frontend renders as plain text in the list. Keep <a>/<br>/<p>
# at most; everything else dropped.
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return _HTML_TAG_RE.sub("", s or "").strip()


def _status_out(s: dict) -> dict:
    account = s.get("account") or {}
    media = [
        {
            "url": m.get("url"),
            "preview_url": m.get("preview_url"),
            "type": m.get("type"),
            "description": m.get("description") or "",
        }
        for m in (s.get("media_attachments") or [])
    ]
    # Mastodon's OpenGraph "card" — fetched server-side from the first URL
    # in the toot. Present when the linked page exposes og:title /
    # og:description / og:image. None when the post has no URL, or when
    # the upstream server hasn't fetched the card yet.
    card_raw = s.get("card") or None
    card = (
        {
            "url": card_raw.get("url") or "",
            "title": card_raw.get("title") or "",
            "description": card_raw.get("description") or "",
            "image": card_raw.get("image") or None,
            "provider_name": card_raw.get("provider_name") or "",
            "author_name": card_raw.get("author_name") or "",
            "type": card_raw.get("type") or "link",
        }
        if card_raw
        else None
    )
    return {
        "id": s.get("id"),
        "url": s.get("url"),
        "created_at": s.get("created_at"),
        "content_text": _strip_html(s.get("content") or ""),
        "content_html": s.get("content") or "",
        "spoiler_text": s.get("spoiler_text") or "",
        "reblogs_count": s.get("reblogs_count", 0),
        "favourites_count": s.get("favourites_count", 0),
        "replies_count": s.get("replies_count", 0),
        "tags": [t.get("name") for t in (s.get("tags") or [])],
        "media": media,
        "card": card,
        "account": {
            "acct": account.get("acct"),
            "display_name": account.get("display_name"),
            "avatar": account.get("avatar"),
            "url": account.get("url"),
        },
    }


@router.get("/mastodon/timeline", response={200: dict, 400: dict, 401: dict})
def get_timeline(
    request: HttpRequest,
    kind: str = "home",
    tag: str = "",
    limit: int = 20,
):
    """Fetch a Mastodon timeline.

    kind=home   → user's authenticated home timeline (requires connected identity)
    kind=hashtag → public hashtag timeline on the user's instance (tag required)
    kind=public  → public local timeline of the user's instance
    """
    identity = _user_identity(request.user)
    if not identity:
        return 401, {
            "detail": "Mastodon not connected. Go to Settings → Connected accounts."
        }
    base = identity.provider_instance.rstrip("/")
    limit = max(1, min(40, limit))

    if kind == "home":
        url = f"{base}/api/v1/timelines/home"
        params = {"limit": str(limit)}
        headers = {"Authorization": f"Bearer {identity.access_token}"}
    elif kind == "hashtag":
        if not tag:
            return 400, {"detail": "tag is required for kind=hashtag"}
        url = f"{base}/api/v1/timelines/tag/{tag.lstrip('#')}"
        params = {"limit": str(limit)}
        headers = {"Authorization": f"Bearer {identity.access_token}"}
    elif kind == "public":
        url = f"{base}/api/v1/timelines/public"
        params = {"limit": str(limit), "local": "true"}
        headers = {}
    else:
        return 400, {"detail": f"Unknown kind: {kind}"}

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(url, headers=headers, params=params)
    except httpx.HTTPError as e:
        log.warning("Mastodon timeline fetch failed: %s", e)
        return 200, {"items": [], "detail": "Upstream error"}
    if r.status_code != 200:
        return 200, {
            "items": [],
            "detail": f"HTTP {r.status_code}: {r.text[:200]}",
        }
    try:
        raw = r.json()
    except Exception:
        return 200, {"items": []}
    items = [_status_out(s) for s in raw if isinstance(s, dict)]
    return 200, {
        "items": items,
        "instance": base,
    }
