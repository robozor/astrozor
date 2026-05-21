"""User, Profile, EmailToken models for the accounts app."""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """Astrozor user — email-based authentication, UUID primary key."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(_("email address"), unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    email_verified = models.BooleanField(default=False)
    # Last login origin (filled by signal handler in apps.accounts.signals).
    # GeoIP lookup is best-effort and cached 24 h per IP.
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    last_login_country = models.CharField(max_length=80, blank=True)
    last_login_country_code = models.CharField(max_length=4, blank=True)
    last_login_city = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        db_table = "auth_user"
        ordering = ["-created_at"]
        verbose_name = _("user")
        verbose_name_plural = _("users")

    def __str__(self) -> str:
        return self.email

    @property
    def display_name(self) -> str:
        profile = getattr(self, "profile", None)
        if profile and profile.display_name:
            return profile.display_name
        return self.email.split("@")[0]


class Profile(models.Model):
    """Extended user information."""

    class Visibility(models.TextChoices):
        PRECISE = "precise", _("Precise GPS")
        REGION = "region", _("Region only")
        HIDDEN = "hidden", _("Hidden")

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="profile",
        primary_key=True,
    )
    display_name = models.CharField(max_length=80, blank=True)
    bio = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    club = models.CharField(max_length=120, blank=True)
    equipment = models.TextField(blank=True, help_text=_("Free-form list of telescopes / cameras"))
    language = models.CharField(max_length=8, default="cs")
    timezone_name = models.CharField(max_length=64, default="Europe/Prague")
    # Location (default precise per Q6 decision; F-Auth-5)
    location_lat = models.FloatField(null=True, blank=True)
    location_lon = models.FloatField(null=True, blank=True)
    location_label = models.CharField(max_length=160, blank=True)
    location_visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.PRECISE
    )
    # Discord webhook (notification channel — see ADR-003)
    discord_webhook_url = models.URLField(blank=True)
    # Per-user Zenodo token — when set, the user's published articles get
    # DOIs minted on THEIR Zenodo account. When empty, falls back to the
    # platform-level ZENODO_SANDBOX_TOKEN env (dev) or MOCK.
    zenodo_token = models.CharField(max_length=200, blank=True)
    zenodo_use_sandbox = models.BooleanField(
        default=True, help_text="Use sandbox.zenodo.org instead of zenodo.org"
    )
    # Storage usage tracking (F-Auth-8)
    storage_used_bytes = models.BigIntegerField(default=0)
    storage_quota_bytes = models.BigIntegerField(default=5 * 1024 * 1024 * 1024)  # 5 GiB
    # When set, presence check-ins also post a status to the user's
    # connected Mastodon (best-effort, swallowed failure).
    mastodon_autopost_checkin = models.BooleanField(default=False)
    # Persisted Map → Ovládání state so the user lands in their preferred
    # view after login (tile style, place-kind filter, state filter,
    # light-pollution overlay toggle/opacity). Shape is opaque to the
    # backend — the frontend writes/reads its own structure.
    map_preferences = models.JSONField(default=dict, blank=True)
    onboarding_completed = models.BooleanField(default=False)
    # Timezone display preferences — every visible datetime in the app
    # is rendered in up to three flavours: UTC (canonical), "Local" (the
    # place / event's GPS-derived TZ) and the user's own TZ (above as
    # `timezone_name`). Each can be toggled off in Settings; defaults
    # are all-on so new users see the full triple by default.
    show_utc = models.BooleanField(default=True)
    show_local = models.BooleanField(default=True)
    show_user = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounts_profile"

    def __str__(self) -> str:
        return f"Profile of {self.user.email}"


def _generate_token() -> str:
    return secrets.token_urlsafe(48)


def _default_expiration() -> timezone.datetime:
    return timezone.now() + timedelta(hours=24)


class Identity(models.Model):
    """OAuth identity link — per-user, multiple providers allowed.

    Each row is owned by exactly one User. Stored access_token enables
    Astrozor to call the provider's API on the user's behalf (e.g. fetch
    their starred GitHub repos at 5000 req/h instead of anonymous 60).
    Disconnecting wipes the token but keeps the link history.
    """

    class Provider(models.TextChoices):
        GITHUB = "github", "GitHub"
        GOOGLE = "google", "Google"
        MASTODON = "mastodon", "Mastodon"
        DISCORD = "discord", "Discord"
        GITLAB = "gitlab", "GitLab"
        FACEBOOK = "facebook", "Facebook"
        ZOONIVERSE = "zooniverse", "Zooniverse"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="identities"
    )
    provider = models.CharField(max_length=16, choices=Provider.choices)
    provider_user_id = models.CharField(max_length=120)
    provider_username = models.CharField(max_length=120, blank=True)
    # For Mastodon (federated): which instance hosts this identity.
    # Empty for GitHub/Google.
    provider_instance = models.URLField(blank=True)
    email = models.EmailField()
    display_name = models.CharField(max_length=160, blank=True)
    avatar_url = models.URLField(blank=True)
    # Stored for "act on user's behalf" API calls. Production should
    # encrypt this column; MVP keeps it plaintext (admin-visible).
    # 2048 chars accommodates large JWTs (Zooniverse / Auth0 / Okta-style
    # tokens routinely exceed 1k chars). Earlier providers fit in 400
    # but we widen uniformly — Postgres varchar over a btree has no
    # noticeable cost at this size.
    access_token = models.CharField(max_length=2048, blank=True)
    # Refresh tokens used for providers whose access_tokens expire
    # (Zooniverse: ~2h). Other providers leave it empty.
    refresh_token = models.CharField(max_length=2048, blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list, blank=True)
    # For Discord: which guild (server) the user installed the Astrozor
    # bot into. Set during OAuth callback when scope=bot was requested.
    # Empty for providers that don't have a bot install concept.
    discord_guild_id = models.CharField(max_length=32, blank=True)
    discord_guild_name = models.CharField(max_length=120, blank=True)
    # For Zooniverse: denormalized membership flag for the canonical
    # Astrozor group (id from ZOONIVERSE_GROUP_ID env). Synced by a
    # Celery task every ~6 h and on-demand after a user clicks the
    # join-link so the UI can flip from "Join" to "Member" without a
    # full Panoptes round-trip.
    zooniverse_in_group = models.BooleanField(default=False)
    zooniverse_membership_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_identity"
        unique_together = [("provider", "provider_user_id", "provider_instance")]
        indexes = [
            models.Index(fields=["user", "provider"]),
            models.Index(fields=["email"]),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.provider_user_id} → {self.user_id}"


class MastodonInstance(models.Model):
    """Astrozor's OAuth app registered on a specific Mastodon instance.

    Mastodon supports dynamic app registration via POST /api/v1/apps. We
    register once per instance (the first time any user wants to connect a
    Mastodon account on that instance) and cache the resulting client_id /
    client_secret here. No platform-wide credentials needed.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    base_url = models.URLField(unique=True, max_length=200, help_text="e.g. https://mastodon.social")
    client_id = models.CharField(max_length=200)
    client_secret = models.CharField(max_length=200)
    vapid_key = models.CharField(max_length=200, blank=True)
    name = models.CharField(max_length=160, blank=True, help_text="Display name from the instance")
    redirect_uri = models.URLField(max_length=400, help_text="The redirect we registered with")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounts_mastodon_instance"
        ordering = ["base_url"]

    def __str__(self) -> str:
        return self.base_url


class EmailToken(models.Model):
    """One-time token sent via e-mail (magic link, verification, password reset)."""

    class Purpose(models.TextChoices):
        VERIFY = "verify", _("Email verification")
        MAGIC_LINK = "magic_link", _("Magic link login")
        RESET = "reset", _("Password reset")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="email_tokens")
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    token = models.CharField(max_length=128, unique=True, default=_generate_token)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=_default_expiration)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_email_token"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "purpose"]),
        ]

    def __str__(self) -> str:
        return f"{self.purpose} token for {self.user.email}"

    @property
    def is_valid(self) -> bool:
        return self.consumed_at is None and self.expires_at > timezone.now()

    def consume(self) -> None:
        self.consumed_at = timezone.now()
        self.save(update_fields=["consumed_at"])
