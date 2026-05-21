from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("admin_panel", "0002_alter_mapinfra_pmtiles_source_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="mapinfra",
            name="light_pollution_source",
            field=models.CharField(
                choices=[
                    ("black_marble_2016", "NASA Black Marble 2016 (static)"),
                    ("viirs_dnb_latest", "VIIRS DNB latest (manual refresh)"),
                ],
                default="black_marble_2016",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="light_pollution_dnb_date",
            field=models.CharField(
                blank=True,
                help_text="YYYY-MM-DD of the active VIIRS DNB nightly composite",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="light_pollution_last_check",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="light_pollution_status_message",
            field=models.TextField(blank=True),
        ),
    ]
