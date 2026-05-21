from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("uploads", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="upload",
            name="kind",
            field=models.CharField(
                choices=[
                    ("image", "Image"),
                    ("video", "Video"),
                    ("other", "Other"),
                ],
                default="image",
                max_length=10,
            ),
        ),
    ]
