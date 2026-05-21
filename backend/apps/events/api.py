from __future__ import annotations

from functools import lru_cache

from django.http import HttpRequest, HttpResponse
from django.utils.text import slugify
from icalendar import Calendar, Event as ICalEvent
from ninja import Router

from apps.chat.sanitize import (
    auto_youtube_attachments as _auto_youtube_attachments,
    safe_text as _safe_text,
    sanitize_attachments as _sanitize_attachments,
)

from apps.places.models import Place

from .models import Comment, Event, Registration, TRANSITIONS, can_transition
from .schemas import (
    EventCommentIn,
    EventCommentListOut,
    EventCommentOut,
    EventCreateIn,
    EventOut,
    EventPatchIn,
    EventTransitionIn,
    RegistrationOut,
)

router = Router(tags=["events"])


def _require_auth(request: HttpRequest):
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


def _organizer_display(user) -> str:
    profile = getattr(user, "profile", None)
    if profile and profile.display_name:
        return profile.display_name
    return user.email.split("@")[0]


def _event_out(e: Event) -> dict:
    return {
        "id": e.id,
        "slug": e.slug,
        "title": e.title,
        "description": e.description,
        "kind": e.kind,
        "language": e.language,
        "status": e.status,
        "place_slug": e.place.slug if e.place else None,
        "place_name": e.place.name if e.place else "",
        "place_lat": e.place.lat if e.place else None,
        "place_lon": e.place.lon if e.place else None,
        "place_elevation_m": e.place.elevation_m if e.place else None,
        # Effective Bortle: prefer manual reading, fall back to map-derived.
        "place_bortle": (
            (e.place.bortle_class_manual
             if e.place.bortle_class_manual is not None
             else e.place.bortle_class_map)
            if e.place else None
        ),
        "external_address": e.external_address,
        "external_lat": e.external_lat,
        "external_lon": e.external_lon,
        "meeting_url": e.meeting_url,
        "discord_url": e.discord_url,
        "geocache_url": e.geocache_url,
        "radio_frequency": e.radio_frequency,
        "starts_at": e.starts_at,
        "ends_at": e.ends_at,
        "capacity": e.capacity,
        "organizer_email": e.organizer.email,
        "organizer_display_name": _organizer_display(e.organizer),
        "registration_count": e.registrations.filter(status=Registration.Status.CONFIRMED).count(),
        "created_at": e.created_at,
        "tags": list(e.tags.names()) if e.id else [],
        "visibility": e.visibility,
        "allowed_user_emails": _emails(e, "allowed_users"),
        "discussion_visibility": e.discussion_visibility or "",
        "discussion_allowed_user_emails": _emails(e, "discussion_allowed_users"),
        "timezone": _event_timezone(e),
    }


@lru_cache(maxsize=1024)
def _tz_for_coords(lat_round: float, lon_round: float) -> str:
    """Cached lookup — same shape as the helper in places.api."""
    from apps.core.timezones import resolve_timezone

    return resolve_timezone(lat_round, lon_round)


def _event_timezone(e: Event) -> str:
    """Local timezone for an event — prefer the linked place's coords,
    fall back to external_lat/lon. Empty when neither is set."""
    lat = e.place.lat if e.place else e.external_lat
    lon = e.place.lon if e.place else e.external_lon
    if lat is None or lon is None:
        return ""
    return _tz_for_coords(round(lat, 4), round(lon, 4))


def _emails(entity, field_name: str) -> list[str]:
    """Pull emails off an M2M to User."""
    if not entity.pk:
        return []
    try:
        return list(getattr(entity, field_name).values_list("email", flat=True))
    except Exception:  # pragma: no cover
        return []


def _unique_slug(title: str) -> str:
    base = slugify(title)[:120] or "event"
    candidate = base
    i = 2
    while Event.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


# ---- List & detail ----


def _event_visibility_filter(user):
    """Q-filter for events visible to `user`. Same shape as places —
    staff sees everything, anon only public, logged-in sees public +
    members + own + allowlist."""
    from django.db.models import Q

    if user is not None and user.is_authenticated and user.is_staff:
        return Q()
    q = Q(visibility="public")
    if user is None or not user.is_authenticated:
        return q
    q |= (
        Q(visibility="members")
        | Q(organizer=user)
        | Q(visibility="allowlist", allowed_users=user)
    )
    return q


def _user_can_view_event(user, event: Event) -> bool:
    from apps.core.visibility import can_view

    allowed_ids = None
    if event.visibility == "allowlist":
        allowed_ids = list(event.allowed_users.values_list("id", flat=True))
    return can_view(event.visibility, event.organizer_id, allowed_ids, user)


@router.get("/events", response={200: list[EventOut]})
def list_events(
    request: HttpRequest,
    kind: str | None = None,
    status: str | None = None,
    place_slug: str | None = None,
    tag: list[str] | None = None,
):
    qs = Event.objects.select_related("organizer", "place").exclude(status=Event.Status.DRAFT)
    # Visibility filter — see _event_visibility_filter().
    qs = qs.filter(_event_visibility_filter(request.user)).distinct()
    if kind:
        qs = qs.filter(kind=kind)
    if status:
        qs = qs.filter(status=status)
    if place_slug:
        qs = qs.filter(place__slug=place_slug)
    if tag:
        for t in tag:
            qs = qs.filter(tags__name__iexact=t)
        qs = qs.distinct()
    return 200, [_event_out(e) for e in qs[:200]]


@router.get("/events/{slug}", response={200: EventOut, 404: dict})
def get_event(request: HttpRequest, slug: str):
    try:
        e = Event.objects.select_related("organizer", "place").get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    # Privacy: 404 (not 403) when the user lacks permission — we don't
    # want to leak that an event with this slug exists. The list query
    # already excludes them; the slug-by-URL path mirrors that policy.
    if not _user_can_view_event(request.user, e):
        return 404, {"detail": "Event not found"}
    if e.status == Event.Status.DRAFT and (
        not request.user.is_authenticated or (e.organizer_id != request.user.id and not request.user.is_staff)
    ):
        return 404, {"detail": "Event not found"}
    return 200, _event_out(e)


# ---- Create / edit ----


@router.post("/events", response={201: EventOut, 400: dict, 401: dict})
def create_event(request: HttpRequest, payload: EventCreateIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    place = None
    if payload.place_slug:
        try:
            place = Place.objects.get(slug=payload.place_slug)
        except Place.DoesNotExist:
            return 400, {"detail": "Place not found"}

    vis = payload.visibility if payload.visibility in {"public", "members", "allowlist", "private"} else "public"
    disc_vis = payload.discussion_visibility
    if disc_vis not in {"public", "members", "allowlist", "private", ""}:
        disc_vis = ""

    e = Event.objects.create(
        slug=_unique_slug(payload.title),
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        language=payload.language,
        place=place,
        external_address=payload.external_address or "",
        external_lat=payload.external_lat,
        external_lon=payload.external_lon,
        meeting_url=payload.meeting_url or "",
        discord_url=payload.discord_url or "",
        geocache_url=payload.geocache_url or "",
        radio_frequency=payload.radio_frequency or "",
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        capacity=max(0, payload.capacity),
        organizer=request.user,
        visibility=vis,
        discussion_visibility=disc_vis,
    )
    clean_tags = [t.strip() for t in (payload.tags or []) if t.strip()]
    if clean_tags:
        e.tags.set(clean_tags)
    _set_allowed_users(e.allowed_users, payload.allowed_user_emails or [])
    _set_allowed_users(e.discussion_allowed_users, payload.discussion_allowed_user_emails or [])
    return 201, _event_out(e)


def _set_allowed_users(manager, emails: list[str]) -> None:
    from django.contrib.auth import get_user_model

    User = get_user_model()
    clean = [s.strip().lower() for s in emails if s and s.strip()]
    users = list(User.objects.filter(email__in=clean))
    manager.set(users)


@router.patch("/events/{slug}", response={200: EventOut, 401: dict, 403: dict, 404: dict})
def update_event(request: HttpRequest, slug: str, payload: EventPatchIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    if e.organizer_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    data = payload.dict(exclude_unset=True)
    tags = data.pop("tags", None)
    allowed_emails = data.pop("allowed_user_emails", None)
    discussion_allowed_emails = data.pop("discussion_allowed_user_emails", None)

    if "visibility" in data and data["visibility"] not in {"public", "members", "allowlist", "private"}:
        data.pop("visibility")
    if "discussion_visibility" in data:
        dv = data["discussion_visibility"]
        if dv is None:
            data["discussion_visibility"] = ""
        elif dv not in {"public", "members", "allowlist", "private", ""}:
            data.pop("discussion_visibility")

    if "place_slug" in data:
        v = data.pop("place_slug")
        if v:
            try:
                e.place = Place.objects.get(slug=v)
            except Place.DoesNotExist:
                pass
        else:
            e.place = None
    for field, value in data.items():
        setattr(e, field, value)
    e.save()
    if tags is not None:
        clean = [t.strip() for t in tags if t.strip()]
        if clean:
            e.tags.set(clean, clear=True)
        else:
            e.tags.clear()
    if allowed_emails is not None:
        _set_allowed_users(e.allowed_users, allowed_emails)
    if discussion_allowed_emails is not None:
        _set_allowed_users(e.discussion_allowed_users, discussion_allowed_emails)
    return 200, _event_out(e)


@router.delete(
    "/events/{slug}",
    response={204: None, 401: dict, 403: dict, 404: dict},
)
def delete_event(request: HttpRequest, slug: str):
    """Hard-delete an event. Owner-only, with admin override.
    Cascade removes registrations and comments (FK on_delete=CASCADE).
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    if e.organizer_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    e.delete()
    return 204, None


# ---- Discord auto-channel ----


@router.post(
    "/events/{slug}/discord-channel",
    response={200: EventOut, 400: dict, 401: dict, 403: dict, 404: dict, 502: dict},
)
def create_event_discord_channel(request: HttpRequest, slug: str):
    """Provision a Discord channel + invite link for this event in the
    organizer's connected Discord server. Requires:

    1. Organizer (or staff) has linked Discord (Astrozor bot installed
       in their server — `Identity.discord_guild_id` populated).
    2. Bot still has Manage Channels + Create Instant Invite perms in
       that guild (Discord can revoke at any time).

    On success writes the new invite URL into ``event.discord_url`` and
    returns the updated event. On Discord-side failure (missing perms,
    rate-limit, deleted server) returns 502 with a human-readable hint.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.select_related("organizer", "place").get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    if e.organizer_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    # Find the user's Discord identity with a guild attached.
    from apps.accounts.models import Identity
    from apps.accounts.discord_bot import (
        DiscordBotError,
        create_invite,
        create_text_channel,
        safe_channel_name,
    )

    identity = (
        Identity.objects.filter(user=e.organizer, provider="discord")
        .exclude(discord_guild_id="")
        .first()
    )
    if not identity:
        return 400, {
            "detail": (
                "Organizer hasn't connected Discord with bot install. "
                "Open Settings → Connected accounts → Connect Discord."
            )
        }

    channel_name = safe_channel_name(e.title)
    topic = f"Astrozor event: {e.title}"
    try:
        channel = create_text_channel(
            guild_id=identity.discord_guild_id,
            name=channel_name,
            topic=topic,
        )
        invite = create_invite(channel["id"])
    except DiscordBotError as err:
        return 502, {
            "detail": f"Discord rejected the request: {err.detail}",
            "discord_status": err.status,
        }

    e.discord_url = invite.get("url", "")
    e.save(update_fields=["discord_url", "updated_at"])
    return 200, _event_out(e)


# ---- State machine ----


@router.post("/events/{slug}/transition", response={200: EventOut, 400: dict, 401: dict, 403: dict, 404: dict})
def transition_event(request: HttpRequest, slug: str, payload: EventTransitionIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    if e.organizer_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    if payload.status not in Event.Status.values:
        return 400, {"detail": "Unknown status"}
    if not can_transition(e.status, payload.status):
        allowed = list(TRANSITIONS.get(e.status, set()))
        return 400, {
            "detail": f"Cannot transition from {e.status} to {payload.status}",
            "allowed": allowed,
        }
    prev_status = e.status
    e.status = payload.status
    e.save(update_fields=["status", "updated_at"])

    from apps.notifications.discord_dispatch import dispatch_event

    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    dispatch_event(
        "event_status_changed",
        {
            "title": f"🎟 Akce {e.title}: {prev_status} → {e.status}",
            "description": (e.description or "")[:300],
            "url": f"{scheme}://{host}/events/{e.slug}",
            "fields": [
                {"name": "Organizátor", "value": e.organizer.email, "inline": True},
                {"name": "Začátek", "value": e.starts_at.strftime("%Y-%m-%d %H:%M"), "inline": True},
                {"name": "Nový stav", "value": e.status, "inline": True},
            ],
            "organizer_email": e.organizer.email,
            "event_slug": e.slug,
            "to_state": e.status,
            "from_state": prev_status,
            "actor_user_id": str(request.user.id),
        },
    )
    return 200, _event_out(e)


# ---- Registration ----


@router.post("/events/{slug}/register", response={201: RegistrationOut, 200: RegistrationOut, 400: dict, 401: dict, 404: dict})
def register(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    if e.status != Event.Status.REGISTRATION_OPEN:
        return 400, {"detail": f"Registration not open (status={e.status})"}
    if e.capacity > 0:
        confirmed = e.registrations.filter(status=Registration.Status.CONFIRMED).count()
        if confirmed >= e.capacity:
            return 400, {"detail": "Event at capacity"}

    obj, created = Registration.objects.get_or_create(
        event=e,
        user=request.user,
        defaults={"status": Registration.Status.CONFIRMED},
    )
    status_code = 201 if created else 200
    return status_code, _registration_out(obj)


@router.delete("/events/{slug}/register", response={204: None, 401: dict, 404: dict})
def cancel_registration(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    Registration.objects.filter(event=e, user=request.user).update(
        status=Registration.Status.CANCELLED
    )
    return 204, None


# ---- Registrations listing (attendees) ----


def _registration_out(r: Registration) -> dict:
    return {
        "id": r.id,
        "event_slug": r.event.slug,
        "user_email": r.user.email,
        "user_display_name": _organizer_display(r.user),
        "status": r.status,
        "created_at": r.created_at,
    }


@router.get(
    "/events/{slug}/registrations",
    response={200: list[RegistrationOut], 404: dict},
)
def list_registrations(request: HttpRequest, slug: str):  # noqa: ARG001
    """Public list of confirmed attendees for an event. Returns display
    name + email (the latter so the frontend UserNameLink can open the
    public profile modal — the email is otherwise already exposed in
    many places in the API)."""
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}
    qs = (
        Registration.objects.filter(event=e, status=Registration.Status.CONFIRMED)
        .select_related("user", "user__profile", "event")
        .order_by("created_at")
    )
    return 200, [_registration_out(r) for r in qs[:500]]


# ---- Event discussion ----


def _comment_out(c: Comment) -> dict:
    return {
        "id": c.id,
        "event_slug": c.event.slug,
        "parent_id": c.parent_id,
        "user_display_name": _organizer_display(c.user),
        "user_email": c.user.email,
        "text": c.text,
        "attachments": c.attachments or [],
        "created_at": c.created_at,
    }


@router.get(
    "/events/{slug}/comments",
    response={200: EventCommentListOut, 401: dict, 403: dict, 404: dict},
)
def list_comments(request: HttpRequest, slug: str):
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}

    # Discussion visibility follows the organizer's per-event setting —
    # `discussion_visibility` falls back to `visibility` when blank.
    from apps.core.visibility import can_view_discussion

    if not can_view_discussion(e, request.user):
        if not request.user.is_authenticated:
            return 401, {"detail": "Authentication required"}
        return 403, {"detail": "Discussion is not accessible to you"}

    qs = (
        Comment.objects.filter(event=e, deleted_at__isnull=True)
        .select_related("user", "event")
        .order_by("created_at")
    )
    items = list(qs[:500])
    return 200, {"count": len(items), "items": [_comment_out(c) for c in items]}


@router.post(
    "/events/{slug}/comments",
    response={201: EventCommentOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def post_comment(request: HttpRequest, slug: str, payload: EventCommentIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        e = Event.objects.get(slug=slug)
    except Event.DoesNotExist:
        return 404, {"detail": "Event not found"}

    from apps.core.visibility import can_view_discussion

    if not can_view_discussion(e, request.user):
        return 403, {"detail": "You can't post to this discussion"}

    text = _safe_text(payload.text or "")
    attachments = _sanitize_attachments(payload.attachments or [])
    # Auto-detect YouTube links pasted into text — same convenience as
    # the chat & article comment endpoints.
    attachments = attachments + _auto_youtube_attachments(text)
    if not text and not attachments:
        return 400, {"detail": "Empty comment"}

    parent = None
    if payload.parent_id:
        parent = Comment.objects.filter(id=payload.parent_id, event=e).first()

    c = Comment.objects.create(
        event=e,
        user=request.user,
        parent=parent,
        text=text,
        attachments=attachments,
    )
    return 201, _comment_out(c)


@router.delete(
    "/events/comments/{comment_id}",
    response={204: None, 401: dict, 403: dict, 404: dict},
)
def delete_comment(request: HttpRequest, comment_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        c = Comment.objects.get(id=comment_id, deleted_at__isnull=True)
    except (Comment.DoesNotExist, ValueError):
        return 404, {"detail": "Comment not found"}
    # Owner-only (no admin override) — same rule as chat/article comments.
    if c.user_id != request.user.id:
        return 403, {"detail": "Forbidden"}
    from django.utils import timezone

    c.deleted_at = timezone.now()
    c.save(update_fields=["deleted_at"])
    return 204, None


# ---- iCal export ----


@router.get("/events/{slug}/ical", url_name="event_ical", include_in_schema=False)
def event_ical(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        e = Event.objects.select_related("organizer", "place").get(slug=slug)
    except Event.DoesNotExist:
        return HttpResponse(status=404)

    cal = Calendar()
    cal.add("prodid", "-//Astrozor//astrozor.cz//")
    cal.add("version", "2.0")
    ev = ICalEvent()
    ev.add("uid", f"astrozor-event-{e.id}@astrozor.cz")
    ev.add("summary", e.title)
    ev.add("description", e.description or "")
    ev.add("dtstart", e.starts_at)
    if e.ends_at:
        ev.add("dtend", e.ends_at)
    if e.place:
        ev.add("location", e.place.name)
    ev.add("status", "CANCELLED" if e.status == Event.Status.CANCELLED else "CONFIRMED")
    cal.add_component(ev)

    response = HttpResponse(cal.to_ical(), content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="event-{e.slug}.ics"'
    return response
