"""RSS / Atom fetching via feedparser."""

from __future__ import annotations

import logging
from datetime import datetime, timezone as dt_timezone

import feedparser
from django.utils import timezone

from .models import FeedItem, FeedSource

logger = logging.getLogger(__name__)


def _to_datetime(struct_time) -> datetime | None:
    if not struct_time:
        return None
    try:
        return datetime(*struct_time[:6], tzinfo=dt_timezone.utc)
    except Exception:
        return None


def fetch_source(source: FeedSource) -> dict:
    """Synchronous fetch of a single FeedSource.

    Returns {created, updated, status}.
    """
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
