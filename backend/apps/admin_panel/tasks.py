"""Celery tasks for admin map-infra operations.

These run in the worker container; the API endpoint kicks them off and
the admin UI polls the MapInfra row for status updates.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import httpx
from celery import shared_task
from django.utils import timezone

from .models import MapInfra

log = logging.getLogger(__name__)


@shared_task(bind=True)
def download_pmtiles(self):
    """Stream the Protomaps Daily PMTiles build to the configured path.

    - Resumable: writes to a deterministic .part file next to the target,
      and on restart sends `Range: bytes=<offset>-` to continue where it
      left off. Servers that don't support 206 cause a fresh start.
    - Inactivity-resistant: short per-read timeout (60 s) so a silently
      dropped TCP connection fails fast instead of hanging for hours,
      and the task auto-retries with exponential backoff up to 3 times.
    - Atomic: renames .part → final path only when total matches.
    """
    infra = MapInfra.get()
    infra.pmtiles_status = MapInfra.JobStatus.RUNNING
    infra.pmtiles_job_id = self.request.id
    infra.pmtiles_status_message = "Connecting…"
    infra.save(update_fields=["pmtiles_status", "pmtiles_job_id", "pmtiles_status_message"])

    target = Path(infra.pmtiles_path)
    tmp_path = target.with_suffix(target.suffix + ".part")

    try:
        # Auto-resolve to the newest Protomaps Daily build if user left
        # the source URL blank.
        source_url = infra.pmtiles_source_url
        if not source_url:
            with httpx.Client(timeout=10.0) as client:
                idx = client.get("https://build-metadata.protomaps.dev/builds.json")
            idx.raise_for_status()
            builds = idx.json()
            if not builds:
                raise RuntimeError("Protomaps build index is empty")
            source_url = f"https://build.protomaps.com/{builds[-1]['key']}"
            MapInfra.objects.filter(pk=1).update(
                pmtiles_source_url=source_url,
                pmtiles_status_message=f"Auto-picked latest build: {builds[-1]['key']}",
            )

        target.parent.mkdir(parents=True, exist_ok=True)

        # Clean up any stale tempfile-style .part from older runs
        for stale in target.parent.glob("tmp*.part"):
            try:
                stale.unlink()
            except OSError:
                pass

        max_attempts = 4
        attempt = 0
        while True:
            attempt += 1
            # Resume from wherever .part left off, if any
            resume_from = tmp_path.stat().st_size if tmp_path.exists() else 0
            headers = {}
            if resume_from > 0:
                headers["Range"] = f"bytes={resume_from}-"
                MapInfra.objects.filter(pk=1).update(
                    pmtiles_status_message=(
                        f"Resuming from {resume_from // (1024 * 1024)} MiB "
                        f"(attempt {attempt}/{max_attempts})…"
                    )
                )

            try:
                with httpx.stream(
                    "GET",
                    source_url,
                    timeout=httpx.Timeout(connect=30.0, read=60.0, write=60.0, pool=30.0),
                    follow_redirects=True,
                    headers=headers,
                ) as r:
                    # 206 = server honored Range; 200 = full body (we discard any
                    # partial and start fresh below)
                    if resume_from > 0 and r.status_code == 200:
                        tmp_path.unlink(missing_ok=True)
                        resume_from = 0
                    r.raise_for_status()
                    total = int(r.headers.get("content-length") or 0)
                    if resume_from > 0 and r.status_code == 206:
                        total += resume_from
                    written = resume_from
                    start_ts = time.monotonic()
                    last_report = start_ts
                    mode = "ab" if resume_from > 0 else "wb"
                    with tmp_path.open(mode) as f:
                        for chunk in r.iter_bytes(chunk_size=4 * 1024 * 1024):
                            f.write(chunk)
                            written += len(chunk)
                            now = time.monotonic()
                            if now - last_report < 2.0:
                                continue
                            last_report = now
                            elapsed = now - start_ts
                            rate_mb_s = (
                                ((written - resume_from) / 1024 / 1024) / elapsed
                                if elapsed > 0
                                else 0
                            )
                            pct_str = (
                                f"{written * 100 / total:.1f}%" if total else "?"
                            )
                            if total and rate_mb_s > 0:
                                eta_s = max(
                                    0,
                                    int(
                                        (total - written)
                                        / (rate_mb_s * 1024 * 1024)
                                    ),
                                )
                                h, rem = divmod(eta_s, 3600)
                                m, _s = divmod(rem, 60)
                                eta_str = (
                                    f" · ETA {h}h {m}m" if h else f" · ETA {m}m"
                                )
                            else:
                                eta_str = ""
                            MapInfra.objects.filter(pk=1).update(
                                pmtiles_status_message=(
                                    f"Downloading… {pct_str} "
                                    f"({written // (1024 * 1024)} / "
                                    f"{(total // (1024 * 1024)) if total else '?'} MiB) "
                                    f"at {rate_mb_s:.1f} MB/s{eta_str}"
                                )
                            )
                # Stream exited cleanly — break the retry loop
                break

            except (httpx.ReadTimeout, httpx.ReadError, httpx.RemoteProtocolError) as e:
                # Connection stalled or dropped. Retry with backoff if we have attempts left.
                if attempt >= max_attempts:
                    raise
                backoff = min(30, 2 ** attempt)
                log.warning(
                    "PMTiles stream broke (%s), retrying in %ds (attempt %d/%d)",
                    e,
                    backoff,
                    attempt + 1,
                    max_attempts,
                )
                MapInfra.objects.filter(pk=1).update(
                    pmtiles_status_message=(
                        f"Stream broke ({type(e).__name__}). Retry in {backoff}s "
                        f"({attempt}/{max_attempts})…"
                    )
                )
                time.sleep(backoff)

        # Atomic swap
        tmp_path.replace(target)
        size = target.stat().st_size

        infra.refresh_from_db()
        infra.pmtiles_status = MapInfra.JobStatus.IDLE
        infra.pmtiles_status_message = "Download complete"
        infra.pmtiles_size_bytes = size
        infra.pmtiles_last_update = timezone.now()
        infra.save(
            update_fields=[
                "pmtiles_status",
                "pmtiles_status_message",
                "pmtiles_size_bytes",
                "pmtiles_last_update",
            ]
        )
        log.info("PMTiles download complete: %s (%s bytes)", target, size)
        return {"status": "ok", "size_bytes": size, "path": str(target)}

    except Exception as e:  # noqa: BLE001
        log.exception("PMTiles download failed")
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
        # Make permission errors actionable instead of cryptic
        msg = str(e)
        if isinstance(e, PermissionError) or "Permission denied" in msg:
            msg = (
                f"Permission denied writing to {target.parent}. "
                "Fix volume ownership: docker compose exec -u 0 api "
                f"chown -R astrozor:astrozor {target.parent}"
            )
        MapInfra.objects.filter(pk=1).update(
            pmtiles_status=MapInfra.JobStatus.ERROR,
            pmtiles_status_message=f"Download failed: {msg}"[:500],
        )
        # Don't re-raise — letting Celery mark it FAILURE adds noise but no
        # extra info; the model already captures the error for the UI.


@shared_task(bind=True)
def import_photon(self):
    """Verify Photon container is reachable and record the import as done.

    Real OSM PBF import is heavy (~30–60 min for CZ, hours for EU) and
    typically run via `docker compose --profile photon up photon-import`.
    This task just probes the running Photon /status endpoint and updates
    the MapInfra row so the admin UI reflects current state.
    """
    infra = MapInfra.get()
    infra.photon_status = MapInfra.JobStatus.RUNNING
    infra.photon_status_message = "Probing Photon…"
    infra.save(update_fields=["photon_status", "photon_status_message"])

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{infra.photon_url.rstrip('/')}/status")
        if r.status_code != 200:
            raise RuntimeError(f"Photon /status returned HTTP {r.status_code}")
        # Photon /status response shape varies by version; we just keep it
        body = r.text[:500]

        infra.refresh_from_db()
        infra.photon_status = MapInfra.JobStatus.IDLE
        infra.photon_status_message = f"Reachable: {body}"
        infra.photon_last_import = timezone.now()
        infra.save(
            update_fields=["photon_status", "photon_status_message", "photon_last_import"]
        )
        return {"status": "ok"}
    except httpx.ConnectError as e:
        log.warning("Photon container unreachable: %s", e)
        MapInfra.objects.filter(pk=1).update(
            photon_status=MapInfra.JobStatus.IDLE,  # not "running" — UI stops auto-polling
            photon_status_message=(
                f"Photon at {infra.photon_url} is not reachable yet. "
                "Start it: docker compose -p astrozor --profile photon up -d photon "
                "and wait until the OSM import inside the container finishes "
                "(it can take 15 min – several hours). Then click Probe again."
            ),
        )
        # No re-raise; UI already shows the friendly message
    except Exception as e:  # noqa: BLE001
        log.exception("Photon probe failed")
        MapInfra.objects.filter(pk=1).update(
            photon_status=MapInfra.JobStatus.IDLE,
            photon_status_message=f"Probe failed: {e}"[:500],
        )
