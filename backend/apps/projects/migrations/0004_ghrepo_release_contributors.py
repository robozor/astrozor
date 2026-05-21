"""Extended GH metadata cached on GHRepo.

Adds release info (tag, name, date, URL), top contributors snapshot,
and repository topics. All refreshed alongside the core metadata by
``apps.projects.github.fetch_repo_metadata``.
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0003_alter_project_tags"),
    ]

    operations = [
        migrations.AddField(
            model_name="ghrepo",
            name="last_release_tag",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="last_release_name",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="last_release_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="last_release_url",
            field=models.URLField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="top_contributors",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="ghrepo",
            name="topics",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
