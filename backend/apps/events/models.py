from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


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
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    capacity = models.IntegerField(default=0, help_text="0 = unlimited")
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="organized_events"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
TRANSITIONS: dict[str, set[str]] = {
    Event.Status.DRAFT: {Event.Status.ANNOUNCED, Event.Status.CANCELLED},
    Event.Status.ANNOUNCED: {
        Event.Status.REGISTRATION_OPEN,
        Event.Status.REGISTRATION_CLOSED,
        Event.Status.CANCELLED,
    },
    Event.Status.REGISTRATION_OPEN: {Event.Status.REGISTRATION_CLOSED, Event.Status.CANCELLED},
    Event.Status.REGISTRATION_CLOSED: {Event.Status.IN_PROGRESS, Event.Status.CANCELLED},
    Event.Status.IN_PROGRESS: {Event.Status.FINISHED, Event.Status.CANCELLED},
    Event.Status.FINISHED: set(),
    Event.Status.CANCELLED: set(),
}


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in TRANSITIONS.get(from_status, set())


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
