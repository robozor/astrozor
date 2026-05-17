from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .fetch import fetch_source
from .models import FeedSource

logger = logging.getLogger(__name__)


@shared_task(name="feeds.poll_due_sources")
def poll_due_sources() -> dict:
    """Run on a Celery beat schedule. Fetches sources whose poll interval elapsed."""
    now = timezone.now()
    candidates = FeedSource.objects.all()
    total = {"polled": 0, "items": 0}
    for source in candidates:
        if source.last_fetched_at is None:
            elapsed_ok = True
        else:
            elapsed = (now - source.last_fetched_at).total_seconds()
            elapsed_ok = elapsed >= source.poll_interval_seconds
        if not elapsed_ok:
            continue
        result = fetch_source(source)
        total["polled"] += 1
        total["items"] += result["created"]
    if total["polled"]:
        logger.info("feeds.poll_due_sources: %s", total)
    return total
