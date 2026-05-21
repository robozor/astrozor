from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("citizen", "0005_zooniversegroup_campaign_zooniverse_workflow_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="zooniverseproject",
            name="workflows",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="zooniverseproject",
            name="workflows_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
