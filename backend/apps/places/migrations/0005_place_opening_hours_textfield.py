from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("places", "0004_place_opening_hours_schedule"),
    ]

    operations = [
        migrations.AlterField(
            model_name="place",
            name="opening_hours",
            field=models.TextField(blank=True),
        ),
    ]
