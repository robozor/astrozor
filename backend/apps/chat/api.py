"""Chat REST API — per-place threaded messages with media attachments.

Sprint-scoped chat (Zooniverse Citizen Science sprints) lives under
``apps.citizen.api`` but reuses the same sanitiser / output helpers
from :mod:`apps.chat.sanitize` so both surfaces share HTML scrubbing,
attachment allowlists, and the YouTube auto-link behaviour.

Real-time delivery is via polling (frontend TanStack Query refetch).
WebSocket upgrade is a Krok 6.x follow-up. See ADR-006.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Query, Router

from apps.places.models import Place

from .models import Message
from .sanitize import (
    auto_youtube_attachments,
    message_out,
    safe_text,
    sanitize_attachments,
)
from .schemas import MessageEditIn, MessageIn, MessageListOut, MessageOut

router = Router(tags=["chat"])


@router.get(
    "/places/{slug}/chat",
    response={200: MessageListOut, 401: dict, 403: dict, 404: dict},
)
def list_messages(
    request: HttpRequest,
    slug: str,
    limit: int = Query(default=200, le=500),
):
    # Discussion visibility follows the owner's per-place settings —
    # `discussion_visibility` falls back to `visibility` when blank.
    # Anon gets 401 when discussion isn't PUBLIC, 403 when authenticated
    # but not on the allowlist.
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}

    from apps.core.visibility import can_view_discussion

    if not can_view_discussion(place, request.user):
        if not request.user.is_authenticated:
            return 401, {"detail": "Authentication required"}
        return 403, {"detail": "Discussion is not accessible to you"}
    qs = (
        Message.objects.filter(place=place, deleted_at__isnull=True)
        .select_related("user", "user__profile")
        .order_by("created_at")[:limit]
    )
    items = list(qs)
    return 200, {
        "count": len(items),
        "items": [message_out(m, place_slug=place.slug) for m in items],
    }


@router.post(
    "/places/{slug}/chat",
    response={201: MessageOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def post_message(request: HttpRequest, slug: str, payload: MessageIn):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}

    # Posting is gated by the same discussion visibility as reading —
    # someone who can't see the discussion shouldn't post either.
    from apps.core.visibility import can_view_discussion

    if not can_view_discussion(place, request.user):
        return 403, {"detail": "You can't post to this discussion"}

    text = safe_text(payload.text or "")
    attachments = sanitize_attachments(payload.attachments or [])
    # ``zoo_subject`` attachments are sprint-only — drop them silently
    # from place chat to avoid leaking the kind into the wrong surface.
    attachments = [a for a in attachments if a["kind"] != "zoo_subject"]
    # Auto-detect inline YouTube URLs and add as attachments if not already there.
    existing_yt = {a["video_id"] for a in attachments if a.get("kind") == "youtube"}
    for auto in auto_youtube_attachments(text):
        if auto["video_id"] not in existing_yt:
            attachments.append(auto)
            existing_yt.add(auto["video_id"])

    if not text and not attachments:
        return 400, {"detail": "Message must have text or at least one attachment"}

    parent = None
    if payload.parent_id:
        try:
            parent = Message.objects.get(
                id=payload.parent_id, place=place, deleted_at__isnull=True
            )
        except Message.DoesNotExist:
            return 400, {"detail": "Parent message not found"}

    msg = Message.objects.create(
        place=place,
        user=request.user,
        parent=parent,
        text=text,
        attachments=attachments,
    )
    msg.user = request.user
    return 201, message_out(msg, place_slug=place.slug)


@router.patch(
    "/messages/{message_id}",
    response={200: MessageOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def edit_message(request: HttpRequest, message_id: str, payload: MessageEditIn):
    """Owner-only edit of a chat message.

    Scope-agnostic — works for both place and sprint messages. The
    sanitiser pipeline matches POST (same HTML allowlist, same
    attachment validation). ``zoo_subject`` attachments are stripped
    from place-scoped messages just like on create. The edit stamps
    ``edited_at = now()`` so readers see an "(edited)" indicator.
    """
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        msg = Message.objects.select_related("place", "sprint").get(
            id=message_id, deleted_at__isnull=True
        )
    except (Message.DoesNotExist, ValueError):
        return 404, {"detail": "Message not found"}
    if msg.user_id != request.user.id:
        return 403, {"detail": "Forbidden"}

    text = safe_text(payload.text or "")
    attachments = sanitize_attachments(payload.attachments or [])
    # ``zoo_subject`` is a sprint-chat-only kind; never leak into a
    # place-scoped message even if the client tries to smuggle one in.
    if msg.place_id is not None and msg.sprint_id is None:
        attachments = [a for a in attachments if a["kind"] != "zoo_subject"]
    existing_yt = {a["video_id"] for a in attachments if a.get("kind") == "youtube"}
    for auto in auto_youtube_attachments(text):
        if auto["video_id"] not in existing_yt:
            attachments.append(auto)
            existing_yt.add(auto["video_id"])
    if not text and not attachments:
        return 400, {"detail": "Message must have text or at least one attachment"}

    from django.utils import timezone

    msg.text = text
    msg.attachments = attachments
    msg.edited_at = timezone.now()
    msg.save(update_fields=["text", "attachments", "edited_at"])
    msg.user = request.user
    return 200, message_out(
        msg,
        place_slug=msg.place.slug if msg.place_id else "",
        sprint_slug=msg.sprint.slug if msg.sprint_id else "",
    )


@router.delete("/messages/{message_id}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_message(request: HttpRequest, message_id: str):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        msg = Message.objects.get(id=message_id, deleted_at__isnull=True)
    except (Message.DoesNotExist, ValueError):
        return 404, {"detail": "Message not found"}
    # Chat messages are owner-only — admins cannot delete others' chat
    # messages (deliberate: chat is a community space, moderation would
    # need a separate moderation flow with audit trail). Same rule
    # applies for both place-scoped and sprint-scoped messages.
    if msg.user_id != request.user.id:
        return 403, {"detail": "Forbidden"}
    from django.utils import timezone

    msg.deleted_at = timezone.now()
    msg.save(update_fields=["deleted_at"])
    return 204, None
