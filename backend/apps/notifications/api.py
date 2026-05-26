from __future__ import annotations

from django.db.models import Q
from django.http import HttpRequest
from django.utils import timezone
from ninja import Query, Router

from .models import Notification, Subscription
from .schemas import (
    NotificationListOut,
    NotificationOut,
    SubscriptionIn,
    SubscriptionOut,
)

router = Router(tags=["notifications"])


def _require_auth(request: HttpRequest):
    if not request.user.is_authenticated:
        return False
    return True


# ---- Subscriptions ----


@router.get("/subscriptions", response={200: list[SubscriptionOut], 401: dict})
def list_subscriptions(request: HttpRequest):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    qs = Subscription.objects.filter(user=request.user).order_by("-created_at")
    return 200, [
        {"id": s.id, "kind": s.kind, "target_id": s.target_id, "created_at": s.created_at}
        for s in qs
    ]


@router.post("/subscriptions", response={201: SubscriptionOut, 200: SubscriptionOut, 401: dict})
def create_subscription(request: HttpRequest, payload: SubscriptionIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    obj, created = Subscription.objects.get_or_create(
        user=request.user,
        kind=payload.kind,
        target_id=payload.target_id,
    )
    status = 201 if created else 200
    return status, {
        "id": obj.id,
        "kind": obj.kind,
        "target_id": obj.target_id,
        "created_at": obj.created_at,
    }


@router.delete("/subscriptions/{sub_id}", response={204: None, 401: dict, 404: dict})
def delete_subscription(request: HttpRequest, sub_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        sub = Subscription.objects.get(id=sub_id, user=request.user)
    except (Subscription.DoesNotExist, ValueError):
        return 404, {"detail": "Subscription not found"}
    sub.delete()
    return 204, None


# ---- Notifications ----


@router.get("/notifications", response={200: NotificationListOut, 401: dict})
def list_notifications(
    request: HttpRequest,
    only_unread: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    qs = Notification.objects.filter(user=request.user)
    if only_unread:
        qs = qs.filter(read_at__isnull=True)
    qs = qs.order_by("-created_at")[:limit]
    items = list(qs)
    unread = Notification.objects.filter(user=request.user, read_at__isnull=True).count()
    return 200, {
        "count": len(items),
        "unread_count": unread,
        "items": [
            {
                "id": n.id,
                "kind": n.kind,
                "source_kind": n.source_kind,
                "source_id": n.source_id,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "created_at": n.created_at,
                "read_at": n.read_at,
            }
            for n in items
        ],
    }


@router.post("/notifications/{notif_id}/read", response={200: NotificationOut, 401: dict, 404: dict})
def mark_read(request: HttpRequest, notif_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        n = Notification.objects.get(id=notif_id, user=request.user)
    except (Notification.DoesNotExist, ValueError):
        return 404, {"detail": "Notification not found"}
    if n.read_at is None:
        n.read_at = timezone.now()
        n.save(update_fields=["read_at"])
    return 200, {
        "id": n.id,
        "kind": n.kind,
        "source_kind": n.source_kind,
        "source_id": n.source_id,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "created_at": n.created_at,
        "read_at": n.read_at,
    }


@router.post("/notifications/read-all", response={200: dict, 401: dict})
def mark_all_read(request: HttpRequest):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    n = Notification.objects.filter(user=request.user, read_at__isnull=True).update(
        read_at=timezone.now()
    )
    return 200, {"marked": n}


# ---- Discord notification preferences ----

from ninja import Schema  # noqa: E402

from .models import DiscordPreference  # noqa: E402


def _pref_out(p: DiscordPreference) -> dict:
    return {
        "id": str(p.id),
        "kind": p.kind,
        "enabled": p.enabled,
        "filters": p.filters or {},
        "updated_at": p.updated_at,
    }


@router.get("/notifications/discord-prefs", response={200: list[dict], 401: dict})
def list_discord_prefs(request: HttpRequest):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    qs = DiscordPreference.objects.filter(user=request.user).order_by("kind")
    return 200, [_pref_out(p) for p in qs]


class DiscordPrefIn(Schema):
    enabled: bool = True
    filters: dict = {}


@router.put("/notifications/discord-prefs/{kind}", response={200: dict, 400: dict, 401: dict})
def upsert_discord_pref(request: HttpRequest, kind: str, payload: DiscordPrefIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if kind not in DiscordPreference.Kind.values:
        return 400, {"detail": f"Unknown kind: {kind}"}
    pref, _ = DiscordPreference.objects.update_or_create(
        user=request.user,
        kind=kind,
        defaults={
            "enabled": payload.enabled,
            "filters": payload.filters or {},
        },
    )
    return 200, _pref_out(pref)


@router.delete(
    "/notifications/discord-prefs/{kind}", response={204: None, 401: dict, 404: dict}
)
def delete_discord_pref(request: HttpRequest, kind: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    deleted, _ = DiscordPreference.objects.filter(user=request.user, kind=kind).delete()
    if not deleted:
        return 404, {"detail": "Not found"}
    return 204, None


# ---- Lookups used by the filter UI ----


@router.get("/lookup/users", response={200: list[dict], 401: dict})
def lookup_users(request: HttpRequest, q: str = "", limit: int = 20):
    """Autocomplete-style search across users. Returns email + display name.
    Used by the Discord notification filter pickers (e.g. 'articles by these
    authors').
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}

    from apps.accounts.models import User

    qs = User.objects.select_related("profile").filter(is_active=True)
    if q:
        qs = qs.filter(Q(email__icontains=q) | Q(profile__display_name__icontains=q))
    qs = qs.order_by("email")[: max(1, min(50, limit))]
    return 200, [
        {
            "email": u.email,
            "display_name": getattr(u.profile, "display_name", "") or "",
        }
        for u in qs
    ]


@router.get("/lookup/events", response={200: list[dict], 401: dict})
def lookup_events(request: HttpRequest, q: str = "", limit: int = 20):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    from apps.events.models import Event

    qs = Event.objects.exclude(status=Event.Status.DRAFT)
    if q:
        qs = qs.filter(title__icontains=q)
    qs = qs.order_by("-starts_at")[: max(1, min(50, limit))]
    return 200, [
        {"slug": e.slug, "title": e.title, "status": e.status} for e in qs
    ]


@router.get("/lookup/campaigns", response={200: list[dict], 401: dict})
def lookup_campaigns(request: HttpRequest, q: str = "", limit: int = 20):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    from apps.citizen.models import Campaign

    qs = Campaign.objects.exclude(status=Campaign.Status.DRAFT)
    if q:
        qs = qs.filter(title__icontains=q)
    qs = qs.order_by("-created_at")[: max(1, min(50, limit))]
    return 200, [
        {"slug": c.slug, "title": c.title, "status": c.status} for c in qs
    ]
