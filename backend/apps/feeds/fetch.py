"""RSS / Atom fetching via feedparser; Mastodon hashtag via REST."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone as dt_timezone

import feedparser
import httpx
from django.utils import timezone

from .models import FeedItem, FeedSource

logger = logging.getLogger(__name__)

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _to_datetime(struct_time) -> datetime | None:
    if not struct_time:
        return None
    try:
        return datetime(*struct_time[:6], tzinfo=dt_timezone.utc)
    except Exception:
        return None


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def fetch_mastodon_hashtag(source: FeedSource) -> dict:
    """Fetch the latest 40 statuses for a Mastodon public hashtag timeline.

    `source.url` is expected as `https://<instance>/tags/<tag>` (the
    user-facing URL — what someone pastes from their browser). We
    transform that into the API endpoint
    `https://<instance>/api/v1/timelines/tag/<tag>`.
    """
    m = re.match(r"^https?://([^/]+)/tags/([^/?#]+)", source.url)
    if not m:
        source.last_status = "bad_url"
        source.last_error = (
            "Expected URL like https://<instance>/tags/<tag>"
        )[:500]
        source.last_fetched_at = timezone.now()
        source.save()
        return {"created": 0, "updated": 0, "status": "bad_url"}
    instance, tag = m.group(1), m.group(2)
    api = f"https://{instance}/api/v1/timelines/tag/{tag}"

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(api, params={"limit": "40"})
    except httpx.HTTPError as e:
        source.last_status = "error"
        source.last_error = str(e)[:500]
        source.last_fetched_at = timezone.now()
        source.save()
        return {"created": 0, "updated": 0, "status": "error"}

    if r.status_code != 200:
        source.last_status = f"http_{r.status_code}"
        source.last_error = r.text[:500]
        source.last_fetched_at = timezone.now()
        source.save()
        return {"created": 0, "updated": 0, "status": f"http_{r.status_code}"}

    try:
        statuses = r.json()
    except Exception:
        statuses = []

    created = 0
    updated = 0
    for s in statuses:
        if not isinstance(s, dict):
            continue
        guid = str(s.get("uri") or s.get("url") or s.get("id") or "")[:400]
        if not guid:
            continue
        account = s.get("account") or {}
        display = account.get("display_name") or account.get("acct") or "@unknown"
        title = f"{display} on #{tag}"[:400]
        defaults = {
            "title": title,
            "link": (s.get("url") or source.url)[:600],
            "summary": _HTML_TAG_RE.sub("", s.get("content") or "").strip()[:4000],
            "published_at": _parse_iso(s.get("created_at")),
        }
        _, was_created = FeedItem.objects.update_or_create(
            source=source, guid=guid, defaults=defaults
        )
        if was_created:
            created += 1
        else:
            updated += 1

    source.last_status = "ok"
    source.last_error = ""
    source.last_fetched_at = timezone.now()
    source.save()

    logger.info(
        "feeds.fetch_mastodon_hashtag(%s): %d new, %d updated",
        source.url,
        created,
        updated,
    )
    return {"created": created, "updated": updated, "status": "ok"}


def fetch_source(source: FeedSource) -> dict:
    """Synchronous fetch of a single FeedSource.

    Dispatches by `source.kind`:
      - rss (default): feedparser
      - mastodon_hashtag: Mastodon REST `/api/v1/timelines/tag/<tag>`

    Returns {created, updated, status}.
    """
    if source.kind == FeedSource.Kind.MASTODON_HASHTAG:
        return fetch_mastodon_hashtag(source)
    try:
        parsed = feedparser.parse(source.url)
    except Exception as e:  # pragma: no cover
        source.last_status = "error"
        source.last_error = str(e)[:500]
        source.last_fetched_at = timezone.now()
        source.save()
        return {"created": 0, "updated": 0, "status": "error"}

    if parsed.bozo and not parsed.entries:
        source.last_status = "parse_error"
        source.last_error = str(parsed.bozo_exception)[:500]
        source.last_fetched_at = timezone.now()
        source.save()
        return {"created": 0, "updated": 0, "status": "parse_error"}

    created = 0
    updated = 0
    for entry in parsed.entries[:50]:
        guid = (
            entry.get("id")
            or entry.get("guid")
            or entry.get("link")
            or entry.get("title")
            or ""
        )[:400]
        if not guid:
            continue

        defaults = {
            "title": (entry.get("title") or "(no title)")[:400],
            "link": (entry.get("link") or source.url)[:600],
            "summary": entry.get("summary", "")[:4000],
            "published_at": _to_datetime(entry.get("published_parsed")) or _to_datetime(entry.get("updated_parsed")),
        }
        obj, was_created = FeedItem.objects.update_or_create(
            source=source, guid=guid, defaults=defaults
        )
        if was_created:
            created += 1
        else:
            updated += 1

    source.last_status = "ok"
    source.last_error = ""
    source.last_fetched_at = timezone.now()
    source.save()

    logger.info("feeds.fetch_source(%s): %d new, %d updated", source.url, created, updated)
    return {"created": created, "updated": updated, "status": "ok"}
