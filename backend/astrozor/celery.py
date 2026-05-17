"""Celery app for background tasks."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "astrozor.settings")

app = Celery("astrozor")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Periodic schedule — Celery Beat
app.conf.beat_schedule = {
    "places-cleanup-expired-temporary": {
        "task": "places.cleanup_expired_temporary",
        "schedule": 300.0,  # every 5 min
    },
}


@app.task(bind=True)
def debug_task(self) -> None:
    print(f"Request: {self.request!r}")
