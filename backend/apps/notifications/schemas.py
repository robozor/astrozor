from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema


class SubscriptionIn(Schema):
    kind: str = "place"
    target_id: str


class SubscriptionOut(Schema):
    id: UUID
    kind: str
    target_id: str
    created_at: datetime


class NotificationOut(Schema):
    id: UUID
    kind: str
    source_kind: str
    source_id: str
    title: str
    body: str
    link: str
    created_at: datetime
    read_at: datetime | None


class NotificationListOut(Schema):
    count: int
    unread_count: int
    items: list[NotificationOut]
