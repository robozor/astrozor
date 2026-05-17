"""Chat REST API — per-place messages.

Real-time delivery is via polling (frontend TanStack Query refetch).
WebSocket upgrade is a Krok 6.x follow-up. See ADR-006.
"""

from __future__ import annotations

import bleach
from django.http import HttpRequest
from ninja import Query, Router

from apps.places.models import Place

from .models import Message
from .schemas import MessageIn, MessageListOut, MessageOut

router = Router(tags=["chat"])

# Strict allowlist — chat is plain-text + minimal formatting.
ALLOWED_TAGS = ["b", "i", "em", "strong", "code", "br", "a"]
ALLOWED_ATTRS = {"a": ["href", "title", "rel"]}


def _safe_text(text: str) -> str:
    cleaned = bleach.clean(text, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
    return cleaned[:2000]


def _to_out(m: Message) -> dict:
    return {
        "id": m.id,
        "place_slug": m.place.slug,
        "user_display_name": m.user.profile.display_name or m.user.email.split("@")[0],
        "user_email": m.user.email,
        "text": m.text,
        "created_at": m.created_at,
    }


@router.get("/places/{slug}/chat", response={200: MessageListOut, 404: dict})
def list_messages(
    request: HttpRequest,  # noqa: ARG001
    slug: str,
    limit: int = Query(default=50, le=200),
):
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    qs = (
        Message.objects.filter(place=place, deleted_at__isnull=True)
        .select_related("user", "user__profile")
        .order_by("-created_at")[:limit]
    )
    items = list(qs)
    items.reverse()  # chronological for UI
    return 200, {"count": len(items), "items": [_to_out(m) for m in items]}


@router.post("/places/{slug}/chat", response={201: MessageOut, 401: dict, 404: dict})
def post_message(request: HttpRequest, slug: str, payload: MessageIn):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}

    msg = Message.objects.create(place=place, user=request.user, text=_safe_text(payload.text))
    return 201, _to_out(msg)


@router.delete("/messages/{message_id}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_message(request: HttpRequest, message_id: str):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        msg = Message.objects.get(id=message_id, deleted_at__isnull=True)
    except (Message.DoesNotExist, ValueError):
        return 404, {"detail": "Message not found"}
    if msg.user_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    from django.utils import timezone

    msg.deleted_at = timezone.now()
    msg.save(update_fields=["deleted_at"])
    return 204, None
