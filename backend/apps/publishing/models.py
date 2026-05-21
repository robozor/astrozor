from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone
from taggit.managers import TaggableManager

from apps.core.models import UUIDTaggedItem


class Article(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        REVIEW = "review", "Review"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    class Engine(models.TextChoices):
        MARKDOWN = "markdown", "Markdown"
        QUARTO = "quarto", "Quarto (pre-rendered)"
        RMARKDOWN = "rmarkdown", "R Markdown (pre-rendered)"
        JUPYTER = "jupyter", "Jupyter (pre-rendered)"

    class PublishedVia(models.TextChoices):
        WEB = "web", "Web editor"
        RSTUDIO = "rstudio", "RStudio addin"
        VSCODE = "vscode", "VS Code extension"
        API = "api", "Direct API"

    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public (visible to anonymous visitors)"
        MEMBERS = "members", "Members only (logged-in users)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=160, unique=True)
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=450, blank=True)
    # Optional URL to a cover image (usually an Upload). Resized server-side
    # to max 1600px width on first publish/update so the same URL serves
    # both the magazine hero (1200px) and grid thumbnails (400px).
    cover_image_url = models.URLField(max_length=500, blank=True, default="")
    # Audience gating — PUBLIC articles are visible to anonymous visitors
    # (so the index works as a public publication), MEMBERS are only
    # visible to logged-in Astrozor users.
    visibility = models.CharField(
        max_length=12,
        choices=Visibility.choices,
        default=Visibility.PUBLIC,
    )
    # Estimated reading minutes — computed from content length at save
    # time (Markdown) or set to 0 for pre-rendered bundles (we don't have
    # raw word count for those). Surfaced as "12 min" on cards.
    reading_minutes = models.PositiveSmallIntegerField(default=0)
    content_md = models.TextField(help_text="Raw Markdown source")
    content_html = models.TextField(blank=True, help_text="Rendered + sanitized HTML")
    engine = models.CharField(max_length=16, choices=Engine.choices, default=Engine.MARKDOWN)
    # Pre-rendered (Quarto/RMarkdown/Jupyter) bundles live on disk at
    # MEDIA_ROOT/{asset_root}/index.html with all referenced assets
    # preserved relative to the index. Empty for plain markdown articles.
    asset_root = models.CharField(max_length=240, blank=True, default="")
    # Tracks the bundle's on-disk byte size for quota accounting. Counted
    # against Profile.storage_used_bytes on publish/update/delete.
    asset_bytes = models.BigIntegerField(default=0)
    # Analytics — where did this article come from? Useful for understanding
    # adoption of editor vs RStudio vs VS Code paths.
    published_via = models.CharField(
        max_length=16,
        choices=PublishedVia.choices,
        default=PublishedVia.WEB,
    )
    language = models.CharField(max_length=8, default="cs")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="articles",
    )
    license = models.CharField(max_length=40, default="CC BY 4.0")
    doi = models.CharField(max_length=120, blank=True, help_text="Minted at publish time")
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = TaggableManager(blank=True, through=UUIDTaggedItem)

    class Meta:
        db_table = "publishing_article"
        ordering = ["-published_at", "-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["author", "status"]),
            models.Index(fields=["visibility", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class Comment(models.Model):
    """Article comment — mirrors the threaded chat.Message shape so both
    systems share the same rich editor, media attachments, and
    sanitization rules. Length limit is shared via MapInfra.chat_text_max_length."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments"
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    text = models.TextField(blank=True)
    # List of {kind: "image"|"video"|"youtube", url: str, mime?: str, title?: str, video_id?: str}
    attachments = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "publishing_comment"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["article", "-created_at"]),
            models.Index(fields=["parent"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} on {self.article_id}"
