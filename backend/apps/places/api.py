"""Places API — list, get, create (temporary), update, delete."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Q
from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Query, Router
from ninja.errors import HttpError

from .models import Place
from .schemas import PlaceCreateIn, PlaceListOut, PlaceOut, PlacePatchIn

router = Router(tags=["places"])


def _to_out(p: Place) -> dict:
    return {
        "id": p.id,
        "slug": p.slug,
        "name": p.name,
        "kind": p.kind,
        "status": p.status,
        "description": p.description,
        "lat": p.lat,
        "lon": p.lon,
        "elevation_m": p.elevation_m,
        "address": p.address,
        "website": p.website,
        "contact": p.contact,
        "opening_hours": p.opening_hours,
        "bortle_class": p.bortle_class,
        "valid_from": p.valid_from,
        "valid_to": p.valid_to,
        "active_checkin_count": getattr(p, "active_checkin_count", 0),
    }


def _annotate_active_checkins(qs):
    """Annotate active_checkin_count = currently checked-in users at each place."""
    now = timezone.now()
    return qs.annotate(
        active_checkin_count=Count(
            "checkins",
            filter=Q(checkins__ended_at__isnull=True, checkins__expires_at__gt=now),
        )
    )


@router.get("/places", response=PlaceListOut)
def list_places(
    request: HttpRequest,  # noqa: ARG001
    bbox: str | None = Query(default=None, description="lon_min,lat_min,lon_max,lat_max"),
    kind: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
):
    """List published places filtered by optional bbox / kind / name search."""
    qs = _annotate_active_checkins(Place.objects.filter(status=Place.Status.PUBLISHED))

    # Hide expired temporary places
    qs = qs.exclude(
        Q(kind=Place.Kind.SPOT_TEMPORARY) & Q(valid_to__lte=timezone.now()),
    )

    if bbox:
        try:
            lon_min, lat_min, lon_max, lat_max = (float(x) for x in bbox.split(","))
            qs = qs.filter(
                lat__gte=lat_min,
                lat__lte=lat_max,
                lon__gte=lon_min,
                lon__lte=lon_max,
            )
        except (ValueError, IndexError):
            pass  # ignore malformed bbox

    if kind:
        qs = qs.filter(kind=kind)

    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))

    qs = qs[:limit]
    items = list(qs)
    return {"count": len(items), "items": [_to_out(p) for p in items]}


@router.get("/places/{slug}", response={200: PlaceOut, 404: dict})
def get_place(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        place = _annotate_active_checkins(Place.objects.filter(slug=slug)).get()
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not place.is_visible:
        return 404, {"detail": "Place not visible"}
    return 200, _to_out(place)


def _require_authed(request: HttpRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required")


def _can_modify(user, place: Place) -> bool:
    if user.is_staff:
        return True
    return place.owner_id == user.id


def _unique_slug(name: str) -> str:
    base = slugify(name)[:100] or "place"
    candidate = base
    i = 2
    while Place.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


@router.post("/places", response={201: PlaceOut, 400: dict, 401: dict, 403: dict})
def create_place(request: HttpRequest, payload: PlaceCreateIn):
    _require_authed(request)

    kind = payload.kind
    if kind not in Place.Kind.values:
        return 400, {"detail": "Invalid kind"}

    # Only staff can create permanent observatories/spots; regular users only temporary
    if kind != Place.Kind.SPOT_TEMPORARY and not request.user.is_staff:
        return 403, {"detail": "Only staff can create permanent places"}

    # Default TTL for temporary places: 4 hours from now
    valid_to = payload.valid_to
    if kind == Place.Kind.SPOT_TEMPORARY and valid_to is None:
        valid_to = timezone.now() + timedelta(hours=4)

    place = Place.objects.create(
        slug=_unique_slug(payload.name),
        name=payload.name,
        kind=kind,
        status=Place.Status.PUBLISHED,
        description=payload.description,
        lat=payload.lat,
        lon=payload.lon,
        elevation_m=payload.elevation_m,
        address=payload.address,
        website=payload.website,
        contact=payload.contact,
        opening_hours=payload.opening_hours,
        bortle_class=payload.bortle_class,
        valid_from=payload.valid_from or (timezone.now() if kind == Place.Kind.SPOT_TEMPORARY else None),
        valid_to=valid_to,
        owner=request.user,
    )
    return 201, _to_out(place)


@router.patch("/places/{slug}", response={200: PlaceOut, 401: dict, 403: dict, 404: dict})
def update_place(request: HttpRequest, slug: str, payload: PlacePatchIn):
    _require_authed(request)
    try:
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not _can_modify(request.user, place):
        return 403, {"detail": "Forbidden"}

    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(place, field, value)
    place.save()
    return 200, _to_out(place)


@router.delete("/places/{slug}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_place(request: HttpRequest, slug: str):
    _require_authed(request)
    try:
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not _can_modify(request.user, place):
        return 403, {"detail": "Forbidden"}
    place.delete()
    return 204, None
