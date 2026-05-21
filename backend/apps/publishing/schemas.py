from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class ArticleCreateIn(Schema):
    title: str = Field(min_length=2, max_length=200)
    summary: str = Field(default="", max_length=450)
    content_md: str = ""
    engine: str = "markdown"
    language: str = "cs"
    tags: list[str] = []
    cover_image_url: str = ""
    visibility: str = "public"


class ArticlePatchIn(Schema):
    title: str | None = None
    summary: str | None = Field(default=None, max_length=450)
    content_md: str | None = None
    engine: str | None = None
    language: str | None = None
    tags: list[str] | None = None
    cover_image_url: str | None = None
    visibility: str | None = None


class ArticleOut(Schema):
    id: UUID
    slug: str
    title: str
    summary: str
    engine: str
    language: str
    status: str
    author_email: str
    author_display_name: str
    license: str
    doi: str
    content_md: str
    content_html: str
    # Empty for plain markdown; "/media/quarto/<user>/<slug>/index.html"
    # for pre-rendered bundles. Frontend renders iframe when non-empty.
    asset_url: str = ""
    published_via: str = "web"
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    tags: list[str] = []
    cover_image_url: str = ""
    visibility: str = "public"
    reading_minutes: int = 0


class ArticleListItem(Schema):
    id: UUID
    slug: str
    title: str
    summary: str
    engine: str = "markdown"
    language: str
    status: str
    author_display_name: str
    author_email: str = ""
    doi: str
    published_at: datetime | None
    created_at: datetime
    tags: list[str] = []
    cover_image_url: str = ""
    visibility: str = "public"
    reading_minutes: int = 0


class ArticleListOut(Schema):
    count: int
    items: list[ArticleListItem]


from typing import Literal, Optional


class CommentAttachment(Schema):
    kind: Literal["image", "video", "youtube"]
    url: str = Field(min_length=1, max_length=500)
    mime: str = ""
    title: str = ""
    video_id: str = ""


class CommentIn(Schema):
    text: str = Field(default="", max_length=50_000)
    attachments: list[CommentAttachment] = []
    parent_id: Optional[UUID] = None


class CommentOut(Schema):
    id: UUID
    article_slug: str
    parent_id: Optional[UUID] = None
    user_display_name: str
    user_email: str = ""
    text: str
    attachments: list[CommentAttachment]
    created_at: datetime


class CommentListOut(Schema):
    count: int
    items: list[CommentOut]
