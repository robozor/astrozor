"""Places API — read-only listing with bbox + kind filters."""

from __future__ import annotations

from django.db.models import Q
from django.http import HttpRequest
from django.utils import timezone
from ninja import Query, Router

from .models import Place
from .schemas import PlaceListOut, PlaceOut

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
    }


@router.get("/places", response=PlaceListOut)
def list_places(
    request: HttpRequest,  # noqa: ARG001
    bbox: str | None = Query(default=None, description="lon_min,lat_min,lon_max,lat_max"),
    kind: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
):
    """List published places filtered by optional bbox / kind / name search."""
    qs = Place.objects.filter(status=Place.Status.PUBLISHED)

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
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not place.is_visible:
        return 404, {"detail": "Place not visible"}
    return 200, _to_out(place)
