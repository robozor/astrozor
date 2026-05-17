from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from ninja import Schema
from pydantic import Field


class CampaignCreateIn(Schema):
    project_slug: str
    title: str = Field(min_length=2, max_length=200)
    description: str = ""
    methodology: str = ""
    kind: str = "other"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    contribution_schema: dict[str, Any] = {}


class CampaignPatchIn(Schema):
    title: str | None = None
    description: str | None = None
    methodology: str | None = None
    kind: str | None = None
    status: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    contribution_schema: dict[str, Any] | None = None


class CampaignOut(Schema):
    id: UUID
    project_slug: str
    slug: str
    title: str
    description: str
    methodology: str
    kind: str
    status: str
    coordinator_email: str
    starts_at: datetime | None
    ends_at: datetime | None
    contribution_schema: dict[str, Any]
    contribution_count: int
    accepted_count: int
    created_at: datetime


class ContributionIn(Schema):
    title: str = ""
    data: dict[str, Any] = {}
    comment: str = ""


class ContributionReviewIn(Schema):
    status: str = Field(description="accepted, rejected, needs_revision")
    review_comment: str = ""


class ContributionOut(Schema):
    id: UUID
    campaign_slug: str
    user_email: str
    user_display_name: str
    title: str
    data: dict[str, Any]
    comment: str
    status: str
    review_comment: str
    reviewed_by_email: str | None
    reviewed_at: datetime | None
    created_at: datetime
