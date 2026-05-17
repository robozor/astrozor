from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from django.utils.text import slugify
from icalendar import Calendar, Event as ICalEvent
from ninja import Router

from apps.places.models import Place

from .models import Event, Registration, TRANSITIONS, can_transition
from .schemas import (
    EventCreateIn,
    EventOut,
    EventPatchIn,
    EventTransitionIn,
    RegistrationOut,
)

router = Router(tags=["events"])


def _require_auth(request: HttpRequest):
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


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
        "starts_at": e.starts_at,
        "ends_at": e.ends_at,
        "capacity": e.capacity,
        "organizer_email": e.organizer.email,
        "registration_count": e.registrations.filter(status=Registration.Status.CONFIRMED).count(),
        "created_at": e.created_at,
    }


def _unique_slug(title: str) -> str:
    base = slugify(title)[:120] or "event"
    candidate = base
    i = 2
    while Event.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


# ---- List & detail ----


@router.get("/events", response={200: list[EventOut]})
def list_events(
    request: HttpRequest,  # noqa: ARG001
    kind: str | None = None,
    status: str | None = None,
    place_slug: str | None = None,
):
    qs = Event.objects.select_related("organizer", "place").exclude(status=Event.Status.DRAFT)
    if kind:
        qs = qs.filter(kind=kind)
    if status:
        qs = qs.filter(status=status)
    if place_slug:
        qs = qs.filter(place__slug=place_slug)
    return 200, [_event_out(e) for e in qs[:200]]


@router.get("/events/{slug}", response={200: EventOut, 404: dict})
def get_event(request: HttpRequest, slug: str):
    try:
        e = Event.objects.select_related("organizer", "place").get(slug=slug)
    except Event.DoesNotExist:
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

    e = Event.objects.create(
        slug=_unique_slug(payload.title),
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        language=payload.language,
        place=place,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        capacity=max(0, payload.capacity),
        organizer=request.user,
    )
    return 201, _event_out(e)


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
    e.status = payload.status
    e.save(update_fields=["status", "updated_at"])
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
    return status_code, {
        "id": obj.id,
        "event_slug": e.slug,
        "user_email": request.user.email,
        "status": obj.status,
        "created_at": obj.created_at,
    }


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
