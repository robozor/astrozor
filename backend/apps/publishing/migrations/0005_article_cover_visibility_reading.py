from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('publishing', '0004_article_tags'),
    ]

    operations = [
        migrations.AlterField(
            model_name='article',
            name='summary',
            field=models.CharField(blank=True, max_length=450),
        ),
        migrations.AddField(
            model_name='article',
            name='cover_image_url',
            field=models.URLField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='article',
            name='visibility',
            field=models.CharField(
                choices=[
                    ('public', 'Public (visible to anonymous visitors)'),
                    ('members', 'Members only (logged-in users)'),
                ],
                default='public',
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name='article',
            name='reading_minutes',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddIndex(
            model_name='article',
            index=models.Index(
                fields=['visibility', 'status'],
                name='publishing__visibil_idx',
            ),
        ),
    ]
