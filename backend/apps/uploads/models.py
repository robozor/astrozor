from __future__ import annotations

import uuid
from pathlib import PurePosixPath

from django.conf import settings
from django.db import models


def _upload_path(instance: "Upload", filename: str) -> str:
    """Each user gets their own subfolder. UUID-named files prevent
    collisions and (mild) enumeration. Original extension preserved
    so the file is served with a sensible Content-Type by Django/Caddy.
    """
    ext = PurePosixPath(filename).suffix.lower() or ".bin"
    return f"uploads/{instance.user_id}/{instance.id}{ext}"


class Upload(models.Model):
    class Kind(models.TextChoices):
        IMAGE = "image", "Image"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="uploads",
    )
    file = models.FileField(upload_to=_upload_path, max_length=300)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.IMAGE)
    mime = models.CharField(max_length=80, blank=True)
    size_bytes = models.BigIntegerField(default=0)
    original_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "uploads_upload"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.kind}/{self.id} ({self.user_id})"
