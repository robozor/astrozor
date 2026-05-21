from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("publishing", "0002_comment_threads_attachments"),
    ]

    operations = [
        migrations.AddField(
            model_name="article",
            name="asset_root",
            field=models.CharField(blank=True, default="", max_length=240),
        ),
        migrations.AddField(
            model_name="article",
            name="asset_bytes",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="article",
            name="published_via",
            field=models.CharField(
                choices=[
                    ("web", "Web editor"),
                    ("rstudio", "RStudio addin"),
                    ("vscode", "VS Code extension"),
                    ("api", "Direct API"),
                ],
                default="web",
                max_length=16,
            ),
        ),
    ]
