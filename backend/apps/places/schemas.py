"""Pydantic schemas for the places API."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema


class PlaceOut(Schema):
    id: UUID
    slug: str
    name: str
    kind: str
    status: str
    description: str
    lat: float
    lon: float
    elevation_m: int | None
    address: str
    website: str
    contact: str
    opening_hours: str
    bortle_class: float | None
    valid_from: datetime | None
    valid_to: datetime | None


class PlaceListOut(Schema):
    count: int
    items: list[PlaceOut]
