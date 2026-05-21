from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from taggit.managers import TaggableManager

from apps.core.models import UUIDTaggedItem


class Project(models.Model):
    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=120, unique=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PUBLIC)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    language = models.CharField(max_length=8, default="cs")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="projects_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = TaggableManager(blank=True, through=UUIDTaggedItem)

    class Meta:
        db_table = "projects_project"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MAINTAINER = "maintainer", "Maintainer"
        CONTRIBUTOR = "contributor", "Contributor"
        OBSERVER = "observer", "Observer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CONTRIBUTOR)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "projects_membership"
        unique_together = [("project", "user")]
        ordering = ["created_at"]


class GHRepo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="gh_repos")
    owner_login = models.CharField(max_length=80)
    repo_name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    stars = models.IntegerField(default=0)
    forks = models.IntegerField(default=0)
    language = models.CharField(max_length=40, blank=True)
    open_issues = models.IntegerField(default=0)
    default_branch = models.CharField(max_length=80, blank=True)
    last_commit_at = models.DateTimeField(null=True, blank=True)
    html_url = models.URLField(max_length=300, blank=True)
    last_fetched_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=40, blank=True)
    # Extended metadata refreshed alongside core fields by the
    # GitHub fetcher. Cached so the project page doesn't have to do
    # 3 extra GH calls per repo on every render.
    last_release_tag = models.CharField(max_length=120, blank=True)
    last_release_name = models.CharField(max_length=200, blank=True)
    last_release_at = models.DateTimeField(null=True, blank=True)
    last_release_url = models.URLField(max_length=300, blank=True)
    # Top contributors as a JSON array of
    # ``{"login", "avatar_url", "html_url", "contributions"}`` dicts —
    # rendered as avatar chips on the repo card.
    top_contributors = models.JSONField(default=list, blank=True)
    # GitHub repo topics ("repository topics" — the tag-like labels on
    # the repo page). Cached as a list of strings.
    topics = models.JSONField(default=list, blank=True)
    # Per-day commit counts for the last ~365 days, e.g.
    # ``{"2026-05-21": 4, "2026-05-20": 7, ...}``. Built from
    # ``/repos/.../commits`` pagination (synchronous, unlike the
    # async ``/stats/commit_activity`` we were using before). Cached
    # so the project-activity aggregator doesn't refetch on every
    # request — TTL handled via ``commits_synced_at``.
    daily_commit_counts = models.JSONField(default=dict, blank=True)
    commits_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "projects_ghrepo"
        unique_together = [("project", "owner_login", "repo_name")]
        ordering = ["owner_login", "repo_name"]

    @property
    def full_name(self) -> str:
        return f"{self.owner_login}/{self.repo_name}"
