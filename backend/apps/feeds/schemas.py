from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema


class FeedSourceIn(Schema):
    url: str
    name: str = ""
    target_kind: str = "place"
    target_id: str
    poll_interval_seconds: int = 1800


class FeedSourceOut(Schema):
    id: UUID
    url: str
    name: str
    target_kind: str
    target_id: str
    poll_interval_seconds: int
    last_fetched_at: datetime | None
    last_status: str
    last_error: str
    created_at: datetime


class FeedItemOut(Schema):
    id: UUID
    source_id: UUID
    guid: str
    title: str
    link: str
    summary: str
    published_at: datetime | None
    fetched_at: datetime


class FeedItemListOut(Schema):
    count: int
    items: list[FeedItemOut]


class FetchResultOut(Schema):
    created: int
    updated: int
    status: str
