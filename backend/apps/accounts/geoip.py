"""IP → location resolver.

Uses ip-api.com's free tier (~45 req/min unlimited /month, no API key
needed). Results are cached 24 h per IP in Redis to keep us well under
the rate limit even at hundreds of daily logins, and to make repeated
logins from the same IP free.

Replaceable with a self-hosted MaxMind GeoLite2 database later — the
public function signature `resolve(ip) -> GeoInfo | None` stays the same.
"""

from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass

import httpx
from django.core.cache import cache

log = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 24 * 3600
UPSTREAM_TIMEOUT = 3.0
PROVIDER_URL = "http://ip-api.com/json/{ip}"
# Fields ip-api.com returns by default that we actually need
DEFAULT_FIELDS = "status,country,countryCode,city"


@dataclass
class GeoInfo:
    country: str = ""
    country_code: str = ""
    city: str = ""


def _is_public(ip: str) -> bool:
    """Skip lookup for loopback / RFC1918 / link-local — they always fail
    upstream and waste a request slot."""
    try:
        obj = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        obj.is_private
        or obj.is_loopback
        or obj.is_link_local
        or obj.is_multicast
        or obj.is_unspecified
    )


def resolve(ip: str) -> GeoInfo | None:
    """Return GeoInfo for `ip`, or None if upstream fails / private IP."""
    if not ip or not _is_public(ip):
        return None
    key = f"geoip:v1:{ip}"
    cached = cache.get(key)
    if cached is not None:
        if not cached:
            return None
        return GeoInfo(**cached)

    try:
        with httpx.Client(timeout=UPSTREAM_TIMEOUT) as client:
            r = client.get(
                PROVIDER_URL.format(ip=ip), params={"fields": DEFAULT_FIELDS}
            )
    except httpx.HTTPError as e:
        log.warning("geoip upstream failed for %s: %s", ip, e)
        cache.set(key, {}, 300)  # short negative cache so we don't hammer on outage
        return None
    if r.status_code != 200:
        cache.set(key, {}, 600)
        return None
    try:
        data = r.json()
    except Exception:
        return None
    if (data.get("status") or "").lower() != "success":
        cache.set(key, {}, CACHE_TTL_SECONDS)
        return None
    info = GeoInfo(
        country=data.get("country") or "",
        country_code=data.get("countryCode") or "",
        city=data.get("city") or "",
    )
    cache.set(key, info.__dict__, CACHE_TTL_SECONDS)
    return info


def client_ip_from_request(request) -> str:
    """Pull the originating client IP from the request, respecting our
    Caddy proxy's X-Forwarded-For header. Falls back to REMOTE_ADDR.
    """
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        # X-Forwarded-For is "client, proxy1, proxy2…"; the first entry is
        # the actual client. We trust Caddy not to forge it because the api
        # container only listens on the docker network.
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.META.get("REMOTE_ADDR", "") or ""
