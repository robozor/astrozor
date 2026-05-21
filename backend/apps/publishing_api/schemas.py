from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class TokenCreateIn(Schema):
    name: str = Field(min_length=2, max_length=120)
    scopes: list[str] = ["publish:articles"]


class TokenCreatedOut(Schema):
    id: UUID
    name: str
    prefix: str
    token: str  # plaintext — returned ONCE on creation
    scopes: list[str]
    created_at: datetime


class TokenOut(Schema):
    id: UUID
    name: str
    prefix: str
    scopes: list[str]
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class PublishManifest(Schema):
    """Subset of the publish manifest used by clients (CLI, Quarto provider, …)."""

    schema_version: str = "1"
    title: str = Field(min_length=2, max_length=200)
    summary: str = ""
    language: str = "cs"
    engine: str = "markdown"
    license: str = "CC BY 4.0"
    tags: list[str] = []
    # MVP: clients send rendered HTML as a string. Full multipart upload (assets) is Krok 17.x.
    html: str = ""
    # Optional Markdown source (preserved for editing if engine == markdown)
    content_md: str | None = None


class PublishResult(Schema):
    article_slug: str
    article_id: UUID
    doi: str
    status: str
    url: str


class QuartoPublishResult(Schema):
    """Reply for POST /publish/quarto — same as PublishResult plus the
    asset_url so the addin can preview the rendered page."""

    article_slug: str
    article_id: UUID
    status: str
    url: str
    asset_url: str  # /media/quarto/<user>/<slug>/index.html
