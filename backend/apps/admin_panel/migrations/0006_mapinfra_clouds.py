from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("admin_panel", "0005_mapinfra_chat_text_max_length"),
    ]

    operations = [
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_frame_count",
            field=models.PositiveSmallIntegerField(
                default=6,
                help_text=(
                    "Number of recent RainViewer satellite frames to expose "
                    "(1-hour window when steps are ~10 min apart)."
                ),
            ),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_cache_ttl_seconds",
            field=models.PositiveIntegerField(
                default=600,
                help_text=(
                    "How long to cache RainViewer's frame list (Redis). "
                    "600 s = 10 min matches RainViewer's update cadence."
                ),
            ),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_opacity_default",
            field=models.FloatField(
                default=0.5,
                help_text=(
                    "Default opacity of the cloud overlay (0..1). Users can "
                    "override with a slider in the map controls."
                ),
            ),
        ),
    ]
