"""Places API — list, get, create (temporary), update, delete."""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache

from django.db.models import Count, Q
from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Query, Router
from ninja.errors import HttpError

from .light_pollution import estimate_bortle
from .models import BortleMeasurement, Place
from .schemas import PlaceCreateIn, PlaceListOut, PlaceOut, PlacePatchIn

router = Router(tags=["places"])


def _record_estimated_bortle(place: Place, user=None) -> BortleMeasurement | None:
    """Run the LP-map estimator for this place's coord and persist the
    result as both a history row AND the bortle_class_map cache fields
    on Place. Source label tracks whichever LP map source the admin has
    activated (Black Marble or VIIRS DNB latest)."""
    est = estimate_bortle(place.lat, place.lon)
    if est is None:
        return None
    # Map estimator source label -> BortleMeasurement.Source enum
    if est.source == "viirs_dnb_latest":
        meas_source = BortleMeasurement.Source.VIIRS_DNB_LATEST
    else:
        meas_source = BortleMeasurement.Source.VIIRS_BLACK_MARBLE
    m = BortleMeasurement.objects.create(
        place=place,
        value=est.bortle_class,
        source=meas_source,
        luminance=est.luminance,
        submitted_by=user if user and getattr(user, "is_authenticated", False) else None,
    )
    # Always update the map-derived cache fields — they're independent of
    # whether a manual reading exists.
    place.bortle_class_map = est.bortle_class
    place.bortle_class_map_source = meas_source
    place.bortle_class_map_updated_at = m.measured_at
    # Legacy bortle_class = effective value (manual wins)
    place.bortle_class = (
        place.bortle_class_manual
        if place.bortle_class_manual is not None
        else est.bortle_class
    )
    place.save(
        update_fields=[
            "bortle_class_map",
            "bortle_class_map_source",
            "bortle_class_map_updated_at",
            "bortle_class",
        ]
    )
    return m


def _to_out(p: Place) -> dict:
    # bortle_class (legacy field) = manual ?? map for back-compat callers
    effective = p.bortle_class_manual if p.bortle_class_manual is not None else p.bortle_class_map
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
        "opening_hours_schedule": p.opening_hours_schedule or {},
        "bortle_class": effective,  # deprecated
        "bortle_class_manual": p.bortle_class_manual,
        "bortle_class_map": p.bortle_class_map,
        "bortle_class_map_source": p.bortle_class_map_source,
        "bortle_class_map_updated_at": p.bortle_class_map_updated_at,
        "valid_from": p.valid_from,
        "valid_to": p.valid_to,
        "owner_email": p.owner.email if p.owner_id else "",
        "active_checkin_count": getattr(p, "active_checkin_count", 0),
        "visibility": p.visibility,
        "allowed_user_emails": _allowed_emails(p, "allowed_users"),
        "discussion_visibility": p.discussion_visibility or "",
        "discussion_allowed_user_emails": _allowed_emails(p, "discussion_allowed_users"),
        "timezone": _place_timezone(p),
    }


@lru_cache(maxsize=1024)
def _tz_for_coords(lat_round: float, lon_round: float) -> str:
    """Cached coords→TZ lookup. Round to 4 decimals (~11 m precision) so
    nearby points share the same cache key — timezones don't change that
    fast spatially. Keeps the cache bounded."""
    from apps.core.timezones import resolve_timezone

    return resolve_timezone(lat_round, lon_round)


def _place_timezone(p: Place) -> str:
    if p.lat is None or p.lon is None:
        return ""
    return _tz_for_coords(round(p.lat, 4), round(p.lon, 4))


def _allowed_emails(entity, field_name: str) -> list[str]:
    """Pull the email list off a M2M user relation. Wrapped because
    accessing the M2M outside a saved entity throws (e.g. when we're
    serialising a freshly-built but unsaved instance)."""
    if not entity.pk:
        return []
    try:
        return list(getattr(entity, field_name).values_list("email", flat=True))
    except Exception:  # pragma: no cover
        return []


def _annotate_active_checkins(qs):
    """Annotate active_checkin_count = currently checked-in users at each place."""
    now = timezone.now()
    return qs.select_related("owner").annotate(
        active_checkin_count=Count(
            "checkins",
            filter=Q(checkins__ended_at__isnull=True, checkins__expires_at__gt=now),
        )
    )


def _visibility_filter(user) -> Q:
    """Q filter for places the `user` is allowed to see. Mirrors
    apps.core.visibility.visibility_qs_filter() but with the Place
    owner field name and M2M baked in.
    Staff sees everything; anon sees only public; logged-in sees
    public + members + own + allowlist."""
    if user is not None and user.is_authenticated and user.is_staff:
        return Q()
    q = Q(visibility="public")
    if user is None or not user.is_authenticated:
        return q
    q |= Q(visibility="members") | Q(owner=user) | Q(visibility="allowlist", allowed_users=user)
    return q


@router.get("/places", response=PlaceListOut)
def list_places(
    request: HttpRequest,
    bbox: str | None = Query(default=None, description="lon_min,lat_min,lon_max,lat_max"),
    kind: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
):
    """List published places filtered by optional bbox / kind / name search."""
    qs = _annotate_active_checkins(Place.objects.filter(status=Place.Status.PUBLISHED))

    # Hide expired temporary places — except for the owner and staff users
    # who still need to see them (greyed-out in the UI) to extend or delete.
    # See issue #21.
    if not (request.user.is_authenticated and request.user.is_staff):
        expired_filter = (
            Q(kind=Place.Kind.SPOT_TEMPORARY) & Q(valid_to__lte=timezone.now())
        )
        if request.user.is_authenticated:
            expired_filter &= ~Q(owner=request.user)
        qs = qs.exclude(expired_filter)

    # Visibility — anon sees only public, logged-in sees more,
    # admins see everything. distinct() because the allowlist M2M
    # join can duplicate rows.
    qs = qs.filter(_visibility_filter(request.user)).distinct()

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


def _user_can_view_place(user, place: Place) -> bool:
    """Single-place visibility check. Cheaper than running through the
    queryset filter for one row."""
    from apps.core.visibility import can_view

    allowed_ids = None
    if place.visibility == "allowlist":
        allowed_ids = list(place.allowed_users.values_list("id", flat=True))
    return can_view(place.visibility, place.owner_id, allowed_ids, user)


@router.get("/places/{slug}", response={200: PlaceOut, 404: dict})
def get_place(request: HttpRequest, slug: str):
    try:
        place = _annotate_active_checkins(Place.objects.filter(slug=slug)).get()
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    # Owner and staff can fetch their own expired temporary places (so the
    # UI can show edit/delete actions). Everyone else gets 404 (#21).
    if not place.is_visible:
        is_owner = request.user.is_authenticated and place.owner_id == request.user.id
        is_staff = request.user.is_authenticated and request.user.is_staff
        if not (is_owner or is_staff):
            return 404, {"detail": "Place not visible"}
    # Privacy: return 404 (not 403) for users without permission. We
    # don't want to leak that a place with this slug exists — the rule
    # is "they won't see it at all", which means even the URL is opaque.
    if not _user_can_view_place(request.user, place):
        return 404, {"detail": "Place not found"}
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
        opening_hours_schedule=payload.opening_hours_schedule or {},
        bortle_class=payload.bortle_class,
        valid_from=payload.valid_from or (timezone.now() if kind == Place.Kind.SPOT_TEMPORARY else None),
        valid_to=valid_to,
        owner=request.user,
    )
    # If the user didn't enter a Bortle reading themselves, auto-fill one
    # from the VIIRS night-lights model. Records to BortleMeasurement
    # history so the source is visible to future viewers.
    if payload.bortle_class is None:
        _record_estimated_bortle(place, request.user)
    else:
        # User provided a value: record it as a manual measurement so the
        # history reflects the human input.
        BortleMeasurement.objects.create(
            place=place,
            value=payload.bortle_class,
            source=BortleMeasurement.Source.MANUAL,
            submitted_by=request.user,
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
    # Patch via the legacy single field updates BOTH manual and the
    # effective cache — keeps the dual-value design consistent regardless
    # of which client (old or new) sends the request.
    if "bortle_class" in data:
        v = data.pop("bortle_class")
        place.bortle_class_manual = v
        place.bortle_class = (
            v if v is not None else place.bortle_class_map
        )

    # Visibility / allowlist updates — handle M2M separately from
    # CharField fields.
    allowed_emails = data.pop("allowed_user_emails", None)
    discussion_allowed_emails = data.pop("discussion_allowed_user_emails", None)
    # Empty string in discussion_visibility means "inherit from main"
    # — leave the model field as "" rather than the four valid choices.
    if "discussion_visibility" in data:
        dv = data["discussion_visibility"]
        valid = {"public", "members", "allowlist", "private", "", None}
        if dv not in valid:
            data.pop("discussion_visibility")
        elif dv is None:
            data["discussion_visibility"] = ""
    if "visibility" in data:
        v = data["visibility"]
        if v not in {"public", "members", "allowlist", "private"}:
            data.pop("visibility")

    for field, value in data.items():
        setattr(place, field, value)
    place.save()

    # Resolve emails → User objects → M2M set. Unknown emails are
    # silently skipped (per ADR-002 "user adoption first, validation later").
    if allowed_emails is not None:
        _set_allowed_users(place.allowed_users, allowed_emails)
    if discussion_allowed_emails is not None:
        _set_allowed_users(place.discussion_allowed_users, discussion_allowed_emails)

    return 200, _to_out(place)


def _set_allowed_users(manager, emails: list[str]) -> None:
    """Set an M2M users manager from a list of emails. Unknown emails
    are dropped — the API spec says ADR-002 friendly UX."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    clean = [e.strip().lower() for e in emails if e and e.strip()]
    users = list(User.objects.filter(email__in=clean))
    manager.set(users)


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


# ---- Light pollution / Bortle estimation ----

from ninja import Schema  # noqa: E402


class BortleEstimateIn(Schema):
    lat: float
    lon: float


class BortleEstimateOut(Schema):
    bortle_class: float
    luminance: float
    source: str


@router.post(
    "/places/estimate-bortle",
    response={200: BortleEstimateOut, 401: dict, 502: dict},
)
def estimate_bortle_endpoint(request: HttpRequest, payload: BortleEstimateIn):
    """Estimate a Bortle dark-sky class for a GPS coordinate from public
    NASA Black Marble VIIRS night-lights data. Auth required to keep the
    upstream tile fetch quota reserved for our own users."""
    _require_authed(request)
    est = estimate_bortle(payload.lat, payload.lon)
    if est is None:
        return 502, {"detail": "Upstream VIIRS tile fetch failed"}
    return 200, {
        "bortle_class": est.bortle_class,
        "luminance": est.luminance,
        "source": est.source,
    }


@router.post(
    "/places/{slug}/estimate-bortle",
    response={200: PlaceOut, 401: dict, 403: dict, 404: dict, 502: dict},
)
def estimate_bortle_for_place(request: HttpRequest, slug: str):
    """Re-estimate Bortle for an existing place from VIIRS night-lights
    and append the result to the place's measurement history."""
    _require_authed(request)
    try:
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not _can_modify(request.user, place):
        return 403, {"detail": "Forbidden"}
    m = _record_estimated_bortle(place, request.user)
    if m is None:
        return 502, {"detail": "Upstream VIIRS tile fetch failed"}
    place = _annotate_active_checkins(Place.objects.filter(pk=place.pk)).get()
    return 200, _to_out(place)


# ---- Bortle measurement history ----


class BortleMeasurementIn(Schema):
    value: float
    measured_at: str | None = None  # ISO 8601, optional
    notes: str = ""


def _measurement_out(m: BortleMeasurement) -> dict:
    return {
        "id": str(m.id),
        "value": m.value,
        "source": m.source,
        "measured_at": m.measured_at,
        "notes": m.notes,
        "luminance": m.luminance,
        "submitted_by_email": m.submitted_by.email if m.submitted_by else "",
        "created_at": m.created_at,
    }


@router.get("/places/{slug}/bortle", response={200: dict, 404: dict})
def list_bortle_measurements(
    request: HttpRequest,  # noqa: ARG001
    slug: str,
):
    try:
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    qs = place.bortle_measurements.select_related("submitted_by").order_by("-measured_at")
    return 200, {
        "active": place.bortle_class,
        "items": [_measurement_out(m) for m in qs[:50]],
    }


@router.post(
    "/places/{slug}/bortle",
    response={201: dict, 400: dict, 401: dict, 404: dict},
)
def add_manual_bortle(request: HttpRequest, slug: str, payload: BortleMeasurementIn):
    """Record a manual Bortle reading. Any authenticated user can submit
    one — it's a community observation, not a moderated value."""
    _require_authed(request)
    try:
        place = Place.objects.get(slug=slug)
    except Place.DoesNotExist:
        return 404, {"detail": "Place not found"}
    if not (1.0 <= payload.value <= 9.0):
        return 400, {"detail": "Bortle value must be between 1 and 9"}

    measured_at = None
    if payload.measured_at:
        from django.utils.dateparse import parse_datetime

        measured_at = parse_datetime(payload.measured_at)
        if measured_at is None:
            return 400, {"detail": "measured_at must be ISO 8601"}

    m = BortleMeasurement.objects.create(
        place=place,
        value=payload.value,
        source=BortleMeasurement.Source.MANUAL,
        measured_at=measured_at or timezone.now(),
        notes=(payload.notes or "")[:1000],
        submitted_by=request.user,
    )
    # Manual readings update the manual cache + the legacy effective value.
    place.bortle_class_manual = payload.value
    place.bortle_class = payload.value
    place.save(update_fields=["bortle_class_manual", "bortle_class"])
    return 201, _measurement_out(m)
