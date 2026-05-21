"""Estimate a Bortle dark-sky class for a GPS coordinate using public
NASA GIBS Black Marble VIIRS DNB nightlights tiles.

We don't ship a multi-GB GeoTIFF — instead we fetch a single 256×256 PNG
tile at zoom 8 (~600 m / pixel), sample one pixel, and map its brightness
to a Bortle class via an empirical luminance curve.

The mapping is approximate. Black Marble pixels encode log-radiance with
some image processing applied; absolute mcd/m² are not recoverable. The
result is good enough for "is this site rural-dark or city-bright?" and
for seeding bortle_class on places that don't have a human-curated value
yet, but it should be reviewable.

Tile responses are cached in Redis for 30 days (per integer tile coord).
The per-coordinate estimate is also cached separately (rounded to 3 dp =
~110 m granularity) so neighbouring places hit the cache.
"""

from __future__ import annotations

import io
import logging
import math
from typing import NamedTuple

import httpx
from django.core.cache import cache
from PIL import Image

log = logging.getLogger(__name__)

# Latest annual Black Marble composite that GIBS exposes as a static date.
# 2016-01-01 is the canonical "VIIRS_Black_Marble" identifier. If NASA
# publishes a newer annual composite they'll update under the same path.
GIBS_BLACK_MARBLE_URL = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "VIIRS_Black_Marble/default/2016-01-01/"
    "GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"
)
GIBS_DNB_URL_TEMPLATE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/{date}/"
    "GoogleMapsCompatible_Level8/{{z}}/{{y}}/{{x}}.png"
)
# Backwards-compat alias used by external callers that import GIBS_TILE_URL
GIBS_TILE_URL = GIBS_BLACK_MARBLE_URL
SAMPLE_ZOOM = 8  # 256-tile world; ~600 m per pixel at the equator
TILE_PIXELS = 256
TILE_CACHE_TTL = 60 * 24 * 3600  # 60 days
ESTIMATE_CACHE_TTL = 60 * 24 * 3600


class BortleEstimate(NamedTuple):
    bortle_class: float
    luminance: float  # 0..255 perceptual brightness sampled from the tile
    source: str  # one of: viirs_black_marble | viirs_dnb_latest


def _active_lp_config() -> tuple[str, str]:
    """Resolve the URL template + measurement source label for the LP
    map source currently selected by the admin. Returns (url_template,
    source_label). Falls back to Black Marble when DNB date isn't set.
    """
    try:
        from apps.admin_panel.models import MapInfra

        infra = MapInfra.get()
    except Exception:
        return GIBS_BLACK_MARBLE_URL, "viirs_black_marble"
    is_dnb = (
        infra.light_pollution_source == MapInfra.LightPollutionSource.VIIRS_DNB_LATEST
        and bool(infra.light_pollution_dnb_date)
    )
    if is_dnb:
        return (
            GIBS_DNB_URL_TEMPLATE.format(date=infra.light_pollution_dnb_date),
            "viirs_dnb_latest",
        )
    return GIBS_BLACK_MARBLE_URL, "viirs_black_marble"


def _lonlat_to_tile_pixel(lat: float, lon: float, zoom: int) -> tuple[int, int, int, int]:
    """Return (tile_x, tile_y, px_x, px_y) for a slippy-map tile of size
    TILE_PIXELS. lat/lon are clamped to the valid Web Mercator range."""
    lat = max(-85.05112878, min(85.05112878, lat))
    lon = ((lon + 180.0) % 360.0) - 180.0
    n = 2.0**zoom
    x_world = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y_world = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    tile_x = int(math.floor(x_world))
    tile_y = int(math.floor(y_world))
    px_x = int((x_world - tile_x) * TILE_PIXELS)
    px_y = int((y_world - tile_y) * TILE_PIXELS)
    # Clamp to tile bounds (floating point edge cases)
    px_x = max(0, min(TILE_PIXELS - 1, px_x))
    px_y = max(0, min(TILE_PIXELS - 1, px_y))
    return tile_x, tile_y, px_x, px_y


def _fetch_tile_bytes(z: int, x: int, y: int, url_template: str, label: str) -> bytes | None:
    """Fetch a single tile from GIBS, cached for TILE_CACHE_TTL.
    The cache key embeds the source label so Black Marble and DNB tiles
    don't collide at the same (z,x,y)."""
    cache_key = f"lp:tile:{label}:{z}:{x}:{y}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    url = url_template.format(z=z, x=x, y=y)
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0)) as client:
            r = client.get(url)
        if r.status_code != 200:
            log.warning("GIBS tile %s/%s/%s returned HTTP %s", z, x, y, r.status_code)
            return None
        cache.set(cache_key, r.content, TILE_CACHE_TTL)
        return r.content
    except httpx.HTTPError as e:
        log.warning("GIBS tile fetch failed: %s", e)
        return None


def _luminance_to_bortle(lum: float) -> float:
    """Map sampled perceptual luminance (0..255) of a Black Marble pixel to
    an approximate Bortle class (1..9, float).

    Black Marble pixels are dark on rural land/ocean and bright on cities.
    The relationship between RGB brightness and Bortle is non-linear; the
    curve below is calibrated empirically against known sites in Czechia
    (Prague=8.5, Brno=7, Beskydy=3, Šumava village=4, Sahara=1).

    Returns a float so callers can show "Bortle 4.5" for borderline pixels.
    """
    if lum <= 5:
        # Effectively zero radiance — deep rural or ocean.
        return 1.0
    if lum <= 12:
        return 1.5
    if lum <= 25:
        return 2.0
    if lum <= 45:
        return 3.0
    if lum <= 70:
        return 4.0
    if lum <= 100:
        return 5.0
    if lum <= 140:
        return 6.0
    if lum <= 180:
        return 7.0
    if lum <= 220:
        return 8.0
    return 9.0


def estimate_bortle(lat: float, lon: float) -> BortleEstimate | None:
    """Estimate Bortle class for the given coord using the currently
    active LP map source (Black Marble or VIIRS DNB latest, chosen by
    the admin). Result is cached for ESTIMATE_CACHE_TTL per ~110 m cell
    per source.
    """
    url_template, label = _active_lp_config()
    coord_key = f"lp:est:{label}:{round(lat, 3):.3f}:{round(lon, 3):.3f}"
    cached = cache.get(coord_key)
    if cached:
        b, lum = cached
        return BortleEstimate(bortle_class=b, luminance=lum, source=label)

    tile_x, tile_y, px_x, px_y = _lonlat_to_tile_pixel(lat, lon, SAMPLE_ZOOM)
    blob = _fetch_tile_bytes(SAMPLE_ZOOM, tile_x, tile_y, url_template, label)
    if blob is None:
        return None

    try:
        img = Image.open(io.BytesIO(blob)).convert("RGB")
        r, g, b_pix = img.getpixel((px_x, px_y))  # type: ignore[misc]
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to decode GIBS tile pixel: %s", e)
        return None

    # ITU-R BT.601 luma — matches how humans see Black Marble's
    # yellow/white nightlights compared to black ocean.
    lum = 0.299 * r + 0.587 * g + 0.114 * b_pix
    bortle = _luminance_to_bortle(lum)
    cache.set(coord_key, (bortle, lum), ESTIMATE_CACHE_TTL)
    return BortleEstimate(bortle_class=bortle, luminance=lum, source=label)
