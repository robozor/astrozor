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
    opening_hours = models.CharField(max_length=160, blank=True)
    bortle_class = models.FloatField(null=True, blank=True, help_text="Light pollution Bortle scale 1..9")

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
