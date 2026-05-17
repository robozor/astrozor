"""Geocoding proxy — wraps Nominatim with Redis cache + global rate budget.

Why we proxy instead of letting the browser call Nominatim directly:

- Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
  caps load at ~1 req/s and asks for a meaningful User-Agent. From a browser
  the User-Agent is whatever Chrome sends, and the 1 req/s budget is shared
  across every visitor of the app, which is a recipe for an IP ban.
- Proxying lets us cache (city names rarely move) and shape (token bucket
  with headroom) so we stay well under the limit even with many users.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

import httpx
from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, JsonResponse
from ninja import Router

router = Router(tags=["geocoding"])

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Astrozor/1.0 (+https://github.com/robozor/astrozor; contact: admin@astrozor.cz)"

# How much of Nominatim's budget we permit ourselves to spend.
# Policy is "no more than 1 req/s sustained". We allow 50 requests per
# rolling 60-second window — gives us margin for parallel users + bursts,
# while staying well below 60/min absolute cap. Tune via env if needed.
RL_MAX_REQUESTS = int(getattr(settings, "NOMINATIM_RL_MAX", 50))
RL_WINDOW_SECONDS = int(getattr(settings, "NOMINATIM_RL_WINDOW", 60))

# Cache geocoding results aggressively — place coordinates are very stable.
CACHE_TTL_SECONDS = 30 * 24 * 3600  # 30 days

# Per-call HTTP timeout to Nominatim
UPSTREAM_TIMEOUT = 5.0


def _cache_key(q: str, limit: int, lang: str) -> str:
    h = hashlib.sha256(f"{q.strip().lower()}|{limit}|{lang}".encode("utf-8")).hexdigest()[:16]
    return f"geocode:v1:{h}"


def _bucket_key() -> str:
    """Token bucket bucket key. We use Redis directly through Django's cache
    for atomic INCR; one bucket per integer-second window.
    """
    return f"geocode:rl:{int(time.time()) // RL_WINDOW_SECONDS}"


def _consume_token() -> tuple[bool, int]:
    """Try to consume one token from the current window's bucket.

    Returns (allowed, retry_after_seconds). When the cap is reached, the
    caller should refuse with HTTP 429 + Retry-After header so the
    frontend can back off gracefully.
    """
    key = _bucket_key()
    # add() returns True only if the key didn't exist — we initialize to 1.
    # When it exists, we INCR via the client and check.
    if cache.add(key, 1, timeout=RL_WINDOW_SECONDS + 5):
        return True, 0
    try:
        new_count = cache.incr(key)
    except ValueError:
        # Key expired between add() and incr() — initialize again
        cache.add(key, 1, timeout=RL_WINDOW_SECONDS + 5)
        return True, 0
    if new_count <= RL_MAX_REQUESTS:
        return True, 0
    # Over budget — tell client how long until next window
    seconds_into_window = int(time.time()) % RL_WINDOW_SECONDS
    return False, RL_WINDOW_SECONDS - seconds_into_window


def _fetch_upstream(q: str, limit: int, lang: str) -> list[dict[str, Any]]:
    params = {
        "q": q,
        "format": "json",
        "addressdetails": "0",
        "limit": str(limit),
        "accept-language": lang,
    }
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    try:
        with httpx.Client(timeout=UPSTREAM_TIMEOUT, headers=headers) as client:
            r = client.get(NOMINATIM_URL, params=params)
    except httpx.HTTPError as e:
        log.warning("Nominatim upstream error: %s", e)
        return []
    if r.status_code != 200:
        log.warning(
            "Nominatim returned %s for q=%r: %s", r.status_code, q, r.text[:200]
        )
        return []
    try:
        data = r.json()
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


@router.get("/geocode", auth=None)
def geocode(
    request: HttpRequest,  # noqa: ARG001
    q: str = "",
    limit: int = 6,
    lang: str = "cs,en",
) -> JsonResponse:
    """Search for a place by name. Returns the same shape as Nominatim's
    /search response (subset of fields the frontend uses).

    Rate-limited globally; cached for 30 days per (query, limit, lang) tuple.
    """
    q = (q or "").strip()
    if not q or len(q) < 2:
        return JsonResponse({"items": [], "cached": False}, status=200)
    limit = max(1, min(10, limit))

    key = _cache_key(q, limit, lang)
    cached = cache.get(key)
    if cached is not None:
        return JsonResponse({"items": cached, "cached": True}, status=200)

    allowed, retry_after = _consume_token()
    if not allowed:
        resp = JsonResponse(
            {
                "items": [],
                "cached": False,
                "detail": "Geocoding rate limit reached, try again shortly.",
            },
            status=429,
        )
        resp["Retry-After"] = str(retry_after)
        return resp

    items = _fetch_upstream(q, limit, lang)
    # Cache even empty result so we don't retry the same garbage query
    cache.set(key, items, CACHE_TTL_SECONDS)
    return JsonResponse({"items": items, "cached": False}, status=200)
