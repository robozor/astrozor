"""Place model — observatories, permanent spots, temporary observation sites.

ADR-005: lat/lon stored as plain FloatField for MVP; migrate to PostGIS
geography(POINT, 4326) when spatial queries are needed.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

if TYPE_CHECKING:
    pass


class Place(models.Model):
    """A point on the map — fixed (observatory / spot) or temporary."""

    class Kind(models.TextChoices):
        OBSERVATORY_PUBLIC = "observatory_public", _("Public observatory")
        OBSERVATORY_PRIVATE = "observatory_private", _("Private observatory")
        SPOT_PERMANENT = "spot_permanent", _("Permanent observation spot")
        SPOT_TEMPORARY = "spot_temporary", _("Temporary observation spot")

    class Status(models.TextChoices):
        DRAFT = "draft", _("Draft")
        PUBLISHED = "published", _("Published")
        ARCHIVED = "archived", _("Archived")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=120, unique=True)
    name = models.CharField(max_length=160)
    kind = models.CharField(max_length=32, choices=Kind.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PUBLISHED)
    description = models.TextField(blank=True)
    lat = models.FloatField(help_text="Latitude (WGS84, -90..90)")
    lon = models.FloatField(help_text="Longitude (WGS84, -180..180)")
    elevation_m = models.IntegerField(null=True, blank=True)
    address = models.CharField(max_length=240, blank=True)
    website = models.URLField(blank=True)
    contact = models.CharField(max_length=160, blank=True)
    # Free-text "supplementary" note shown alongside the structured
    # weekly schedule (e.g. "Po dohodě", reservation link, seasonal
    # closure). TextField lets users break across lines without a
    # hard cap; previous CharField(160) was too tight for paragraph
    # notes.
    opening_hours = models.TextField(blank=True)
    # Structured weekly schedule. Shape:
    #   {"mon": {"intervals": [["08:00","12:00"], ["13:00","17:00"]],
    #            "auto_checkin": true}, "tue": {...}, ...}
    # When auto_checkin is true for a given day, the periodic beat task
    # creates an anonymous "Hvězdárna otevřena" check-in during the
    # listed intervals so the map reflects open hours without anyone
    # manually clicking Check-in. See apps/presence/tasks.tick_auto_checkins.
    opening_hours_schedule = models.JSONField(default=dict, blank=True)
    # Active Bortle reading from a human observer (or future SQM sensor).
    # Persisted as denormalized cache of the latest BortleMeasurement with
    # source='manual'. Authoritative when present.
    bortle_class_manual = models.FloatField(null=True, blank=True)
    # Active Bortle reading derived from the currently selected light-
    # pollution map source (Black Marble 2016 or VIIRS DNB latest). Cache
    # of the latest BortleMeasurement with a viirs_* source.
    bortle_class_map = models.FloatField(null=True, blank=True)
    bortle_class_map_source = models.CharField(max_length=24, blank=True)
    bortle_class_map_updated_at = models.DateTimeField(null=True, blank=True)
    # Deprecated single-value field. Kept temporarily so old API consumers
    # don't 500. Computed from manual ?? map at write time. Will be removed
    # once frontend has migrated to the dual-value display.
    bortle_class = models.FloatField(null=True, blank=True, help_text="Deprecated; use bortle_class_manual / bortle_class_map")

    # Owner / temporary lifetime
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_places",
    )
    valid_from = models.DateTimeField(null=True, blank=True, help_text="For temporary places")
    valid_to = models.DateTimeField(null=True, blank=True, help_text="For temporary places")

    # ---- Visibility / permissions ----
    # See apps/core/visibility.py for the shared 4-level system.
    # Discussion (chat) on a place is gated independently — when
    # `discussion_visibility` is blank, it inherits from `visibility`.
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
        related_name="allowed_places",
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
        related_name="allowed_place_discussions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "places_place"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["kind"]),
            models.Index(fields=["status"]),
            models.Index(fields=["lat", "lon"]),
            models.Index(fields=["valid_to"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.kind})"

    @property
    def is_temporary(self) -> bool:
        return self.kind == self.Kind.SPOT_TEMPORARY

    @property
    def is_expired(self) -> bool:
        return bool(self.valid_to and self.valid_to <= timezone.now())

    @property
    def is_visible(self) -> bool:
        if self.status != self.Status.PUBLISHED:
            return False
        if self.is_temporary and self.is_expired:
            return False
        return True


class BortleMeasurement(models.Model):
    """A historical Bortle reading for a place — either entered manually
    by an observer or auto-derived from a light-pollution model.

    Place.bortle_class is the "active" display value; it's set from the
    most recently relevant measurement (newest manual reading, falling
    back to the latest auto estimate). The history table lets users
    see how the rating changed over time.
    """

    class Source(models.TextChoices):
        MANUAL = "manual", _("Manual reading")
        VIIRS_BLACK_MARBLE = "viirs_black_marble", _("Auto: VIIRS Black Marble")
        VIIRS_DNB_LATEST = "viirs_dnb_latest", _("Auto: VIIRS DNB latest")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    place = models.ForeignKey(
        Place, on_delete=models.CASCADE, related_name="bortle_measurements"
    )
    value = models.FloatField(help_text="Bortle class 1..9")
    source = models.CharField(max_length=24, choices=Source.choices)
    measured_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)
    # For auto sources: luminance value the estimator sampled (for traceability)
    luminance = models.FloatField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bortle_measurements",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "places_bortle_measurement"
        ordering = ["-measured_at"]
        indexes = [
            models.Index(fields=["place", "-measured_at"]),
            models.Index(fields=["source"]),
        ]

    def __str__(self) -> str:
        return f"{self.place.slug} {self.source}={self.value} @ {self.measured_at:%Y-%m-%d}"
