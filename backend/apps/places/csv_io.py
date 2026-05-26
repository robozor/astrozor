"""CSV import/export for places.

Schema is intentionally close to the Place model so admins can hand-edit
a spreadsheet, dump it, and re-import without surprises. Coordinates are
the natural key — incoming rows within 200 m of an existing place are
flagged as duplicates (user gets to decide per-row).
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterator

from .models import Place

# Column order is also the export order. Order matters for human-editable
# CSVs — keep the "what is this place" fields first, location next,
# metadata last.
CSV_COLUMNS = [
    "slug",
    "name",
    "kind",
    "description",
    "lat",
    "lon",
    "elevation_m",
    "address",
    "website",
    "contact",
    "opening_hours",
    "bortle_manual",
    "owner_email",
]

VALID_KINDS = {k for k, _ in Place.Kind.choices}

# Duplicate detection radius. 200 m is the user-specified threshold —
# enough to catch GPS-rounding drift on the same observatory but not so
# loose that a neighbouring spot 300 m away gets flagged.
DUPLICATE_RADIUS_METERS = 200.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def places_to_csv(qs) -> str:
    """Serialize a Place queryset (or iterable) to CSV text."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for p in qs.select_related("owner") if hasattr(qs, "select_related") else qs:
        writer.writerow(
            {
                "slug": p.slug,
                "name": p.name,
                "kind": p.kind,
                "description": p.description or "",
                "lat": p.lat,
                "lon": p.lon,
                "elevation_m": p.elevation_m if p.elevation_m is not None else "",
                "address": p.address or "",
                "website": p.website or "",
                "contact": p.contact or "",
                "opening_hours": p.opening_hours or "",
                "bortle_manual": (
                    p.bortle_class_manual if p.bortle_class_manual is not None else ""
                ),
                "owner_email": p.owner.email if p.owner_id else "",
            }
        )
    return buf.getvalue()


def parse_csv(text: str) -> Iterator[tuple[int, dict, list[str]]]:
    """Yield (row_index, parsed_dict, errors) for each non-header row.

    parsed_dict normalizes types (float for lat/lon/bortle, int for
    elevation, string otherwise). Empty strings → None for optional
    numerics. row_index is 1-based, matching how a spreadsheet user
    counts rows (header = row 1, first data row = row 2, ...).
    """
    reader = csv.DictReader(io.StringIO(text))
    for i, raw in enumerate(reader, start=2):
        errors: list[str] = []
        row: dict = {}
        # Required: name, lat, lon, kind
        name = (raw.get("name") or "").strip()
        if not name:
            errors.append("name is required")
        row["name"] = name
        kind = (raw.get("kind") or "").strip()
        if kind and kind not in VALID_KINDS:
            errors.append(
                f"kind must be one of {sorted(VALID_KINDS)} (got {kind!r})"
            )
        row["kind"] = kind or Place.Kind.SPOT_PERMANENT
        for key in ("lat", "lon"):
            raw_val = (raw.get(key) or "").strip()
            try:
                row[key] = float(raw_val.replace(",", "."))
            except ValueError:
                errors.append(f"{key} must be a number (got {raw_val!r})")
                row[key] = None
        # Optional numerics
        elev = (raw.get("elevation_m") or "").strip()
        try:
            row["elevation_m"] = int(float(elev)) if elev else None
        except ValueError:
            errors.append(f"elevation_m must be integer (got {elev!r})")
            row["elevation_m"] = None
        b = (raw.get("bortle_manual") or "").strip()
        try:
            row["bortle_manual"] = float(b.replace(",", ".")) if b else None
        except ValueError:
            errors.append(f"bortle_manual must be a number 1..9 (got {b!r})")
            row["bortle_manual"] = None
        if row["bortle_manual"] is not None and not (1.0 <= row["bortle_manual"] <= 9.0):
            errors.append("bortle_manual must be between 1 and 9")

        # Plain strings
        for key in (
            "slug",
            "description",
            "address",
            "website",
            "contact",
            "opening_hours",
            "owner_email",
        ):
            row[key] = (raw.get(key) or "").strip()

        yield i, row, errors


def find_duplicates(row: dict, candidates: list[Place]) -> list[dict]:
    """Return a list of {slug, name, distance_m} for candidates within
    DUPLICATE_RADIUS_METERS of the row's lat/lon. Sorted nearest-first.
    """
    if row.get("lat") is None or row.get("lon") is None:
        return []
    out = []
    for p in candidates:
        d = haversine_m(row["lat"], row["lon"], p.lat, p.lon)
        if d <= DUPLICATE_RADIUS_METERS:
            out.append({"slug": p.slug, "name": p.name, "distance_m": round(d, 1)})
    out.sort(key=lambda x: x["distance_m"])
    return out
