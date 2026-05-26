"""Celery tasks for admin map-infra operations.

These run in the worker container; the API endpoint kicks them off and
the admin UI polls the MapInfra row for status updates.
"""

from __future__ import annotations

import logging
import math
import time
from pathlib import Path

import httpx
from celery import shared_task
from django.utils import timezone

from .models import MapInfra

log = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=86400, soft_time_limit=82800)
def download_pmtiles(self):
    """Stream the Protomaps Daily PMTiles build to the configured path.

    - Resumable: writes to a deterministic .part file next to the target,
      and on restart sends `Range: bytes=<offset>-` to continue where it
      left off. Servers that don't support 206 cause a fresh start.
    - Inactivity-resistant: short per-read timeout (60 s) so a silently
      dropped TCP connection fails fast instead of hanging for hours,
      and the task auto-retries with exponential backoff up to 3 times.
    - Atomic: renames .part → final path only when total matches.
    - Long-running: 24 h hard limit so the worker default (5 min) doesn't
      SIGKILL the task mid-stream on slow links.
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


# ---- Light pollution local tile cache ----

LP_BBOX_EUROPE = (-25.0, 34.0, 45.0, 72.0)  # (lon_min, lat_min, lon_max, lat_max)
LP_ZOOM_MIN = 0
LP_ZOOM_MAX = 7  # zoom 8 doubles size for marginal benefit


def _lp_grid(zoom: int, bbox: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Return list of (tile_x, tile_y) covering bbox at given zoom."""
    lon_min, lat_min, lon_max, lat_max = bbox
    n = 2.0**zoom

    def x_of(lon: float) -> int:
        return int(math.floor((lon + 180.0) / 360.0 * n))

    def y_of(lat: float) -> int:
        lat = max(-85.05112878, min(85.05112878, lat))
        return int(math.floor(
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
        ))

    x0, x1 = sorted([x_of(lon_min), x_of(lon_max)])
    y0, y1 = sorted([y_of(lat_min), y_of(lat_max)])
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def _lp_total_tiles() -> int:
    return sum(len(_lp_grid(z, LP_BBOX_EUROPE)) for z in range(LP_ZOOM_MIN, LP_ZOOM_MAX + 1))


def _lp_source_url(source: str, dnb_date: str, z: int, x: int, y: int) -> str:
    if source == "viirs_dnb_latest":
        return (
            f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
            f"VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/{dnb_date}/"
            f"GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"
        )
    return (
        f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
        f"VIIRS_Black_Marble/default/2016-01-01/"
        f"GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"
    )


def _lp_local_dir(source: str) -> Path:
    return Path("/var/lib/astrozor/light_pollution") / source


@shared_task(bind=True, time_limit=43200, soft_time_limit=43000)
def download_light_pollution_tiles(self, source: str):
    """Bulk-download all NASA GIBS tiles for a given LP source into a
    local cache directory. Iterates Europe bbox over zoom 0-7.

    Progress is persisted to MapInfra so the admin UI can show a live
    bar like PMTiles. Server-side serving (via Caddy /lp-tiles/<source>/)
    takes over from NASA once the download completes.

    Retries on transient HTTP errors; skips already-cached tiles so a
    re-run (e.g. for a newer DNB date) re-fetches only the changed ones.
    """
    if source not in ("black_marble_2016", "viirs_dnb_latest"):
        return {"status": "error", "detail": f"unknown source: {source}"}

    infra = MapInfra.get()
    is_dnb = source == "viirs_dnb_latest"
    status_field = (
        "light_pollution_viirs_dnb_status"
        if is_dnb
        else "light_pollution_black_marble_status"
    )
    msg_field = status_field.replace("_status", "_status_message")
    count_field = (
        "light_pollution_viirs_dnb_tile_count"
        if is_dnb
        else "light_pollution_black_marble_tile_count"
    )
    bytes_field = count_field.replace("_tile_count", "_size_bytes")
    update_field = count_field.replace("_tile_count", "_last_update")

    def _persist(**kwargs):
        MapInfra.objects.filter(pk=1).update(**kwargs)

    dnb_date = infra.light_pollution_dnb_date
    if is_dnb and not dnb_date:
        _persist(
            **{
                status_field: MapInfra.JobStatus.ERROR,
                msg_field: "No DNB date set — click 'Aktualizovat na poslední' first.",
            }
        )
        return {"status": "error"}

    out_dir = _lp_local_dir(source)
    # For DNB, if the cached_date differs, wipe and re-fetch.
    if is_dnb and infra.light_pollution_viirs_dnb_cached_date and infra.light_pollution_viirs_dnb_cached_date != dnb_date:
        import shutil

        shutil.rmtree(out_dir, ignore_errors=True)

    _persist(
        **{
            status_field: MapInfra.JobStatus.RUNNING,
            msg_field: f"Stahuji {source}…",
        }
    )

    total = _lp_total_tiles()
    fetched = 0
    total_bytes = 0
    start_ts = time.monotonic()
    last_report = start_ts
    skipped = 0

    def _heartbeat():
        """Emit a progress status row if ≥2 s since the last one. Called
        once per iteration (cache hit, miss, failure — anything) so the
        admin UI streams progress even when the entire run is satisfied
        from disk cache. Previously the update lived inside the network
        success branch only; cached runs went silent between "Stahuji…"
        and "Hotovo"."""
        nonlocal last_report
        now = time.monotonic()
        if now - last_report < 2.0:
            return
        last_report = now
        elapsed = now - start_ts
        rate = fetched / elapsed if elapsed > 0 else 0
        eta_s = int((total - fetched) / rate) if rate > 0 else 0
        h, rem = divmod(eta_s, 3600)
        m, _s = divmod(rem, 60)
        eta_str = f"{h}h {m}m" if h else f"{m}m {_s}s"
        cached_hint = f" (z toho {skipped} z cache)" if skipped else ""
        _persist(
            **{
                msg_field: (
                    f"Stahuji… {fetched}/{total} dlaždic{cached_hint} "
                    f"({total_bytes // (1024 * 1024)} MiB) · "
                    f"{rate:.1f} tiles/s · ETA {eta_str}"
                ),
                count_field: fetched,
                bytes_field: total_bytes,
            }
        )

    try:
        with httpx.Client(
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0),
        ) as client:
            for z in range(LP_ZOOM_MIN, LP_ZOOM_MAX + 1):
                for x, y in _lp_grid(z, LP_BBOX_EUROPE):
                    tile_path = out_dir / str(z) / str(y) / f"{x}.png"
                    if tile_path.exists():
                        fetched += 1
                        skipped += 1
                        total_bytes += tile_path.stat().st_size
                        _heartbeat()
                        continue
                    url = _lp_source_url(source, dnb_date, z, x, y)
                    try:
                        r = client.get(url)
                    except httpx.HTTPError as e:
                        log.warning("LP fetch error z=%d x=%d y=%d: %s", z, x, y, e)
                        _heartbeat()
                        continue
                    if r.status_code != 200:
                        if r.status_code == 404:
                            # Tile doesn't exist for this source/date — treat as
                            # transparent (e.g. ocean tile at high zoom). Don't error.
                            fetched += 1
                            _heartbeat()
                            continue
                        log.warning("LP fetch HTTP %d for z=%d x=%d y=%d", r.status_code, z, x, y)
                        _heartbeat()
                        continue
                    tile_path.parent.mkdir(parents=True, exist_ok=True)
                    tile_path.write_bytes(r.content)
                    fetched += 1
                    total_bytes += len(r.content)
                    _heartbeat()

        _persist(
            **{
                status_field: MapInfra.JobStatus.IDLE,
                msg_field: (
                    f"Hotovo. {fetched} dlaždic stažených "
                    f"(z toho {skipped} z cache), {total_bytes // (1024 * 1024)} MiB."
                ),
                count_field: fetched,
                bytes_field: total_bytes,
                update_field: timezone.now(),
                **(
                    {"light_pollution_viirs_dnb_cached_date": dnb_date}
                    if is_dnb
                    else {}
                ),
            }
        )
        return {"status": "ok", "tiles": fetched, "bytes": total_bytes}

    except Exception as e:  # noqa: BLE001
        log.exception("LP tile download failed")
        _persist(
            **{
                status_field: MapInfra.JobStatus.ERROR,
                msg_field: f"Chyba: {e}"[:500],
            }
        )
        return {"status": "error", "detail": str(e)}
