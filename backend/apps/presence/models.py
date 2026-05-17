"""Checkin model — 'I am observing at this place right now'."""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def _default_expires_at():
    return timezone.now() + timedelta(hours=4)


class Checkin(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="checkins"
    )
    place = models.ForeignKey(
        "places.Place", on_delete=models.CASCADE, related_name="checkins"
    )
    comment = models.CharField(
        max_length=200, blank=True, help_text="Free text: 'M51 with 600s exposures'"
    )
    anonymous = models.BooleanField(default=False, help_text="Show as 'someone' on the map")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=_default_expires_at)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "presence_checkin"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["place", "expires_at"]),
            models.Index(fields=["user", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.place_id}"

    @property
    def is_active(self) -> bool:
        return self.ended_at is None and self.expires_at > timezone.now()

    def end(self):
        self.ended_at = timezone.now()
        self.save(update_fields=["ended_at"])
