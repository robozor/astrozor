"""Central Ninja API — composes routers from all apps."""

from __future__ import annotations

from django.middleware.csrf import get_token
from ninja import NinjaAPI
from ninja.security import django_auth

from apps.accounts.api import router as accounts_router
from apps.chat.api import router as chat_router
from apps.core.api import router as core_router
from apps.notifications.api import router as notifications_router
from apps.places.api import router as places_router
from apps.presence.api import router as presence_router
from apps.publishing.api import router as publishing_router

api = NinjaAPI(
    title="Astrozor API",
    version="0.0.1",
    description="Astrozor backend API",
    urls_namespace="astrozor_api",
    csrf=False,  # ADR-004: rely on SameSite=Lax session cookie + same-origin SPA
)

api.add_router("", core_router)
api.add_router("", accounts_router)
api.add_router("", places_router)
api.add_router("", presence_router)
api.add_router("", chat_router)
api.add_router("", notifications_router)
api.add_router("", publishing_router)


# CSRF token endpoint kept for Django admin form usage / future hardening
@api.get("/csrf", tags=["meta"])
def csrf(request):
    return {"csrfToken": get_token(request)}


__all__ = ["api", "django_auth"]
