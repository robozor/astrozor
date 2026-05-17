"""Security middleware: hardening response headers + simple in-memory rate limit.

For MVP we use process-local rate limiting (cheap, no external dep).
For multi-instance deployments, swap to Redis-backed limiter.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable

from django.http import HttpRequest, HttpResponse, JsonResponse


class SecurityHeadersMiddleware:
    """Adds standard security headers to every response.

    Krok 19: minimum set. CSP intentionally not very strict on the frontend
    (Vite/HMR needs eval and inline). Production CSP is tightened when we
    move to a static build.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("X-Frame-Options", "DENY")
        response.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
        # CSP for API endpoints — strict; frontend keeps Vite-friendly headers via Caddy.
        if request.path.startswith("/api/") or request.path.startswith("/admin/"):
            response.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'",
            )
        return response


# ---- Rate limiter ----

_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_LOCK = threading.Lock()


def _rate_limited(key: str, *, max_calls: int, window_seconds: int) -> bool:
    now = time.monotonic()
    with _LOCK:
        bucket = _BUCKETS[key]
        # Drop old entries
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= max_calls:
            return True
        bucket.append(now)
        return False


# Path → (max_calls, window_seconds)
RATE_LIMITS_PROD = {
    "/api/v1/auth/signup": (10, 600),
    "/api/v1/auth/login": (20, 300),
    "/api/v1/auth/magic-link": (10, 600),
}

# In dev/E2E many tests share the same docker IP — give plenty of headroom
# so legit test traffic doesn't trip 429. Production limits used when DEBUG=False.
RATE_LIMITS_DEV = {
    # Higher than normal E2E volume per run but low enough that an attack-
    # pattern E2E (50+ signups in seconds) trips the limiter.
    "/api/v1/auth/signup": (50, 600),
    "/api/v1/auth/login": (100, 300),
    "/api/v1/auth/magic-link": (30, 600),
}


class RateLimitMiddleware:
    """Light rate limiting on sensitive auth endpoints."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        from django.conf import settings

        self.get_response = get_response
        self.limits = RATE_LIMITS_DEV if settings.DEBUG else RATE_LIMITS_PROD

    def __call__(self, request: HttpRequest) -> HttpResponse:
        cfg = self.limits.get(request.path)
        if cfg and request.method == "POST":
            ip = self._client_ip(request)
            key = f"{request.path}:{ip}"
            max_calls, window = cfg
            if _rate_limited(key, max_calls=max_calls, window_seconds=window):
                return JsonResponse(
                    {"detail": "Rate limit exceeded, try again later"},
                    status=429,
                )
        return self.get_response(request)

    @staticmethod
    def _client_ip(request: HttpRequest) -> str:
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")
