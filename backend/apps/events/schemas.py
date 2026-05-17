from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class EventCreateIn(Schema):
    title: str = Field(min_length=2, max_length=200)
    description: str = ""
    kind: str = "observation"
    place_slug: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    capacity: int = 0
    language: str = "cs"


class EventPatchIn(Schema):
    title: str | None = None
    description: str | None = None
    kind: str | None = None
    place_slug: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    capacity: int | None = None
    language: str | None = None


class EventTransitionIn(Schema):
    status: str


class EventOut(Schema):
    id: UUID
    slug: str
    title: str
    description: str
    kind: str
    language: str
    status: str
    place_slug: str | None
    starts_at: datetime
    ends_at: datetime | None
    capacity: int
    organizer_email: str
    registration_count: int
    created_at: datetime


class RegistrationOut(Schema):
    id: UUID
    event_slug: str
    user_email: str
    status: str
    created_at: datetime
