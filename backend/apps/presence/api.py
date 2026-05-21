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
    # System-generated check-ins from the place's opening-hours schedule
    # have no user attached; render them as a distinct "open" presence
    # so the map shows the observatory is staffed without naming anyone.
    if c.source == Checkin.Source.AUTO_SCHEDULE:
        display = "Hvězdárna otevřena"
        email = None
    elif c.anonymous or c.user is None:
        display = "someone"
        email = None
    else:
        display = c.user.profile.display_name or c.user.email.split("@")[0]
        email = c.user.email
    return {
        "id": c.id,
        "user_email": email,
        "display_name": display,
        "comment": c.comment,
        "anonymous": c.anonymous or c.source == Checkin.Source.AUTO_SCHEDULE,
        "source": c.source,
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

    # Best-effort Mastodon cross-post if the user opted in. Anonymous
    # check-ins are explicitly NOT posted — anonymity means we don't
    # reveal who's at the place.
    if (
        not payload.anonymous
        and getattr(request.user, "profile", None)
        and request.user.profile.mastodon_autopost_checkin
    ):
        from apps.accounts.mastodon_post import post_status

        text_parts = [f"🔭 Pozoruji z {place.name}"]
        if payload.comment:
            text_parts.append(payload.comment[:200])
        host = request.get_host()
        scheme = "https" if request.is_secure() else "http"
        text_parts.append(f"{scheme}://{host}/places/{place.slug}")
        post_status(request.user, "\n\n".join(text_parts))

    # Discord webhook fanout — fires for users who opted in to either
    # "any check-in" or "check-in on followed place" notifications.
    from apps.notifications.discord_dispatch import dispatch_event

    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    place_url = f"{scheme}://{host}/places/{place.slug}"
    actor = "někdo (anonymně)" if payload.anonymous else (
        request.user.profile.display_name if request.user.profile.display_name
        else request.user.email.split("@")[0]
    )
    common_payload = {
        "title": f"🔭 {actor} dělá check-in",
        "description": payload.comment[:300] if payload.comment else "",
        "url": place_url,
        "fields": [
            {"name": "Místo", "value": place.name, "inline": True},
            {
                "name": "Vyprší",
                "value": expires_at.strftime("%Y-%m-%d %H:%M UTC"),
                "inline": True,
            },
        ],
        "actor_user_id": str(request.user.id),
        "place_id": str(place.id),
    }
    dispatch_event("place_any_checkin", common_payload)
    dispatch_event("place_followed_checkin", common_payload)

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
