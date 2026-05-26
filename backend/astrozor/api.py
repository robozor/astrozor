"""Central Ninja API — composes routers from all apps."""

from __future__ import annotations

from django.db.models import Count
from django.middleware.csrf import get_token
from ninja import NinjaAPI
from ninja.security import django_auth

from apps.accounts.api import router as accounts_router
from apps.accounts.mastodon_api import router as mastodon_router
from apps.admin_panel.api import public_router as map_config_router
from apps.admin_panel.api import router as admin_router
from apps.chat.api import router as chat_router
from apps.citizen.api import router as citizen_router
from apps.core.api import router as core_router
from apps.docs.api import router as docs_router
from apps.events.api import router as events_router
from apps.feeds.api import router as feeds_router
from apps.geocoding.api import router as geocoding_router
from apps.notifications.api import router as notifications_router
from apps.places.api import router as places_router
from apps.presence.api import router as presence_router
from apps.projects.api import router as projects_router
from apps.publishing.api import router as publishing_router
from apps.publishing_api.api import router as publishing_api_router
from apps.uploads.api import router as uploads_router

api = NinjaAPI(
    title="Astrozor API",
    version="0.0.1",
    description="Astrozor backend API",
    urls_namespace="astrozor_api",
    csrf=False,  # ADR-004: rely on SameSite=Lax session cookie + same-origin SPA
)

api.add_router("", core_router)
api.add_router("", accounts_router)
api.add_router("", mastodon_router)
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
api.add_router("", docs_router)


# CSRF token endpoint kept for Django admin form usage / future hardening
@api.get("/csrf", tags=["meta"])
def csrf(request):
    return {"csrfToken": get_token(request)}


# ---- Tag suggestions across all 4 tagged content types ----
@api.get("/tags", tags=["meta"])
def list_tags(request, kind: str | None = None, q: str | None = None, limit: int = 100):
    """Suggest tag names for the editor & filter UI. `kind` narrows
    the search to one app's content type (articles|events|campaigns|
    projects); without it, returns the global tag set (frequency-sorted).
    `q` does a prefix-case-insensitive filter. Public — tags are
    metadata, not content.

    Astrozor uses ``apps.core.UUIDTaggedItem`` as the M2M through table
    (because Article/Event/Campaign/Project all have UUID primary keys
    — the default ``taggit.TaggedItem.object_id`` is IntegerField and
    silently failed on UUIDs). So this endpoint counts uses against
    UUIDTaggedItem, not the legacy taggit table.
    """
    from django.contrib.contenttypes.models import ContentType
    from taggit.models import Tag

    from apps.core.models import UUIDTaggedItem

    qs = Tag.objects.all()
    if kind:
        ct_map = {
            "articles": ("publishing", "article"),
            "events": ("events", "event"),
            "campaigns": ("citizen", "campaign"),
            "projects": ("projects", "project"),
        }
        app_model = ct_map.get(kind)
        if app_model:
            try:
                ct = ContentType.objects.get(app_label=app_model[0], model=app_model[1])
            except ContentType.DoesNotExist:
                return []
            tag_ids = UUIDTaggedItem.objects.filter(content_type=ct).values_list("tag_id", flat=True)
            qs = qs.filter(id__in=tag_ids)
    if q:
        qs = qs.filter(name__istartswith=q)
    # Count via the new UUID through-table. The auto-named reverse
    # accessor on Tag is "core_uuidtaggeditem_items" (lowercase
    # app_label + model).
    qs = qs.annotate(use_count=Count("core_uuidtaggeditem_items")).order_by("-use_count", "name")
    return [{"name": t.name, "slug": t.slug, "count": t.use_count} for t in qs[:limit]]


__all__ = ["api", "django_auth"]
