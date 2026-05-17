from __future__ import annotations

from django.db.models import Count, Q
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
