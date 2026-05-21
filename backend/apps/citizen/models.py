from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from taggit.managers import TaggableManager

from apps.core.models import UUIDTaggedItem


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
    # Optional: a campaign can be a time-boxed sprint pointing at a
    # Zooniverse project we curate. When set, the campaign detail
    # replaces the in-house contribution form with a "Classify on
    # Zooniverse" CTA and surfaces leaderboards scoped to the window.
    zooniverse_project = models.ForeignKey(
        "citizen.ZooniverseProject",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="campaigns",
    )
    # Some Zooniverse projects have multiple workflows (subject sets);
    # the campaign can pin to one. Null = whole project.
    zooniverse_workflow_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = TaggableManager(blank=True, through=UUIDTaggedItem)

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


class SprintParticipant(models.Model):
    """Astrozor-side opt-in to a Zooniverse-linked sprint (Campaign with
    ``zooniverse_project`` set).

    Note that "joining" is purely an Astrozor signal — actual
    classification counting happens via ERAS, which only knows about
    Zooniverse group membership, not our sprint roster. We surface the
    participant count to give a sense of how many people committed to
    a given sprint, regardless of how many ultimately classified.

    Soft delete via ``left_at`` so we can keep history of who once
    joined, useful for retrospective sprint reports.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sprint = models.ForeignKey(
        "citizen.Campaign", on_delete=models.CASCADE, related_name="sprint_participants"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sprint_memberships",
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "citizen_sprint_participant"
        unique_together = [("sprint", "user")]
        indexes = [
            models.Index(fields=["sprint", "left_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.sprint_id}"


class ZooniverseProject(models.Model):
    """Catalogue of Zooniverse projects we curate for Astrozor users.

    Admin pastes a Zooniverse project ID into the curation surface; a
    background task fetches metadata via Panoptes ``GET /projects/{id}``
    and fills the cached fields. ``is_featured`` controls visibility on
    the Citizen Science tile grid.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    zooniverse_id = models.PositiveIntegerField(unique=True)
    # Cached from Panoptes — full slug is "owner/short" (e.g. "zookeeper/galaxy-zoo")
    slug = models.CharField(max_length=200, blank=True)
    title = models.CharField(max_length=200, blank=True)
    owner_login = models.CharField(max_length=120, blank=True)
    description = models.TextField(blank=True)
    introduction = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    background_url = models.URLField(blank=True)
    primary_language = models.CharField(max_length=8, blank=True)
    state = models.CharField(max_length=20, blank=True)
    # Last-seen total classifications from Panoptes (separate from the
    # ERAS snapshot — Panoptes value is project-page-style "all time").
    classifications_count = models.BigIntegerField(default=0)
    # Cached workflows from Panoptes — list of dicts:
    # ``[{"id": 28504, "display_name": "JWST COSMOS", "active": True,
    #     "completeness": 0.07}, ...]``
    # Active workflows drive the per-workflow "Classify" buttons on the
    # project detail; inactive ones are kept for historical reference.
    workflows = models.JSONField(default=list, blank=True)
    workflows_synced_at = models.DateTimeField(null=True, blank=True)
    # Project lifecycle flags from Panoptes — used to detect "zombie"
    # projects (state=live but launch_approved=False), typically old
    # research-team projects whose active_workflows flag stuck around
    # after the subject sets were emptied. The classify page renders
    # blank for these because there's nothing left to show.
    launch_approved = models.BooleanField(default=True)
    beta_approved = models.BooleanField(default=False)
    subjects_count = models.PositiveIntegerField(default=0)
    # Astrozor curation surface
    is_featured = models.BooleanField(default=True)
    astrozor_curator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="curated_zooniverse_projects",
    )
    tags = TaggableManager(blank=True, through=UUIDTaggedItem)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "citizen_zooniverse_project"
        ordering = ["-is_featured", "-classifications_count"]
        indexes = [
            models.Index(fields=["is_featured", "-classifications_count"]),
        ]

    def __str__(self) -> str:
        return f"{self.title or self.slug or self.zooniverse_id}"

    @property
    def zooniverse_url(self) -> str:
        if self.slug:
            return f"https://www.zooniverse.org/projects/{self.slug}"
        return f"https://www.zooniverse.org/projects/{self.zooniverse_id}"


class ZooniverseGroup(models.Model):
    """Astrozor's canonical Zooniverse user_group (one row, ID 2914377).

    We only ever have one. The singleton row stores a cached
    ``join_token`` and ``stats_visibility`` so the frontend can render
    the join CTA without hitting Panoptes on every page load.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    zooniverse_group_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=120, default="Astrozor")
    display_name = models.CharField(max_length=200, blank=True)
    join_token = models.CharField(max_length=120, blank=True)
    stats_visibility = models.CharField(max_length=40, blank=True)
    member_count = models.PositiveIntegerField(default=0)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "citizen_zooniverse_group"

    def __str__(self) -> str:
        return f"{self.name} (#{self.zooniverse_group_id})"

    @property
    def join_url(self) -> str:
        if not self.join_token:
            return f"https://www.zooniverse.org/groups/{self.zooniverse_group_id}"
        return (
            f"https://www.zooniverse.org/groups/{self.zooniverse_group_id}"
            f"/join?join_token={self.join_token}"
        )

    @property
    def public_url(self) -> str:
        return f"https://www.zooniverse.org/groups/{self.zooniverse_group_id}"


class ZooniverseStatsSnapshot(models.Model):
    """Time-series cache of ERAS classification counts.

    Keyed by (subject_type, subject_id, period, date). ``date`` is the
    bucket start for periodic rows ("2026-05-19" for a day bucket) and
    ``None`` for the rolling lifetime total — but a NULL primary-key
    field is awkward, so we use sentinel ``1970-01-01`` to mean
    "all-time" and document it on the model.

    Subject types:
      * ``"project"`` — public ERAS, subject_id = zooniverse_project_id
      * ``"group"``   — ERAS group endpoint, subject_id = group ID
      * ``"user"``    — per-user ERAS, subject_id = Zooniverse user_id

    Period choices match ERAS: ``"total"``, ``"day"``, ``"week"``,
    ``"month"``, ``"year"``.
    """

    SENTINEL_TOTAL_DATE = "1970-01-01"

    class Subject(models.TextChoices):
        PROJECT = "project", "Project"
        GROUP = "group", "Group"
        USER = "user", "User"

    class Period(models.TextChoices):
        TOTAL = "total", "Total"
        DAY = "day", "Day"
        WEEK = "week", "Week"
        MONTH = "month", "Month"
        YEAR = "year", "Year"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_type = models.CharField(max_length=10, choices=Subject.choices)
    subject_id = models.BigIntegerField()
    period = models.CharField(max_length=8, choices=Period.choices)
    date = models.DateField()
    count = models.BigIntegerField(default=0)
    time_spent_s = models.PositiveIntegerField(null=True, blank=True)
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "citizen_zooniverse_stats_snapshot"
        unique_together = [("subject_type", "subject_id", "period", "date")]
        indexes = [
            models.Index(fields=["subject_type", "subject_id", "period", "date"]),
        ]
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"{self.subject_type}#{self.subject_id} {self.period}@{self.date} = {self.count}"
