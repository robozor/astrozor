from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class FeedSource(models.Model):
    class TargetKind(models.TextChoices):
        PLACE = "place", "Place"
        # PROJECT = "project", "Project"   # Krok 14

    class Kind(models.TextChoices):
        RSS = "rss", "RSS / Atom"
        MASTODON_HASHTAG = "mastodon_hashtag", "Mastodon hashtag"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    url = models.URLField(max_length=400)
    name = models.CharField(max_length=160, blank=True)
    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.RSS)
    target_kind = models.CharField(max_length=16, choices=TargetKind.choices, default=TargetKind.PLACE)
    target_id = models.CharField(max_length=64, help_text="Slug of target")
    poll_interval_seconds = models.IntegerField(default=1800)  # 30 min
    last_fetched_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=40, blank=True)
    last_error = models.TextField(blank=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="feed_sources"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "feeds_feedsource"
        ordering = ["-created_at"]
        unique_together = [("url", "target_kind", "target_id")]


class FeedItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(FeedSource, on_delete=models.CASCADE, related_name="items")
    guid = models.CharField(max_length=400, db_index=True)
    title = models.CharField(max_length=400)
    link = models.URLField(max_length=600)
    summary = models.TextField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "feeds_feeditem"
        ordering = ["-published_at", "-fetched_at"]
        unique_together = [("source", "guid")]
        indexes = [models.Index(fields=["source", "-fetched_at"])]
