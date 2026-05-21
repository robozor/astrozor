from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0003_event_comment"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="meeting_url",
            field=models.URLField(blank=True, max_length=500),
        ),
    ]
