from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class ArticleCreateIn(Schema):
    title: str = Field(min_length=2, max_length=200)
    summary: str = ""
    content_md: str = ""
    engine: str = "markdown"
    language: str = "cs"


class ArticlePatchIn(Schema):
    title: str | None = None
    summary: str | None = None
    content_md: str | None = None
    engine: str | None = None
    language: str | None = None


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
    content_html: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ArticleListItem(Schema):
    id: UUID
    slug: str
    title: str
    summary: str
    language: str
    status: str
    author_display_name: str
    doi: str
    published_at: datetime | None
    created_at: datetime


class ArticleListOut(Schema):
    count: int
    items: list[ArticleListItem]


class CommentIn(Schema):
    text: str = Field(min_length=1, max_length=4000)


class CommentOut(Schema):
    id: UUID
    article_slug: str
    user_display_name: str
    text: str
    created_at: datetime


class CommentListOut(Schema):
    count: int
    items: list[CommentOut]
