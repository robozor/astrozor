"""Celery cleanup + automatic-schedule presence ticks."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

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


# ---- Auto-checkin from opening_hours_schedule ----

_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# Astrozor is CZ-focused; opening hours in the schedule are interpreted
# in Prague local time (the operator who entered them was thinking in
# their wall clock).
_LOCAL_TZ = ZoneInfo("Europe/Prague")


def _parse_hhmm(s: str) -> time | None:
    try:
        h, m = s.strip().split(":")
        return time(int(h), int(m))
    except (ValueError, AttributeError):
        return None


def _current_interval_end(schedule: dict, now_local: datetime) -> datetime | None:
    """Return the datetime (in tz-aware UTC) of the END of the currently
    open interval today, or None if the place isn't open right now or
    auto_checkin is off for today."""
    day_key = _DAY_KEYS[now_local.weekday()]
    day_cfg = (schedule or {}).get(day_key) or {}
    if not day_cfg.get("auto_checkin"):
        return None
    intervals = day_cfg.get("intervals") or []
    now_t = now_local.time()
    for iv in intervals:
        # Each interval is either [start, end] (list) or {start, end} (dict)
        if isinstance(iv, dict):
            start_s = iv.get("start")
            end_s = iv.get("end")
        elif isinstance(iv, (list, tuple)) and len(iv) >= 2:
            start_s, end_s = iv[0], iv[1]
        else:
            continue
        start = _parse_hhmm(start_s or "")
        end = _parse_hhmm(end_s or "")
        if not start or not end or end <= start:
            continue
        if start <= now_t < end:
            interval_end_local = now_local.replace(
                hour=end.hour, minute=end.minute, second=0, microsecond=0
            )
            return interval_end_local.astimezone(ZoneInfo("UTC"))
    return None


@shared_task(name="presence.tick_auto_checkins")
def tick_auto_checkins() -> dict[str, int]:
    """For each Place with auto_checkin enabled for today's weekday +
    currently inside one of its intervals, ensure a single anonymous
    auto-source check-in exists (creating or extending expires_at to
    the end of the current interval). When the interval ends, the
    check-in expires naturally — no active end-of-day cleanup needed.

    Idempotent: re-running within the same interval just refreshes
    expires_at, no duplicate rows.
    """
    # Lazy import to avoid early Django-app loading on worker boot
    from apps.places.models import Place

    now_utc = timezone.now()
    now_local = now_utc.astimezone(_LOCAL_TZ)

    qs = (
        Place.objects.filter(status=Place.Status.PUBLISHED)
        .exclude(opening_hours_schedule={})
        .only("id", "opening_hours_schedule")
    )
    created = 0
    refreshed = 0
    for place in qs.iterator():
        interval_end = _current_interval_end(place.opening_hours_schedule, now_local)
        if interval_end is None:
            continue
        # Look for an existing live auto-checkin for this place.
        existing = (
            Checkin.objects.filter(
                place_id=place.id,
                source=Checkin.Source.AUTO_SCHEDULE,
                ended_at__isnull=True,
            )
            .order_by("-expires_at")
            .first()
        )
        if existing is None:
            Checkin.objects.create(
                place_id=place.id,
                user=None,
                anonymous=True,
                comment="",
                source=Checkin.Source.AUTO_SCHEDULE,
                expires_at=interval_end + timedelta(minutes=2),
            )
            created += 1
        else:
            new_exp = interval_end + timedelta(minutes=2)
            if abs((existing.expires_at - new_exp).total_seconds()) > 30:
                existing.expires_at = new_exp
                existing.save(update_fields=["expires_at"])
                refreshed += 1
    if created or refreshed:
        logger.info(
            "presence.tick_auto_checkins: created=%d refreshed=%d", created, refreshed
        )
    return {"created": created, "refreshed": refreshed}
