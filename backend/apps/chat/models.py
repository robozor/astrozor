from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class Message(models.Model):
    """Threaded chat message scoped to *either* a Place, a Sprint, or
    a GitHub issue (repo + issue_number), enforced via the
    ``chat_message_scope_xor`` DB check constraint.

    Three orthogonal surfaces share this one model so deletion,
    sanitisation, and edit logic stay centralised in apps.chat. The
    visibility gate differs per scope:

    * place  → owner-controlled discussion visibility (apps.core)
    * sprint → active SprintParticipant only
    * issue  → project visibility (public → anyone; private → members)
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    place = models.ForeignKey(
        "places.Place",
        on_delete=models.CASCADE,
        related_name="messages",
        null=True,
        blank=True,
    )
    sprint = models.ForeignKey(
        "citizen.Campaign",
        on_delete=models.CASCADE,
        related_name="sprint_messages",
        null=True,
        blank=True,
    )
    gh_repo = models.ForeignKey(
        "projects.GHRepo",
        on_delete=models.CASCADE,
        related_name="issue_messages",
        null=True,
        blank=True,
    )
    # Per-issue threads identify by (gh_repo, issue_number). We don't
    # bridge through a separate "IssueThread" model — that was a
    # tempting abstraction we ruled out because the GHRepo + int pair
    # is already a stable identity and we don't need per-thread
    # metadata.
    issue_number = models.IntegerField(null=True, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_messages"
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    text = models.TextField(max_length=2000, blank=True)
    # List of attachment envelopes. Recognized kinds:
    #   * image / video    — internal MEDIA_URL uploads
    #   * youtube          — embedded video
    #   * zoo_subject      — Zooniverse subject reference (sprint chat only),
    #                        carries subject_id, project_zid, cached locations,
    #                        and deep-link URLs to classify + Talk.
    attachments = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Stamped on the first owner edit and refreshed on every subsequent
    # one. The UI surfaces this as an "(edited)" badge so readers can
    # tell when a message no longer matches its original posting.
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "chat_message"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["place", "-created_at"]),
            models.Index(fields=["sprint", "-created_at"]),
            models.Index(fields=["gh_repo", "issue_number", "-created_at"]),
            models.Index(fields=["parent"]),
        ]
        constraints = [
            # Exactly one of {place, sprint, (gh_repo+issue_number)}
            # must be set — never two, never none. Guards against
            # orphaned messages from a bad refactor.
            models.CheckConstraint(
                check=(
                    Q(
                        place__isnull=False,
                        sprint__isnull=True,
                        gh_repo__isnull=True,
                        issue_number__isnull=True,
                    )
                    | Q(
                        place__isnull=True,
                        sprint__isnull=False,
                        gh_repo__isnull=True,
                        issue_number__isnull=True,
                    )
                    | Q(
                        place__isnull=True,
                        sprint__isnull=True,
                        gh_repo__isnull=False,
                        issue_number__isnull=False,
                    )
                ),
                name="chat_message_scope_xor",
            ),
        ]

    def __str__(self) -> str:
        if self.place_id:
            scope = f"place={self.place_id}"
        elif self.sprint_id:
            scope = f"sprint={self.sprint_id}"
        else:
            scope = f"issue={self.gh_repo_id}#{self.issue_number}"
        return f"{self.user_id}@{scope}: {self.text[:30]}"
