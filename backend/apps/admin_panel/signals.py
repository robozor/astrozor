"""Celery worker signals for the admin_panel app.

The PMTiles + light-pollution tile downloads are long-running Celery
tasks that update a `*_status=running` field in `MapInfra` as they
progress. If the worker container is recreated (container restart,
SIGKILL, OOM, image rebuild), the running task dies but the DB row
stays marked RUNNING — and no one ever re-triggers the work. The user
sees a "stuck" progress bar that hasn't advanced.

This module wires a `worker_ready` signal handler that runs at worker
startup, scans MapInfra for orphaned downloads, and re-dispatches the
relevant Celery tasks so they resume from wherever they left off.

Safety:
  - PMTiles task uses HTTP Range to resume from the existing `.part`
    file, so a re-trigger picks up at the current byte offset.
  - LP tile downloads skip already-cached tiles (`if tile_path.exists()`),
    so re-triggering only fetches the missing ones.
  - We guard against double-running by checking that the `.part` mtime
    is stale (>120 s) before re-triggering PMTiles.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from celery.signals import worker_ready

log = logging.getLogger(__name__)


@worker_ready.connect
def resume_orphaned_downloads(sender=None, **kwargs):
    """Safety net: detect downloads marked RUNNING in DB with no active
    writer, and re-dispatch them. Runs once when this worker process
    becomes ready to accept tasks."""
    # Lazy imports — signals fire after Django apps are loaded but we
    # still defer heavy imports to keep worker boot lean.
    try:
        from .models import MapInfra
        from .tasks import download_light_pollution_tiles, download_pmtiles
    except Exception as e:  # noqa: BLE001
        log.warning("worker_ready: import failed: %s", e)
        return

    try:
        infra = MapInfra.get()
    except Exception as e:  # noqa: BLE001
        log.warning("worker_ready: MapInfra fetch failed: %s", e)
        return

    now = time.time()

    # ---- PMTiles ----
    if infra.pmtiles_status == MapInfra.JobStatus.RUNNING:
        target = Path(infra.pmtiles_path)
        part = target.with_suffix(target.suffix + ".part")
        age = (now - part.stat().st_mtime) if part.exists() else float("inf")
        if age > 120:
            log.info(
                "worker_ready: PMTiles RUNNING but .part stale (%.0fs since last write) — retriggering",
                age if age != float("inf") else -1,
            )
            try:
                download_pmtiles.delay()
            except Exception as e:  # noqa: BLE001
                log.warning("worker_ready: failed to dispatch download_pmtiles: %s", e)
        else:
            log.info(
                "worker_ready: PMTiles RUNNING and .part is fresh (%.0fs ago) — leaving alone",
                age,
            )

    # ---- Light pollution tile downloads ----
    # The download_light_pollution_tiles task is idempotent: it skips
    # tiles already on disk, so re-triggering after a worker restart
    # just resumes from where we left off.
    for source, status_field in (
        ("black_marble_2016", "light_pollution_black_marble_status"),
        ("viirs_dnb_latest", "light_pollution_viirs_dnb_status"),
    ):
        if getattr(infra, status_field) == MapInfra.JobStatus.RUNNING:
            log.info(
                "worker_ready: LP %s RUNNING — retriggering (skips cached tiles)",
                source,
            )
            try:
                download_light_pollution_tiles.delay(source)
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "worker_ready: failed to dispatch LP %s: %s", source, e
                )
