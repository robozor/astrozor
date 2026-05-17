from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class MessageIn(Schema):
    text: str = Field(min_length=1, max_length=2000)


class MessageOut(Schema):
    id: UUID
    place_slug: str
    user_display_name: str
    user_email: str
    text: str
    created_at: datetime


class MessageListOut(Schema):
    count: int
    items: list[MessageOut]
