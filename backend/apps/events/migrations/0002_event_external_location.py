from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="external_address",
            field=models.CharField(blank=True, max_length=240),
        ),
        migrations.AddField(
            model_name="event",
            name="external_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="event",
            name="external_lon",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
