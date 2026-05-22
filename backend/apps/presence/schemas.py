from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema


class CheckinIn(Schema):
    comment: str = ""
    anonymous: bool = False
    expires_in_hours: int = 4  # 0.5..24


class CheckinOut(Schema):
    id: UUID
    user_email: str | None
    display_name: str
    comment: str
    anonymous: bool
    # True when the check-in belongs to the requesting user. Set even
    # for `anonymous=True` rows so the owner can see and end their own
    # anonymous check-in without exposing their identity to others.
    is_mine: bool = False
    source: str = "manual"
    place_slug: str
    created_at: datetime
    expires_at: datetime


class PresenceOut(Schema):
    place_slug: str
    count: int
    checkins: list[CheckinOut]
