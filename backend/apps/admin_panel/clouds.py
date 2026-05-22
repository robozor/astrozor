"""Cloud-cover overlay providers + cached aggregator.

Two providers are supported, selected via `MapInfra.clouds_provider`:

  - ``openweathermap``: single tile layer (current cloud cover only).
    Free with API key from openweathermap.org. No animation possible.
  - ``eumetsat``: Meteosat IR satellite from api.eumetsat.int. Supports
    multiple recent frames for a pseudo-animation. Requires OAuth2
    client credentials (Consumer Key + Secret). Best coverage for
    Europe / Africa.

Both providers return the same payload shape so the frontend doesn't
care which one is active:

    {
      "enabled": bool,
      "provider": str,          # "openweathermap" | "eumetsat" | "disabled"
      "frames": [               # 1 frame for OWM, 1..N for EUMETSAT
        { "time": int, "tile_url_template": str }
      ],
      "attribution": str,
      "opacity_default": float,
      "fetched_at": int,
      "cache_ttl_seconds": int,
    }

The frame list is cached in Redis (`CACHE_KEY`) for
``clouds_cache_ttl_seconds`` so we don't hit the upstream per user
request. The cache TTL doubles as the auto-refresh interval — once it
expires the next public read fetches fresh.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from django.core.cache import cache

from .models import MapInfra

log = logging.getLogger(__name__)

CACHE_KEY = "clouds:frames"


# ---- OpenWeatherMap ----------------------------------------------------

OWM_TILE_URL = (
    "https://tile.openweathermap.org/map/clouds_new/{{z}}/{{x}}/{{y}}.png?appid={key}"
)


def _owm_frames(api_key: str) -> list[dict[str, Any]]:
    """OWM doesn't expose a historical layer in the free tier, so we
    return a single frame anchored to "now". The tile URL stays static
    — OWM regenerates the underlying composite roughly every 3 h."""
    if not api_key:
        return []
    return [
        {
            "time": int(time.time()),
            "tile_url_template": OWM_TILE_URL.format(key=api_key),
        }
    ]


# ---- EUMETSAT Meteosat ------------------------------------------------

EUMETSAT_TOKEN_URL = "https://api.eumetsat.int/token"

# OAuth2 bearer cached separately from the frame list because it has a
# different lifetime (~1 hour) than the frame cache TTL.
_EUMETSAT_TOKEN_KEY = "clouds:eumetsat:token"


def _eumetsat_token(consumer_key: str, consumer_secret: str) -> str | None:
    """Fetch (and cache) a bearer token via OAuth2 client credentials.
    Returns None on failure so callers can render an empty frame list."""
    if not consumer_key or not consumer_secret:
        return None
    cached = cache.get(_EUMETSAT_TOKEN_KEY)
    if cached:
        return cached
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                EUMETSAT_TOKEN_URL,
                data={"grant_type": "client_credentials"},
                auth=(consumer_key, consumer_secret),
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        log.warning("EUMETSAT token fetch failed: %s", exc)
        return None
    token = data.get("access_token")
    expires_in = int(data.get("expires_in") or 3600)
    if not token:
        return None
    # Cache slightly shorter than the real TTL so we never use a
    # just-expired token.
    cache.set(_EUMETSAT_TOKEN_KEY, token, timeout=max(60, expires_in - 60))
    return token


def _eumetsat_frames(
    consumer_key: str,
    consumer_secret: str,
    frame_count: int,
) -> list[dict[str, Any]]:
    """Fetch the most recent N Meteosat IR frames.

    STUB — the concrete WMS/WMTS URL pattern depends on which EUMETSAT
    service the admin's credentials are scoped to (Data Store vs. View
    vs. Data Tailor). Once we have a real Consumer Key + Secret we'll
    hit the catalogue endpoint, pick the IR_108 channel for the last N
    timestamps, and build per-frame tile URLs.

    For now this returns an empty list when the credentials are present
    so the frontend can still render the "provider configured, awaiting
    integration" state without crashing.
    """
    token = _eumetsat_token(consumer_key, consumer_secret)
    if not token:
        return []
    # TODO: when credentials are available, swap this stub for the real
    # catalogue → frame-list call. Likely shape:
    #   GET /data/browse/collections/EO:EUM:DAT:MSG:HRSEVIRI/dates
    #     → list of timestamps
    #   For each ts → build tile URL through Data Tailor / View
    log.info("EUMETSAT integration: credentials valid but frame fetcher is a stub")
    _ = frame_count
    return []


# ---- Aggregator -------------------------------------------------------


def _attribution(provider: str) -> str:
    if provider == "openweathermap":
        return "Clouds: © OpenWeatherMap"
    if provider == "eumetsat":
        return "Clouds: © EUMETSAT Meteosat"
    return ""


def get_frames(force_refresh: bool = False) -> dict[str, Any]:
    """Return the public frame payload. Reads cache unless force_refresh
    is set; falls back to whatever is cached when the upstream errors."""
    m = MapInfra.get()
    provider = m.clouds_provider
    base = {
        "enabled": m.clouds_enabled,
        "provider": provider,
        "opacity_default": m.clouds_opacity_default,
        "cache_ttl_seconds": m.clouds_cache_ttl_seconds,
        "attribution": _attribution(provider),
    }
    if not m.clouds_enabled or provider == MapInfra.CloudsProvider.DISABLED:
        return {**base, "frames": [], "fetched_at": 0}

    if not force_refresh:
        cached = cache.get(CACHE_KEY)
        # Guard the cache hit on the active provider — switching providers
        # must invalidate (admin PATCH calls `clear_cache()`, but a stale
        # entry from a different provider would still be wrong).
        if cached is not None and cached.get("provider") == provider:
            return {**base, **cached}

    frames: list[dict[str, Any]] = []
    try:
        if provider == MapInfra.CloudsProvider.OPENWEATHERMAP:
            frames = _owm_frames(m.clouds_openweathermap_api_key)
        elif provider == MapInfra.CloudsProvider.EUMETSAT:
            frames = _eumetsat_frames(
                m.clouds_eumetsat_consumer_key,
                m.clouds_eumetsat_consumer_secret,
                m.clouds_frame_count,
            )
    except Exception as exc:  # noqa: BLE001 — provider modules raise varied types
        log.warning("Clouds provider %s fetch failed: %s", provider, exc)
        cached = cache.get(CACHE_KEY)
        if cached is not None and cached.get("provider") == provider:
            return {**base, **cached}
        return {**base, "frames": [], "fetched_at": 0}

    payload = {
        "frames": frames,
        "fetched_at": int(time.time()),
        "provider": provider,
    }
    cache.set(CACHE_KEY, payload, timeout=m.clouds_cache_ttl_seconds)
    return {**base, **payload}


def clear_cache() -> None:
    """Drop both the frame cache and the EUMETSAT token cache. Called
    by the admin PATCH endpoint when settings change so the next read
    refreshes from upstream with whatever's new."""
    cache.delete(CACHE_KEY)
    cache.delete(_EUMETSAT_TOKEN_KEY)
