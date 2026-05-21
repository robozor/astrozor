from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("citizen", "0006_zooniverseproject_workflows"),
    ]

    operations = [
        migrations.AddField(
            model_name="zooniverseproject",
            name="launch_approved",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="zooniverseproject",
            name="beta_approved",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="zooniverseproject",
            name="subjects_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
