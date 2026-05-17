from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Schema
from pydantic import Field


class ProjectIn(Schema):
    name: str = Field(min_length=2, max_length=160)
    description: str = ""
    visibility: str = "public"
    language: str = "cs"


class ProjectOut(Schema):
    id: UUID
    slug: str
    name: str
    description: str
    visibility: str
    status: str
    language: str
    created_by_email: str
    member_count: int
    repo_count: int
    created_at: datetime


class GHRepoIn(Schema):
    full_name: str = Field(description="owner/repo")


class GHRepoOut(Schema):
    id: UUID
    project_slug: str
    full_name: str
    description: str
    stars: int
    forks: int
    language: str
    open_issues: int
    default_branch: str
    last_commit_at: datetime | None
    html_url: str
    last_fetched_at: datetime | None
    last_status: str
