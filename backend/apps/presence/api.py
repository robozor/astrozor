"""Presence API — check-ins, active list per place."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Q
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router

from apps.places.models import Place

from .models import Checkin
from .schemas import CheckinIn, CheckinOut, PresenceOut

router = Router(tags=["presence"])


def _to_out(c: Checkin) -> dict:
    display = "—" if c.anonymous else (c.user.profile.display_name or c.user.email.split("@")[0])
    return {
        "id": c.id,
        "user_email": None if c.anonymous else c.user.email,
        "display_name": display if not c.anonymous else "someone",
        "comment": c.comment,
        "anonymous": c.anonymous,
        "place_slug": c.place.slug,
        "created_at": c.created_at,
        "expires_at": c.expires_at,
    }


@router.post("/places/{slug}/checkin", response={201: CheckinOut, 401: dict, 404: dict})
def create_checkin(request: HttpRequest, slug: str, payload: CheckinIn):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}

    hours = max(0.25, min(payload.expires_in_hours, 24))
    expires_at = timezone.now() + timedelta(hours=hours)

    checkin = Checkin.objects.create(
        user=request.user,
        place=place,
        comment=payload.comment[:200],
        anonymous=payload.anonymous,
        expires_at=expires_at,
    )
    return 201, _to_out(checkin)


@router.get("/places/{slug}/presence", response={200: PresenceOut, 404: dict})
def get_presence(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        place = Place.objects.get(slug=slug, status=Place.Status.PUBLISHED)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}

    qs = (
        Checkin.objects.filter(
            place=place,
            ended_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .select_related("user", "user__profile")
        .order_by("-created_at")
    )
    items = list(qs[:50])
    return 200, {
        "place_slug": slug,
        "count": len(items),
        "checkins": [_to_out(c) for c in items],
    }


@router.delete("/checkins/{checkin_id}", response={204: None, 401: dict, 403: dict, 404: dict})
def end_checkin(request: HttpRequest, checkin_id: str):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        checkin = Checkin.objects.get(id=checkin_id)
    except (Checkin.DoesNotExist, ValueError):
        return 404, {"detail": "Checkin not found"}
    if checkin.user_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    checkin.end()
    return 204, None


@router.get("/me/checkins", response={200: list[CheckinOut], 401: dict})
def my_checkins(request: HttpRequest):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    qs = (
        Checkin.objects.filter(user=request.user, ended_at__isnull=True, expires_at__gt=timezone.now())
        .select_related("place")
        .order_by("-created_at")
    )
    return 200, [_to_out(c) for c in qs]
