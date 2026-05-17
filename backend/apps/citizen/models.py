from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class Campaign(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        OPEN = "open", "Open"
        # Temporarily not accepting submissions (weather, organizer absent,
        # equipment issue) — UI keeps the campaign visible but disables the
        # submit form. Resume by flipping back to OPEN.
        PAUSED = "paused", "Paused"
        CLOSED = "closed", "Closed"
        # All submitted contributions have been reviewed, coordinator
        # publishes a summary. Distinct from CLOSED (which may still have
        # pending reviews) and ARCHIVED (historical, hidden from default lists).
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    class Kind(models.TextChoices):
        ASTROMETRY = "astrometry", "Asteroid astrometry"
        PHOTOMETRY = "photometry", "Variable star photometry"
        OCCULTATION = "occultation", "Asteroid occultation"
        METEOR = "meteor", "Meteor showers"
        SOLAR = "solar", "Solar observation"
        SQM = "sqm", "Sky quality measurement"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="campaigns"
    )
    slug = models.SlugField(max_length=160, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    methodology = models.TextField(blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    coordinator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="campaigns_coordinated"
    )
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    # JSON schema describing one contribution row; free text for MVP
    contribution_schema = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "citizen_campaign"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class Contribution(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        NEEDS_REVISION = "needs_revision", "Needs revision"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name="contributions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="contributions"
    )
    title = models.CharField(max_length=200, blank=True)
    data = models.JSONField(default=dict, help_text="Payload conforming to campaign schema")
    comment = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    review_comment = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="contributions_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "citizen_contribution"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["campaign", "status"]),
            models.Index(fields=["campaign", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.campaign_id} ({self.status})"
