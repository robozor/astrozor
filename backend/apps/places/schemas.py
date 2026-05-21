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
    bortle_class: float | None  # deprecated; use bortle_class_manual / bortle_class_map
    bortle_class_manual: float | None = None
    bortle_class_map: float | None = None
    bortle_class_map_source: str = ""
    bortle_class_map_updated_at: datetime | None = None
    opening_hours_schedule: dict = {}
    valid_from: datetime | None
    valid_to: datetime | None
    owner_email: str = ""
    # How many users are currently checked in here. Used by the map UI
    # to highlight 'active' (occupied) markers.
    active_checkin_count: int = 0
    # Visibility — see apps/core/visibility.py for the 4-level system.
    # `discussion_visibility` empty string = inherit from `visibility`.
    visibility: str = "public"
    allowed_user_emails: list[str] = []
    discussion_visibility: str = ""
    discussion_allowed_user_emails: list[str] = []
    # IANA timezone derived from lat/lon — used for the "Local time"
    # display alongside UTC and the user's preferred TZ. Empty string
    # when coordinates are missing or fall outside any known zone.
    timezone: str = ""


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
    opening_hours_schedule: dict | None = None
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
    opening_hours_schedule: dict | None = None
    bortle_class: float | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    # Visibility fields. allowed_user_emails is the canonical wire
    # shape — server resolves them to User rows on save. Pass an empty
    # list to clear the allowlist; omit the key to leave it untouched.
    visibility: str | None = None
    allowed_user_emails: list[str] | None = None
    discussion_visibility: str | None = None
    discussion_allowed_user_emails: list[str] | None = None
