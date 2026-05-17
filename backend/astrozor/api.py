"""Central Ninja API — composes routers from all apps."""

from __future__ import annotations

from django.middleware.csrf import get_token
from ninja import NinjaAPI
from ninja.security import django_auth

from apps.accounts.api import router as accounts_router
from apps.chat.api import router as chat_router
from apps.citizen.api import router as citizen_router
from apps.core.api import router as core_router
from apps.events.api import router as events_router
from apps.feeds.api import router as feeds_router
from apps.notifications.api import router as notifications_router
from apps.places.api import router as places_router
from apps.presence.api import router as presence_router
from apps.projects.api import router as projects_router
from apps.publishing.api import router as publishing_router
from apps.publishing_api.api import router as publishing_api_router
from apps.uploads.api import router as uploads_router
from apps.geocoding.api import router as geocoding_router
from apps.admin_panel.api import router as admin_router, public_router as map_config_router

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
api.add_router("", feeds_router)
api.add_router("", projects_router)
api.add_router("", events_router)
api.add_router("", citizen_router)
api.add_router("", publishing_api_router)
api.add_router("", uploads_router)
api.add_router("", geocoding_router)
api.add_router("", admin_router)
api.add_router("", map_config_router)


# CSRF token endpoint kept for Django admin form usage / future hardening
@api.get("/csrf", tags=["meta"])
def csrf(request):
    return {"csrfToken": get_token(request)}


__all__ = ["api", "django_auth"]
