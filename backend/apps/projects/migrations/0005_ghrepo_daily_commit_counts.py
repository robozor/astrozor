"""Per-day commit counts cached on GHRepo.

Built from ``/repos/.../commits`` pagination (synchronous, unlike
GitHub's async ``/stats/commit_activity``). Drives the per-project
contribution graph without the cold-cache "still computing" state
we used to get from the stats endpoint.
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0004_ghrepo_release_contributors"),
    ]

    operations = [
        migrations.AddField(
            model_name="ghrepo",
            name="daily_commit_counts",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="commits_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
