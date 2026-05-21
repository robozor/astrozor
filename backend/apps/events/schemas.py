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
    external_address: str = ""
    external_lat: float | None = None
    external_lon: float | None = None
    meeting_url: str = ""
    discord_url: str = ""
    geocache_url: str = ""
    radio_frequency: str = ""
    starts_at: datetime
    ends_at: datetime | None = None
    capacity: int = 0
    language: str = "cs"
    tags: list[str] = []
    visibility: str = "public"
    allowed_user_emails: list[str] = []
    discussion_visibility: str = ""
    discussion_allowed_user_emails: list[str] = []


class EventPatchIn(Schema):
    title: str | None = None
    description: str | None = None
    kind: str | None = None
    place_slug: str | None = None
    external_address: str | None = None
    external_lat: float | None = None
    external_lon: float | None = None
    meeting_url: str | None = None
    discord_url: str | None = None
    geocache_url: str | None = None
    radio_frequency: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    capacity: int | None = None
    language: str | None = None
    tags: list[str] | None = None
    visibility: str | None = None
    allowed_user_emails: list[str] | None = None
    discussion_visibility: str | None = None
    discussion_allowed_user_emails: list[str] | None = None


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
    place_name: str = ""
    place_lat: float | None = None
    place_lon: float | None = None
    place_elevation_m: int | None = None
    place_bortle: float | None = None
    external_address: str = ""
    external_lat: float | None = None
    external_lon: float | None = None
    meeting_url: str = ""
    discord_url: str = ""
    geocache_url: str = ""
    radio_frequency: str = ""
    starts_at: datetime
    ends_at: datetime | None
    capacity: int
    organizer_email: str
    organizer_display_name: str = ""
    registration_count: int
    created_at: datetime
    tags: list[str] = []
    visibility: str = "public"
    allowed_user_emails: list[str] = []
    discussion_visibility: str = ""
    discussion_allowed_user_emails: list[str] = []
    # Local timezone resolved from GPS (place coords if linked,
    # external_lat/lon otherwise). Empty when coordinates are missing.
    timezone: str = ""


class RegistrationOut(Schema):
    id: UUID
    event_slug: str
    user_email: str
    user_display_name: str = ""
    status: str
    created_at: datetime


# ---- Event discussion (mirrors publishing.Comment shape) ----


from typing import Literal, Optional  # noqa: E402


class EventCommentAttachment(Schema):
    kind: Literal["image", "video", "youtube"]
    url: str = Field(min_length=1, max_length=500)
    mime: str = ""
    title: str = ""
    video_id: str = ""


class EventCommentIn(Schema):
    text: str = Field(default="", max_length=50_000)
    attachments: list[EventCommentAttachment] = []
    parent_id: Optional[UUID] = None


class EventCommentOut(Schema):
    id: UUID
    event_slug: str
    parent_id: Optional[UUID] = None
    user_display_name: str
    user_email: str = ""
    text: str
    attachments: list[EventCommentAttachment]
    created_at: datetime


class EventCommentListOut(Schema):
    count: int
    items: list[EventCommentOut]
