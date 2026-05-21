"""Sprint chat scope for chat.Message.

Adds the second optional FK (``sprint -> citizen.Campaign``) and
relaxes ``place`` to nullable so a message can live under either
scope. A CheckConstraint pins the invariant: exactly one of
``(place, sprint)`` is set.

Existing rows all have ``place`` set, so the new constraint is
satisfied immediately — no data migration needed.
"""

from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0003_rename_chat_messag_parent__idx_chat_messag_parent__ede592_idx"),
        # SprintParticipant + Campaign with zooniverse_project linkage
        # came in citizen.0008 — we need that migration first because
        # this one introduces the FK target.
        ("citizen", "0008_sprintparticipant"),
    ]

    operations = [
        migrations.AlterField(
            model_name="message",
            name="place",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="messages",
                to="places.place",
            ),
        ),
        migrations.AddField(
            model_name="message",
            name="sprint",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="sprint_messages",
                to="citizen.campaign",
            ),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(
                fields=["sprint", "-created_at"],
                name="chat_messag_sprint__245d49_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="message",
            constraint=models.CheckConstraint(
                check=(
                    Q(place__isnull=False, sprint__isnull=True)
                    | Q(place__isnull=True, sprint__isnull=False)
                ),
                name="chat_message_scope_xor",
            ),
        ),
    ]
