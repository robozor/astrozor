from django.apps import AppConfig


class AdminPanelConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.admin_panel"

    def ready(self):
        # Wire the Celery worker_ready signal handler that auto-resumes
        # orphaned downloads (PMTiles, LP tiles) after worker restarts.
        # Import is at ready() time so Django apps registry is fully
        # initialized before the @worker_ready decorator runs.
        from . import signals  # noqa: F401
