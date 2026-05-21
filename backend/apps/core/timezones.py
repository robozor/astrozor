"""Resolve GPS coordinates to an IANA timezone.

Used by Place / Event API responses so the frontend can render a
"Local time" alongside UTC and the user's own timezone.

Backed by `timezonefinder` (~50 MB of polygon data, fully offline).
Lazy-init the lookup object on first call — boot-time cost is ~0,5 s
on a modern CPU but we'd rather not pay it for every Django process
that never needs the lookup."""

from __future__ import annotations

import logging
from functools import lru_cache

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _finder():
    # Import inside the cached factory so the heavy dependency only
    # loads when first needed (and only once per process).
    from timezonefinder import TimezoneFinder

    return TimezoneFinder()


def resolve_timezone(lat: float | None, lon: float | None) -> str:
    """Return IANA timezone name for the given coordinates, or empty
    string when input is missing / outside any known zone. Never raises.

    Examples:
        >>> resolve_timezone(50.087, 14.421)   # Prague
        'Europe/Prague'
        >>> resolve_timezone(None, None)
        ''
    """
    if lat is None or lon is None:
        return ""
    try:
        tz = _finder().timezone_at(lat=float(lat), lng=float(lon))
        return tz or ""
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("timezonefinder failed for (%s, %s): %s", lat, lon, e)
        return ""
