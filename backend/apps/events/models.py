from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from taggit.managers import TaggableManager

from apps.core.models import UUIDTaggedItem


class Event(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ANNOUNCED = "announced", "Announced"
        REGISTRATION_OPEN = "registration_open", "Registration open"
        REGISTRATION_CLOSED = "registration_closed", "Registration closed"
        IN_PROGRESS = "in_progress", "In progress"
        FINISHED = "finished", "Finished"
        CANCELLED = "cancelled", "Cancelled"

    class Kind(models.TextChoices):
        OBSERVATION = "observation", "Observation"
        EXHIBITION = "exhibition", "Exhibition"
        PROJECTION = "projection", "Projection"
        LECTURE = "lecture", "Lecture"
        WORKSHOP = "workshop", "Workshop"
        STAR_PARTY = "star_party", "Star party"
        CITIZEN_CAMPAIGN = "citizen_campaign", "Citizen campaign"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=160, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OBSERVATION)
    language = models.CharField(max_length=8, default="cs")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.DRAFT)
    place = models.ForeignKey(
        "places.Place", null=True, blank=True, on_delete=models.SET_NULL, related_name="events"
    )
    # External location — used when the event isn't at an Astrozor place
    # (off-site star party, public square, university hall, …). The user
    # either enters an address (which the form geocodes to lat/lon via
    # /api/v1/geocode) OR clicks a point on the map (lat/lon only, no
    # address). At most one of `place` / external_* is set.
    external_address = models.CharField(max_length=240, blank=True)
    external_lat = models.FloatField(null=True, blank=True)
    external_lon = models.FloatField(null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    # Optional online-meeting URL. Frontend has a one-click "generate
    # Jitsi room" helper that fills this with a random meet.jit.si URL,
    # but any URL the organizer pastes is fine (Zoom, Google Meet, …).
    meeting_url = models.URLField(blank=True, max_length=500)
    # Optional Discord channel / invite URL for event chat. Renders as
    # a 💬 icon in the list (lit when set). Free-form so the organizer
    # can paste an #channel link, a server invite, or a webhook URL.
    discord_url = models.URLField(blank=True, max_length=500)
    # Optional geocaching event link (geocaching.com/geocache/...) or
    # cache code (e.g. "GC1ABCDE"). Free text — code or full URL both
    # OK, frontend renders 🧭 icon lit when non-empty.
    geocache_url = models.CharField(blank=True, max_length=240)
    # Optional radio frequency for ham / CB / SDR meetups
    # (e.g. "145.500 MHz FM", "144.300 USB", "27.185 MHz CB"). Free-text
    # — modulation + tone optional. Renders 📻 icon lit when filled.
    radio_frequency = models.CharField(blank=True, max_length=80)
    capacity = models.IntegerField(default=0, help_text="0 = unlimited")
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="organized_events"
    )
    # ---- Visibility / permissions ----
    # See apps/core/visibility.py for the shared 4-level system used by
    # Place and Event (and Project/Campaign once implemented). Discussion
    # (event comments) is gated independently — empty
    # `discussion_visibility` inherits from `visibility`.
    visibility = models.CharField(
        max_length=12,
        choices=[
            ("public", "Public"),
            ("members", "Members"),
            ("allowlist", "Selected members"),
            ("private", "Private"),
        ],
        default="public",
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="allowed_events",
    )
    discussion_visibility = models.CharField(
        max_length=12,
        choices=[
            ("public", "Public"),
            ("members", "Members"),
            ("allowlist", "Selected members"),
            ("private", "Private"),
        ],
        blank=True,
        default="",
        help_text="Empty = inherit from `visibility`",
    )
    discussion_allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="allowed_event_discussions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = TaggableManager(blank=True, through=UUIDTaggedItem)

    class Meta:
        db_table = "events_event"
        ordering = ["starts_at"]
        indexes = [
            models.Index(fields=["status", "starts_at"]),
            models.Index(fields=["kind"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


# Allowed transitions
# Transitions are bidirectional: the organizer can move an event to
# ANY other status (including backwards — e.g. CANCELLED → ANNOUNCED to
# reactivate, or REGISTRATION_OPEN → ANNOUNCED to pause sign-ups). Only
# self-loops are disallowed (status == status is a no-op).
_ALL_STATUSES = {
    Event.Status.DRAFT,
    Event.Status.ANNOUNCED,
    Event.Status.REGISTRATION_OPEN,
    Event.Status.REGISTRATION_CLOSED,
    Event.Status.IN_PROGRESS,
    Event.Status.FINISHED,
    Event.Status.CANCELLED,
}
TRANSITIONS: dict[str, set[str]] = {s: _ALL_STATUSES - {s} for s in _ALL_STATUSES}


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in TRANSITIONS.get(from_status, set())


class Comment(models.Model):
    """Event discussion — mirrors publishing.Comment / chat.Message shape
    so the same React ThreadedDiscussion component renders all three.
    Length limit shared via MapInfra.chat_text_max_length (admin-tunable).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_comments"
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    text = models.TextField(blank=True)
    # Same {kind: "image"|"video"|"youtube", url, mime?, title?, video_id?} shape
    # as chat / article comments — keeps the rich editor & sanitization shared.
    attachments = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "events_comment"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["event", "-created_at"]),
            models.Index(fields=["parent"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} on {self.event_id}"


class Registration(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="registrations")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="registrations"
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.CONFIRMED)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "events_registration"
        unique_together = [("event", "user")]
        ordering = ["created_at"]
