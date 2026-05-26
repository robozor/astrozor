"""API tokens for the publish API (CLI / Quarto provider / VS Code / R)."""

from __future__ import annotations

import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models


def _generate_token() -> str:
    """One-time plaintext token returned to user; we store only the hash."""
    return f"ast_{secrets.token_urlsafe(40)}"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ApiToken(models.Model):
    class Scope(models.TextChoices):
        PUBLISH_ARTICLES = "publish:articles", "Publish articles"
        # PUBLISH_DATASETS = "publish:datasets", "Publish datasets"  # Krok 17.x
        READ_PROFILE = "read:profile", "Read profile"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens"
    )
    name = models.CharField(max_length=120, help_text="Human-readable label")
    token_hash = models.CharField(max_length=128, db_index=True, unique=True)
    prefix = models.CharField(max_length=12, help_text="First 8 chars of plaintext for UI")
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "publishing_api_token"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.prefix}…)"

    @property
    def is_active(self) -> bool:
        from django.utils import timezone

        if self.revoked_at:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return True

    @classmethod
    def create_for_user(cls, user, name: str, scopes: list[str] | None = None) -> tuple[ApiToken, str]:
        plaintext = _generate_token()
        token = cls.objects.create(
            user=user,
            name=name,
            token_hash=_hash(plaintext),
            prefix=plaintext[:8],
            scopes=scopes or [cls.Scope.PUBLISH_ARTICLES],
        )
        return token, plaintext

    @classmethod
    def find_active(cls, plaintext: str) -> ApiToken | None:
        try:
            tok = cls.objects.select_related("user").get(token_hash=_hash(plaintext))
        except cls.DoesNotExist:
            return None
        if not tok.is_active:
            return None
        return tok
