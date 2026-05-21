from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from ninja import Schema
from pydantic import Field


class Attachment(Schema):
    # ``zoo_subject`` envelopes Zooniverse subject references in sprint
    # chat: subject_id, project_zid, cached locations, classify/talk
    # deep-links. ``url`` is optional in that case (mirrors locations[0]).
    kind: Literal["image", "video", "youtube", "zoo_subject"]
    url: str = Field(default="", max_length=500)
    mime: str = ""
    title: str = ""
    # youtube only
    video_id: str = ""
    # zoo_subject only — empty for other kinds
    subject_id: str = ""
    project_zid: int = 0
    # New canonical shape — list of {url, mime}. Falls back to
    # ``locations`` (legacy stored attachments without MIME).
    media: list[dict] = []
    locations: list[str] = []
    classify_url: str = ""
    talk_url: str = ""


class MessageIn(Schema):
    # Hard upper bound = 50 000 chars; the real (admin-configured) limit
    # is enforced via MapInfra.chat_text_max_length inside safe_text.
    text: str = Field(default="", max_length=50_000)
    attachments: list[Attachment] = []
    parent_id: Optional[UUID] = None


class MessageOut(Schema):
    id: UUID
    # Exactly one of {place_slug, sprint_slug, (repo_id + issue_number)}
    # is non-empty — whichever scope the message lives under.
    place_slug: str = ""
    sprint_slug: str = ""
    repo_id: str = ""
    issue_number: Optional[int] = None
    parent_id: Optional[UUID] = None
    user_display_name: str
    user_email: str
    text: str
    attachments: list[Attachment]
    created_at: datetime
    # Stamped on the first owner edit; ``None`` for never-edited
    # messages. UI shows an "(edited)" badge when non-null.
    edited_at: Optional[datetime] = None


class MessageEditIn(Schema):
    """Body for PATCH /messages/{id} — owner-only edit of a chat
    message. ``parent_id`` is intentionally absent: edits can change
    the content of a post but not where it threads under."""

    text: str = Field(default="", max_length=50_000)
    attachments: list[Attachment] = []


class MessageListOut(Schema):
    count: int
    items: list[MessageOut]
