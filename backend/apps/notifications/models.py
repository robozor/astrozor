from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class Subscription(models.Model):
    """User subscribes to a place (and later: project, event, tag)."""

    class Kind(models.TextChoices):
        PLACE = "place", "Place"
        # PROJECT = "project", "Project"   # Krok 14
        # EVENT = "event", "Event"         # Krok 15

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscriptions"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PLACE)
    target_id = models.CharField(max_length=64, help_text="Slug or UUID of the target")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications_subscription"
        unique_together = [("user", "kind", "target_id")]
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["kind", "target_id"])]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.kind}:{self.target_id}"


class Notification(models.Model):
    """In-app inbox entry for one user."""

    class Kind(models.TextChoices):
        CHAT_MESSAGE = "chat.message", "Chat message"
        CHECKIN = "presence.checkin", "Check-in"
        # NEW_ARTICLE = "publishing.article", "New article"    # Krok 10
        # NEW_EVENT = "events.event", "New event"              # Krok 15
        # CAMPAIGN = "citizen.campaign", "Citizen campaign"    # Krok 16

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    source_kind = models.CharField(max_length=16, help_text="place / project / event …")
    source_id = models.CharField(max_length=64)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    link = models.CharField(max_length=200, blank=True, help_text="Frontend route, e.g. /places/<slug>")
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications_notification"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["user", "read_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.kind} {self.title[:30]}"
