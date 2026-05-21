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
    tags: list[str] = []


class ProjectPatchIn(Schema):
    """All fields optional — only those present in the JSON body are
    applied. Owner or staff only; the API gate is in ``api.py``.
    """

    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    visibility: str | None = None
    language: str | None = None
    status: str | None = None
    tags: list[str] | None = None


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
    tags: list[str] = []
    # True when the caller is in the project's Membership table.
    # Anonymous callers always get false.
    is_member: bool = False
    # True when the caller can edit the project (owner / created_by /
    # is_staff). Frontend uses this to gate the Edit button.
    can_edit: bool = False


class ProjectMemberOut(Schema):
    user_email: str
    user_display_name: str = ""
    avatar_url: str = ""
    role: str
    joined_at: datetime
    # True if this is the project creator (the user who can never be
    # auto-removed from membership).
    is_creator: bool = False


class GHContributorOut(Schema):
    """One GitHub user from the top-contributors cache."""

    login: str
    avatar_url: str = ""
    html_url: str = ""
    contributions: int = 0


class GHUserOut(Schema):
    """Slim GH user envelope used in issue / comment payloads."""

    login: str = ""
    avatar_url: str = ""
    html_url: str = ""


class GHIssueCommentOut(Schema):
    id: int = 0
    body_html: str = ""
    user: GHUserOut = GHUserOut()
    created_at: datetime | None = None
    updated_at: datetime | None = None
    html_url: str = ""


class GHIssueDetailOut(Schema):
    """Issue body + GitHub comments rendered ready for display.

    Body and each comment's ``body`` come back from GH as raw
    markdown; we render server-side via ``markdown-it`` + bleach
    with a GH-content host allowlist so the frontend can drop the
    sanitised HTML into ``dangerouslySetInnerHTML`` without further
    work.
    """

    status: str = "ok"
    number: int = 0
    title: str = ""
    state: str = "open"
    body_html: str = ""
    html_url: str = ""
    user: GHUserOut = GHUserOut()
    labels: list[dict] = []
    assignees: list[GHUserOut] = []
    milestone: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    comments_count: int = 0
    comments: list[GHIssueCommentOut] = []


class GHIssueCommentIn(Schema):
    """Body for posting a comment to the GH issue via Astrozor.

    Goes through the user's connected GitHub OAuth bearer
    (``apps.accounts.Identity``). Without a connected GH account the
    POST returns 200 with ``status="no_token"`` so the UI can prompt
    the user to connect.
    """

    body: str = Field(min_length=1, max_length=20_000)


class GHActivityBucket(Schema):
    """One day of aggregated commit count across all linked repos."""

    date: str
    count: int


class GHActivityOut(Schema):
    """Project-wide commit activity for the contribution graph.

    Aggregates ``/repos/.../stats/commit_activity`` across every
    linked GH repo. The series is fixed-length (one entry per day
    over the trailing 52 weeks) so the frontend can render the grid
    without empty-slot accounting.
    """

    days: int
    total_commits: int = 0
    buckets: list[GHActivityBucket] = []


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
    # Extended metadata cached on the repo row — refreshed alongside
    # the core fields by ``fetch_repo_metadata``.
    last_release_tag: str = ""
    last_release_name: str = ""
    last_release_at: datetime | None = None
    last_release_url: str = ""
    top_contributors: list[GHContributorOut] = []
    topics: list[str] = []
