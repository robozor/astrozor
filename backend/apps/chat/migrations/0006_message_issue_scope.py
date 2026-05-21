"""Issue-chat scope on chat.Message.

Adds the third orthogonal scope: ``gh_repo + issue_number`` so an
Astrozor discussion can attach to a specific open GitHub issue. The
XOR check constraint widens from 2-way to 3-way — drop the old one,
add the new shape.
"""

from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0005_message_edited_at"),
        ("projects", "0004_ghrepo_release_contributors"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="gh_repo",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="issue_messages",
                to="projects.ghrepo",
            ),
        ),
        migrations.AddField(
            model_name="message",
            name="issue_number",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(
                fields=["gh_repo", "issue_number", "-created_at"],
                name="chat_messag_gh_repo_b1861d_idx",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="message",
            name="chat_message_scope_xor",
        ),
        migrations.AddConstraint(
            model_name="message",
            constraint=models.CheckConstraint(
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
        ),
    ]
