"""Pydantic schemas for the places API."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


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
    # How many users are currently checked in here. Used by the map UI
    # to highlight 'active' (occupied) markers.
    active_checkin_count: int = 0


class PlaceListOut(Schema):
    count: int
    items: list[PlaceOut]


class PlaceCreateIn(Schema):
    name: str = Field(min_length=2, max_length=160)
    kind: str = Field(default="spot_temporary")
    description: str = ""
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    elevation_m: int | None = None
    address: str = ""
    website: str = ""
    contact: str = ""
    opening_hours: str = ""
    bortle_class: float | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class PlacePatchIn(Schema):
    name: str | None = None
    description: str | None = None
    lat: float | None = None
    lon: float | None = None
    elevation_m: int | None = None
    address: str | None = None
    website: str | None = None
    contact: str | None = None
    opening_hours: str | None = None
    bortle_class: float | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
