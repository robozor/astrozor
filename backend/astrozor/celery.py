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
    "presence-cleanup-expired-checkins": {
        "task": "presence.cleanup_expired_checkins",
        "schedule": 60.0,  # every 60 s
    },
    "feeds-poll-due-sources": {
        "task": "feeds.poll_due_sources",
        "schedule": 600.0,  # every 10 min
    },
    "presence-tick-auto-checkins": {
        "task": "presence.tick_auto_checkins",
        "schedule": 300.0,  # every 5 min — refresh anonymous schedule-based check-ins
    },
    "citizen-sync-zooniverse-projects": {
        "task": "citizen.sync_zooniverse_projects",
        "schedule": 3600.0,  # 1 h — refresh featured Zooniverse projects
    },
    "citizen-sync-zooniverse-group": {
        "task": "citizen.sync_zooniverse_group",
        "schedule": 21600.0,  # 6 h — Astrozor group metadata + ERAS totals
    },
    "citizen-sync-zooniverse-membership": {
        "task": "citizen.sync_zooniverse_membership",
        "schedule": 21600.0,  # 6 h — flip Identity.zooniverse_in_group flags
    },
    "citizen-sync-zooniverse-user-stats": {
        "task": "citizen.sync_zooniverse_user_stats",
        "schedule": 21600.0,  # 6 h — per-user ERAS snapshots (opt-in profile display)
    },
}


@app.task(bind=True)
def debug_task(self) -> None:
    print(f"Request: {self.request!r}")
