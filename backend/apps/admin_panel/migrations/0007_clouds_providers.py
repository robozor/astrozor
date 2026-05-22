from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("admin_panel", "0006_mapinfra_clouds"),
    ]

    operations = [
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_provider",
            field=models.CharField(
                max_length=20,
                default="disabled",
                choices=[
                    ("disabled", "Disabled"),
                    ("openweathermap", "OpenWeatherMap (snapshot)"),
                    ("eumetsat", "EUMETSAT Meteosat (animation, Europe)"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_openweathermap_api_key",
            field=models.CharField(max_length=200, blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_eumetsat_consumer_key",
            field=models.CharField(max_length=200, blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="mapinfra",
            name="clouds_eumetsat_consumer_secret",
            field=models.CharField(max_length=200, blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="mapinfra",
            name="clouds_frame_count",
            field=models.PositiveSmallIntegerField(
                default=6,
                help_text=(
                    "Frames to expose for animation. Only used by providers that "
                    "support historical frames (EUMETSAT). 1-hour window at ~10 min steps."
                ),
            ),
        ),
        migrations.AlterField(
            model_name="mapinfra",
            name="clouds_cache_ttl_seconds",
            field=models.PositiveIntegerField(
                default=600,
                help_text=(
                    "How long to cache the provider's frame list (Redis). "
                    "600 s = 10 min matches typical provider update cadence."
                ),
            ),
        ),
        migrations.AlterField(
            model_name="mapinfra",
            name="clouds_opacity_default",
            field=models.FloatField(
                default=0.5,
                help_text=(
                    "Default opacity of the cloud overlay (0..1). "
                    "User-overridable."
                ),
            ),
        ),
    ]
