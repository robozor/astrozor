"""Celery tasks for the places app."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .models import Place

logger = logging.getLogger(__name__)


@shared_task(name="places.cleanup_expired_temporary")
def cleanup_expired_temporary() -> dict[str, int]:
    """Archive temporary places whose valid_to has passed.

    Keeps the row (audit), only flips status. Hard-delete after 7 days is a
    follow-up task if needed.
    """
    now = timezone.now()
    qs = Place.objects.filter(
        kind=Place.Kind.SPOT_TEMPORARY,
        status=Place.Status.PUBLISHED,
        valid_to__lte=now,
    )
    count = qs.update(status=Place.Status.ARCHIVED)
    if count:
        logger.info("places.cleanup_expired_temporary: archived %d temporary places", count)
    return {"archived": count}
