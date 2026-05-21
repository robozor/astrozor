"""Shared visibility / permission system used by multiple agendas
(Place, Event, Project, Campaign).

Four levels:

* ``public`` — visible to anonymous visitors
* ``members`` — visible to any logged-in Astrozor user
* ``allowlist`` — visible to the owner + explicit list of users
* ``private`` — visible only to the owner

Discussion (chat) on an entity is gated independently. Entities expose
``discussion_visibility`` (nullable) — when ``None`` the discussion
inherits from the entity's main visibility, when set it overrides.
A typical use is e.g. a PUBLIC place with MEMBERS-only discussion, or
a MEMBERS place with ALLOWLIST-only discussion among a club.

System administrators (``is_staff`` users) ALWAYS bypass all checks —
they can read every entity and every discussion.

Each consuming model should declare:

    visibility = models.CharField(
        max_length=12, choices=Visibility.choices, default=Visibility.PUBLIC,
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="+"
    )
    discussion_visibility = models.CharField(
        max_length=12, choices=Visibility.choices, blank=True, default="",
        help_text="Empty = inherit from `visibility`",
    )
    discussion_allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="+"
    )

The owner reference (FK to User) lives on each model under its own
name (Place.owner, Event.organizer, …). The helpers below take the
owner id directly so they stay model-agnostic.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterable

from django.db import models
from django.db.models import Q

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractUser


class Visibility(models.TextChoices):
    PUBLIC = "public", "Public — anyone, including anonymous"
    MEMBERS = "members", "Members — logged-in users"
    ALLOWLIST = "allowlist", "Selected members only"
    PRIVATE = "private", "Private — owner only"


def can_view(
    visibility: str,
    owner_id,
    allowed_user_ids: Iterable | None,
    viewer,
) -> bool:
    """Decide whether `viewer` is allowed to see an entity with the
    given visibility settings. Order of checks matters: staff is the
    very first gate so admins always pass regardless of the rules."""
    # Admins always pass — global override.
    if viewer is not None and viewer.is_authenticated and viewer.is_staff:
        return True
    if visibility == Visibility.PUBLIC:
        return True
    # Past this point we need authentication.
    if viewer is None or not viewer.is_authenticated:
        return False
    # Owner always sees their own entity.
    if owner_id is not None and viewer.id == owner_id:
        return True
    if visibility == Visibility.MEMBERS:
        return True
    if visibility == Visibility.ALLOWLIST:
        if allowed_user_ids is None:
            return False
        return viewer.id in set(allowed_user_ids)
    # PRIVATE — only owner (already short-circuited above).
    return False


def can_view_discussion(entity, viewer) -> bool:
    """Discussion visibility falls back to the entity's main visibility
    when ``discussion_visibility`` is empty. Allowed users are pulled
    from the matching M2M (``discussion_allowed_users`` when the
    discussion has its own setting, ``allowed_users`` when inheriting).
    """
    # Admin global override (cheap fast path before any DB pulls).
    if viewer is not None and viewer.is_authenticated and viewer.is_staff:
        return True

    main_vis = getattr(entity, "visibility", Visibility.PUBLIC)
    chat_vis = getattr(entity, "discussion_visibility", "") or ""

    if chat_vis:
        vis = chat_vis
        # Allowed users come from the chat-specific M2M only when the
        # discussion is independently set. Otherwise we inherit the
        # entity's main allowlist along with the visibility level.
        if vis == Visibility.ALLOWLIST:
            allowed = list(
                entity.discussion_allowed_users.values_list("id", flat=True)
            )
        else:
            allowed = None
    else:
        vis = main_vis
        if vis == Visibility.ALLOWLIST:
            allowed = list(entity.allowed_users.values_list("id", flat=True))
        else:
            allowed = None

    owner_id = _resolve_owner_id(entity)
    return can_view(vis, owner_id, allowed, viewer)


def _resolve_owner_id(entity):
    """Owner attribute name varies per model — Place.owner, Event.organizer.
    Walk a small list of conventions to find the right FK."""
    for attr in ("owner_id", "organizer_id", "coordinator_id", "created_by_id", "author_id"):
        if hasattr(entity, attr):
            return getattr(entity, attr)
    return None


def visibility_qs_filter(viewer, allowed_users_field: str = "allowed_users"):
    """Build a Q object for filtering a queryset of entities the
    `viewer` is allowed to see.

    `allowed_users_field` is the M2M field name on the model (defaults
    to "allowed_users"). Pass the discussion field name when filtering
    discussion-level queries (rare — discussion is queried per-entity).
    """
    if viewer is not None and viewer.is_authenticated and viewer.is_staff:
        # Admin sees everything — caller can skip filter entirely if
        # they want, but returning an always-true Q keeps API simple.
        return Q()

    q = Q(visibility=Visibility.PUBLIC)
    if viewer is None or not viewer.is_authenticated:
        return q
    # Logged-in users see members + their own + allowlist they're on.
    owner_field = _detect_owner_field(allowed_users_field)
    q |= Q(visibility=Visibility.MEMBERS)
    if owner_field:
        q |= Q(**{owner_field: viewer})
    q |= Q(visibility=Visibility.ALLOWLIST, **{allowed_users_field: viewer})
    return q


def _detect_owner_field(allowed_users_field: str) -> str | None:
    """Best-effort owner field detection. Caller can override by
    passing a custom Q at the call site if needed; this covers Place
    (owner) and Event (organizer) automatically. We only use the
    `allowed_users_field` as a hint — callers pass it as a string so
    we can't introspect the model here without an import."""
    # No reflection — return None and let callers add `Q(owner=viewer)`
    # explicitly when they need it. Keeping this stub for future use.
    return None
