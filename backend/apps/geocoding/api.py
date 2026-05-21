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


PHOTON_SUPPORTED_LANGS = {"default", "de", "en", "fr"}


def _photon_search(q: str, limit: int, lang: str) -> list[dict[str, Any]]:
    """Query a self-hosted Photon if the admin switched search to it.

    Note: the rtuszik/photon-docker image (and upstream Komoot Photon)
    only ships language indexes for {default, de, en, fr}. We map any
    other request (cs, sk, pl, …) to 'default' so the query still works —
    "default" matches local names in the local language, which is what
    Czech users actually want anyway.
    """
    from apps.admin_panel.models import MapInfra

    infra = MapInfra.get()
    if infra.search_backend != MapInfra.SearchBackend.PHOTON:
        return []
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    first_lang = (lang or "default").split(",")[0].strip().lower()
    if first_lang not in PHOTON_SUPPORTED_LANGS:
        first_lang = "default"
    params = {"q": q, "limit": str(limit), "lang": first_lang}
    try:
        with httpx.Client(timeout=UPSTREAM_TIMEOUT, headers=headers) as client:
            r = client.get(f"{infra.photon_url.rstrip('/')}/api", params=params)
    except httpx.HTTPError as e:
        log.warning("Photon upstream error: %s", e)
        return []
    if r.status_code != 200:
        log.warning("Photon returned %s for q=%r", r.status_code, q)
        return []
    try:
        data = r.json()
    except json.JSONDecodeError:
        return []
    # Convert Photon GeoJSON FeatureCollection → Nominatim-like shape so
    # the same frontend rendering works for both backends.
    out: list[dict[str, Any]] = []
    for feat in (data or {}).get("features", []):
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        props = feat.get("properties") or {}
        if len(coords) < 2:
            continue
        name_parts = [
            props.get("name") or "",
            props.get("city") or "",
            props.get("country") or "",
        ]
        out.append(
            {
                "place_id": props.get("osm_id") or hash(str(props)) & 0xFFFFFFFF,
                "lat": str(coords[1]),
                "lon": str(coords[0]),
                "display_name": ", ".join(p for p in name_parts if p),
                "type": props.get("type") or "",
            }
        )
    return out


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

    # If admin switched to Photon, bypass Nominatim entirely. Photon is
    # self-hosted so it has no external rate budget; we still cache.
    from apps.admin_panel.models import MapInfra

    backend = MapInfra.get().search_backend

    key = f"{backend}:{_cache_key(q, limit, lang)}"
    cached = cache.get(key)
    if cached is not None:
        return JsonResponse({"items": cached, "cached": True}, status=200)

    if backend == MapInfra.SearchBackend.PHOTON:
        items = _photon_search(q, limit, lang)
        cache.set(key, items, CACHE_TTL_SECONDS)
        return JsonResponse({"items": items, "cached": False}, status=200)

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


# ---- Elevation lookup ----
# Open-Elevation has been flaky (8s+ timeouts on api.open-elevation.com).
# Open-Meteo's elevation endpoint serves the same SRTM-derived data with
# substantially better uptime — they run it on the same infra as their
# weather forecast API. We try them in order: Open-Meteo first (fast,
# reliable), Open-Elevation as a fallback in case Open-Meteo ever 5xx's.
OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"
ELEVATION_CACHE_TTL = 30 * 24 * 3600  # 30 days; bedrock doesn't move
ELEVATION_UPSTREAM_TIMEOUT = 3.0  # tighter than geocoding — UI waits on this


def _try_open_meteo(lat: float, lon: float) -> int | None:
    """Open-Meteo: {"elevation": [251.0]}. Fast, reliable, no auth."""
    try:
        with httpx.Client(
            timeout=ELEVATION_UPSTREAM_TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            r = client.get(
                OPEN_METEO_ELEVATION_URL,
                params={"latitude": lat, "longitude": lon},
            )
        if r.status_code != 200:
            log.warning(
                "open-meteo elevation returned %s for %s,%s",
                r.status_code, lat, lon,
            )
            return None
        data = r.json()
        arr = (data or {}).get("elevation") or []
        if arr and isinstance(arr[0], (int, float)):
            return int(round(arr[0]))
    except (httpx.HTTPError, json.JSONDecodeError, IndexError) as e:
        log.warning("open-meteo elevation error: %s", e)
    return None


def _try_open_elevation(lat: float, lon: float) -> int | None:
    """Open-Elevation: {"results":[{"latitude":..,"longitude":..,"elevation":..}]}.
    Used only as fallback — host frequently unreachable."""
    try:
        with httpx.Client(
            timeout=ELEVATION_UPSTREAM_TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            r = client.get(OPEN_ELEVATION_URL, params={"locations": f"{lat},{lon}"})
        if r.status_code != 200:
            return None
        data = r.json()
        results = (data or {}).get("results") or []
        if results:
            elev = results[0].get("elevation")
            if isinstance(elev, (int, float)):
                return int(round(elev))
    except (httpx.HTTPError, json.JSONDecodeError) as e:
        log.warning("open-elevation fallback error: %s", e)
    return None


@router.get("/geocode/elevation", auth=None)
def elevation(
    request: HttpRequest,  # noqa: ARG001
    lat: float = 0.0,
    lon: float = 0.0,
) -> JsonResponse:
    """Look up terrain elevation for a GPS coord. Tries Open-Meteo first
    (fast, ~90 m SRTM), falls back to Open-Elevation. Cached 30 d per
    3-decimal rounded coord (~110 m bucket)."""
    rkey = f"elev:v1:{round(lat, 3):.3f}:{round(lon, 3):.3f}"
    cached = cache.get(rkey)
    if cached is not None:
        return JsonResponse({"elevation_m": cached, "cached": True}, status=200)

    elev = _try_open_meteo(lat, lon)
    source = "open-meteo"
    if elev is None:
        elev = _try_open_elevation(lat, lon)
        source = "open-elevation"
    if elev is None:
        return JsonResponse(
            {"detail": "All elevation providers unreachable"}, status=502
        )

    cache.set(rkey, elev, ELEVATION_CACHE_TTL)
    return JsonResponse(
        {"elevation_m": elev, "cached": False, "source": source}, status=200
    )
