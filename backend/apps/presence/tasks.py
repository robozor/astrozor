"""Celery cleanup of expired checkins."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .models import Checkin

logger = logging.getLogger(__name__)


@shared_task(name="presence.cleanup_expired_checkins")
def cleanup_expired_checkins() -> dict[str, int]:
    """Mark expired checkins as ended."""
    now = timezone.now()
    count = Checkin.objects.filter(ended_at__isnull=True, expires_at__lte=now).update(ended_at=now)
    if count:
        logger.info("presence.cleanup_expired_checkins: ended %d", count)
    return {"ended": count}
