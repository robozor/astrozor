from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=160, unique=True)
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=400, blank=True)
    content_md = models.TextField(help_text="Raw Markdown source")
    content_html = models.TextField(blank=True, help_text="Rendered + sanitized HTML")
    engine = models.CharField(max_length=16, choices=Engine.choices, default=Engine.MARKDOWN)
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

    class Meta:
        db_table = "publishing_article"
        ordering = ["-published_at", "-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["author", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments"
    )
    text = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "publishing_comment"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["article", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.user_id} on {self.article_id}"
