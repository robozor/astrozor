"""Pydantic schemas for accounts API."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated
from uuid import UUID

from ninja import Schema
from pydantic import AfterValidator, Field

# Pragmatic email regex — accepts .localhost / .test TLDs (used in dev/E2E).
# Strict deliverability is enforced by SMTP, not by Pydantic validation.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email(value: str) -> str:
    value = value.strip()
    if not _EMAIL_RE.match(value):
        raise ValueError("not a valid email address")
    return value.lower()


Email = Annotated[str, AfterValidator(_check_email)]


# ---- Auth requests ----


class SignupIn(Schema):
    email: Email
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=80)


class LoginIn(Schema):
    email: Email
    password: str


class MagicLinkRequestIn(Schema):
    email: Email


# ---- Auth responses ----


class UserOut(Schema):
    id: UUID
    email: str
    email_verified: bool
    display_name: str
    created_at: datetime


class ProfileOut(Schema):
    display_name: str
    bio: str
    avatar_url: str
    club: str
    equipment: str
    language: str
    timezone_name: str
    location_lat: float | None
    location_lon: float | None
    location_label: str
    location_visibility: str
    discord_webhook_url: str
    storage_used_bytes: int
    storage_quota_bytes: int
    onboarding_completed: bool


class ProfilePatch(Schema):
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    club: str | None = None
    equipment: str | None = None
    language: str | None = None
    timezone_name: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    location_label: str | None = None
    location_visibility: str | None = None
    discord_webhook_url: str | None = None
    onboarding_completed: bool | None = None


class MeOut(Schema):
    user: UserOut
    profile: ProfileOut


class StatusOut(Schema):
    status: str
    detail: str = ""


class IdentityOut(Schema):
    id: UUID
    provider: str
    provider_user_id: str
    provider_username: str
    email: str
    display_name: str
    avatar_url: str
    has_token: bool
    last_login_at: datetime | None
    created_at: datetime
