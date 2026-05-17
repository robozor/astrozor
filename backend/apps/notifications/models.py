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


class DiscordPreference(models.Model):
    """Per-user opt-in for which event types push a Discord webhook.

    Each row = one event kind a user wants to be notified about. The
    `filters` JSON column shape depends on `kind`:

      place_followed_checkin: {}                                (no filter)
      place_any_checkin:      {}
      article_published:      {author_emails: [str, ...]}        (empty = all)
      event_status_changed:   {
        organizer_emails: [str], event_slugs: [str], to_states: [str]
      }                                                          (each empty = no filter)
      project_lifecycle:      {actions: ["created","archived"]}  (empty = both)
      campaign_status_changed: {
        coordinator_emails: [str], campaign_slugs: [str], to_states: [str]
      }

    User must also have a discord_webhook_url in their Profile, else
    the dispatcher silently skips the row.
    """

    class Kind(models.TextChoices):
        PLACE_FOLLOWED_CHECKIN = "place_followed_checkin", "Check-in on followed place"
        PLACE_ANY_CHECKIN = "place_any_checkin", "Any check-in"
        ARTICLE_PUBLISHED = "article_published", "Article published"
        EVENT_STATUS_CHANGED = "event_status_changed", "Event status changed"
        PROJECT_LIFECYCLE = "project_lifecycle", "Project created/deleted"
        CAMPAIGN_STATUS_CHANGED = "campaign_status_changed", "Campaign status changed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="discord_preferences",
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    enabled = models.BooleanField(default=True)
    filters = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "notifications_discord_preference"
        unique_together = [("user", "kind")]
        ordering = ["kind"]


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
