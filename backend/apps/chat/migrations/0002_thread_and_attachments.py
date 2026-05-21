from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="replies",
                to="chat.message",
            ),
        ),
        migrations.AddField(
            model_name="message",
            name="attachments",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AlterField(
            model_name="message",
            name="text",
            field=models.TextField(blank=True, max_length=2000),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(fields=["parent"], name="chat_messag_parent__idx"),
        ),
    ]
