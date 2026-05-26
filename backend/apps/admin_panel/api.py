"""Admin endpoints for managing self-hosted map infrastructure.

All routes here require `request.user.is_staff = True`. The 'admin' app
in Django already has its own UI at /admin/, but we expose these
operations through the same Ninja API so the SPA can render a friendly
admin section instead of falling back to Django's stock admin pages.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
from django.core.cache import cache
from django.db import transaction
from django.http import HttpRequest, HttpResponse
from django.utils.text import slugify
from ninja import File, Router, Schema
from ninja.files import UploadedFile as NinjaUploadedFile

from apps.places.csv_io import (
    DUPLICATE_RADIUS_METERS,
    find_duplicates,
    parse_csv,
    places_to_csv,
)
from apps.places.models import BortleMeasurement, Place

from .models import MapInfra
from .tasks import (
    LP_BBOX_EUROPE,
    LP_ZOOM_MAX,
    LP_ZOOM_MIN,
    _lp_grid,
    _lp_local_dir,
    _lp_source_url,
    download_light_pollution_tiles,
    download_pmtiles,
    import_photon,
)

log = logging.getLogger(__name__)

PROTOMAPS_INDEX_URL = "https://build-metadata.protomaps.dev/builds.json"
PROTOMAPS_BUILD_URL = "https://build.protomaps.com/{key}"

# ---- Light pollution / GIBS VIIRS catalog ----
# Static Black Marble 2016 — annual composite, fixed date in URL.
GIBS_BLACK_MARBLE_TILE_URL = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "VIIRS_Black_Marble/default/2016-01-01/"
    "GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"
)
# Daily VIIRS DNB at-sensor radiance — requires explicit YYYY-MM-DD.
GIBS_DNB_TILE_URL_TEMPLATE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/{date}/"
    "GoogleMapsCompatible_Level8/{{z}}/{{y}}/{{x}}.png"
)
# Probe tile (z=2, x=2, y=1 = central Europe at very low zoom) used to
# decide whether a given date has data published yet. Cheap & reliable.
_DNB_PROBE_PATH = "2/1/2.png"


def _latest_protomaps_build() -> dict | None:
    """Return the newest Protomaps Daily build entry, cached 1 h.

    Shape: {key: "20260517.pmtiles", size: 115..., uploaded: "ISO"}
    """
    cached = cache.get("protomaps:latest")
    if cached is not None:
        return cached
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(PROTOMAPS_INDEX_URL)
        if r.status_code != 200:
            return None
        builds = r.json()
        if not isinstance(builds, list) or not builds:
            return None
        latest = builds[-1]
        cache.set("protomaps:latest", latest, 3600)
        return latest
    except Exception as e:  # noqa: BLE001
        log.warning("Protomaps build index fetch failed: %s", e)
        return None

router = Router(tags=["admin"])


def _require_staff(request: HttpRequest) -> bool:
    return bool(
        getattr(request, "user", None)
        and request.user.is_authenticated
        and request.user.is_staff
    )


PHOTON_CONTAINER = "astrozor-photon"
DOCKER_SOCK = "/var/run/docker.sock"

# Sample line we parse from photon-docker stdout:
# "2026-05-17 16:14:11,140 - root - INFO - Download progress: 13.4% (7.56GB / 56.52GB) - 47.2 Mbps - ETA: 2h 28m"
_PHOTON_PROGRESS_RE = __import__("re").compile(
    r"Download progress:\s*(?P<pct>\d+(?:\.\d+)?)%\s*"
    r"\((?P<written>\d+(?:\.\d+)?)\s*GB\s*/\s*(?P<total>\d+(?:\.\d+)?)\s*GB\)"
    r"(?:.*?ETA:\s*(?P<eta>[^\r\n]+?))?\s*$"
)


def _demux_docker_logs(data: bytes) -> str:
    """Docker's /containers/{id}/logs returns a multiplexed stream for
    non-TTY containers: each frame is 8 bytes of header (stream_type +
    3 padding + 4-byte BE length) followed by the payload. Strip the
    headers and concatenate the text.
    """
    out = []
    i = 0
    while i < len(data):
        if i + 8 > len(data):
            break
        stream_type = data[i]
        if stream_type not in (0, 1, 2):
            # Not multiplexed (TTY mode) — decode the rest as-is
            out.append(data[i:].decode("utf-8", errors="replace"))
            break
        length = int.from_bytes(data[i + 4 : i + 8], "big")
        i += 8
        out.append(data[i : i + length].decode("utf-8", errors="replace"))
        i += length
    return "".join(out)


def _live_photon_progress() -> dict | None:
    """Peek at the photon container's logs via Docker's HTTP API on the
    unix socket. Returns parsed download progress for the UI, or None
    if the socket isn't available / container isn't running / nothing
    parseable in the recent log window.
    """
    import os

    if not os.path.exists(DOCKER_SOCK):
        return None
    try:
        transport = httpx.HTTPTransport(uds=DOCKER_SOCK)
        with httpx.Client(transport=transport, base_url="http://localhost", timeout=5.0) as client:
            info = client.get(f"/containers/{PHOTON_CONTAINER}/json")
            if info.status_code != 200:
                return None
            state = (info.json().get("State") or {}).get("Status")
            if state != "running":
                return {"phase": "stopped", "label": f"Photon container is {state}"}
            r = client.get(
                f"/containers/{PHOTON_CONTAINER}/logs",
                params={"stdout": "true", "stderr": "true", "tail": "40"},
            )
            if r.status_code != 200:
                return None
            text = _demux_docker_logs(r.content)
    except Exception as e:  # noqa: BLE001
        log.warning("Photon live progress probe failed: %s", e)
        return None

    # Walk the log lines from newest to oldest; first progress / phase hit wins.
    for line in reversed(text.splitlines()):
        if "Photon is ready" in line or "Listening on" in line:
            return {"phase": "ready", "label": "Photon is ready"}
        if "Extracting" in line or "extracting" in line:
            return {"phase": "extracting", "label": "Extracting downloaded archive…"}
        m = _PHOTON_PROGRESS_RE.search(line)
        if m:
            written_gb = float(m.group("written"))
            total_gb = float(m.group("total"))
            eta = (m.group("eta") or "").strip()
            return {
                "phase": "downloading",
                "bytes_written": int(written_gb * 1024**3),
                "total_bytes": int(total_gb * 1024**3),
                "eta": eta,
                "label": (
                    f"Downloading Photon index: {float(m.group('pct')):.1f}% "
                    f"({written_gb:.2f} / {total_gb:.2f} GB)"
                    + (f" · ETA {eta}" if eta else "")
                ),
            }
    # No matching line in the tail — still useful to say something
    return {"phase": "running", "label": "Photon container is running"}


def _live_pmtiles_progress(m: MapInfra) -> dict | None:
    """If a download is in-flight, peek at the on-disk .part file size
    and return live progress, independent of how often the worker
    persists its own status_message. Lets the UI show smooth progress
    even when the worker reports at coarse intervals.
    """
    if m.pmtiles_status != MapInfra.JobStatus.RUNNING:
        return None
    from pathlib import Path

    parent = Path(m.pmtiles_path).parent
    if not parent.is_dir():
        return None
    # New deterministic name (e.g. europe.pmtiles.part). Fall back to
    # any *.part during migration from the old tempfile.mkstemp pattern.
    part = Path(m.pmtiles_path).with_suffix(Path(m.pmtiles_path).suffix + ".part")
    try:
        if part.exists():
            size = part.stat().st_size
        else:
            others = sorted(
                parent.glob("*.part"), key=lambda p: p.stat().st_mtime, reverse=True
            )
            if not others:
                return None
            size = others[0].stat().st_size
    except OSError:
        return None
    # We don't know the total in DB until the worker first reads the
    # response Content-Length header; approximate via the latest known
    # Protomaps build size if it's available, otherwise return raw bytes
    latest = _latest_protomaps_build()
    total = (latest or {}).get("size") or 0
    return {"bytes_written": size, "total_bytes": total}


def _probe_dnb_date(date_str: str) -> bool:
    """Return True if NASA GIBS has VIIRS DNB tiles for this YYYY-MM-DD."""
    url = (
        f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
        f"VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/{date_str}/"
        f"GoogleMapsCompatible_Level8/{_DNB_PROBE_PATH}"
    )
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.head(url)
        return r.status_code == 200
    except httpx.HTTPError as e:
        log.warning("DNB probe %s failed: %s", date_str, e)
        return False


def _find_latest_dnb_date() -> tuple[str, str] | None:
    """Walk back from today over the last ~14 days and return the first
    date that has VIIRS DNB tiles available. Returns (date, label) or None.
    NASA publishes ~2-3 day lagged, so the walk usually finds a hit at t-2.
    """
    from datetime import date, timedelta

    today = date.today()
    for delta in range(2, 15):
        d = today - timedelta(days=delta)
        ds = d.isoformat()
        if _probe_dnb_date(ds):
            return ds, f"VIIRS DNB nightly composite, {ds} (latest available)"
    return None


def _light_pollution_tile_url(m: MapInfra) -> str:
    """Return the active tile URL template (with {z}/{y}/{x} placeholders)
    based on the admin's chosen light_pollution_source.

    Prefers locally-cached tiles only when the cache is *complete enough*
    to cover the world to a useful zoom level — otherwise the user pans
    outside the cached area and gets 404s for every tile.

    Threshold: ≥ 4096 tiles (= full world to z=6). A complete cache to
    z=7 is 16k tiles; below ~4k means the admin downloaded only a
    region (e.g. just CZ) and global panning is broken. In that case
    we route everyone to NASA GIBS upstream so the overlay works
    everywhere — local cache just sits unused until it's complete.
    """
    source = m.light_pollution_source
    is_dnb = source == MapInfra.LightPollutionSource.VIIRS_DNB_LATEST
    _MIN_TILES_FOR_LOCAL = 4096

    if is_dnb:
        local_complete = (
            m.light_pollution_viirs_dnb_tile_count >= _MIN_TILES_FOR_LOCAL
            and m.light_pollution_viirs_dnb_cached_date == m.light_pollution_dnb_date
        )
    else:
        local_complete = (
            m.light_pollution_black_marble_tile_count >= _MIN_TILES_FOR_LOCAL
        )
    if local_complete:
        return f"/lp-tiles/{source}/{{z}}/{{y}}/{{x}}.png"

    # Fallback to NASA GIBS upstream — always world-wide, always live,
    # max zoom 8 (Level8 matrix). Slower than local hit but reliable.
    if is_dnb and m.light_pollution_dnb_date:
        return GIBS_DNB_TILE_URL_TEMPLATE.format(date=m.light_pollution_dnb_date)
    return GIBS_BLACK_MARBLE_TILE_URL


def _infra_out(m: MapInfra) -> dict:
    latest = _latest_protomaps_build()
    live = _live_pmtiles_progress(m)
    return {
        "pmtiles": {
            "path": m.pmtiles_path,
            "source_url": m.pmtiles_source_url,
            "size_bytes": m.pmtiles_size_bytes,
            "last_update": m.pmtiles_last_update,
            "status": m.pmtiles_status,
            "status_message": m.pmtiles_status_message,
            "job_id": m.pmtiles_job_id,
            "available": m.pmtiles_size_bytes > 0 and m.pmtiles_status != MapInfra.JobStatus.ERROR,
            "live_progress": live,
            "latest": (
                {
                    "url": PROTOMAPS_BUILD_URL.format(key=latest["key"]),
                    "key": latest["key"],
                    "size_bytes": latest.get("size", 0),
                    "uploaded": latest.get("uploaded"),
                }
                if latest
                else None
            ),
        },
        "photon": {
            "url": m.photon_url,
            "last_import": m.photon_last_import,
            "status": m.photon_status,
            "status_message": m.photon_status_message,
            "imported_size_mb": m.photon_imported_size_mb,
            "available": m.photon_last_import is not None
            and m.photon_status != MapInfra.JobStatus.ERROR,
            "live_progress": _live_photon_progress(),
        },
        "tile_backend": m.tile_backend,
        "search_backend": m.search_backend,
        "chat": {
            "text_max_length": m.chat_text_max_length,
        },
        "light_pollution": {
            "source": m.light_pollution_source,
            "dnb_date": m.light_pollution_dnb_date or "",
            "last_check": m.light_pollution_last_check,
            "status_message": m.light_pollution_status_message,
            "tile_url_template": _light_pollution_tile_url(m),
            "black_marble": {
                "status": m.light_pollution_black_marble_status,
                "status_message": m.light_pollution_black_marble_status_message,
                "tile_count": m.light_pollution_black_marble_tile_count,
                "size_bytes": m.light_pollution_black_marble_size_bytes,
                "last_update": m.light_pollution_black_marble_last_update,
                "cached": m.light_pollution_black_marble_tile_count > 0,
            },
            "viirs_dnb": {
                "status": m.light_pollution_viirs_dnb_status,
                "status_message": m.light_pollution_viirs_dnb_status_message,
                "tile_count": m.light_pollution_viirs_dnb_tile_count,
                "size_bytes": m.light_pollution_viirs_dnb_size_bytes,
                "last_update": m.light_pollution_viirs_dnb_last_update,
                "cached": m.light_pollution_viirs_dnb_tile_count > 0
                and m.light_pollution_viirs_dnb_cached_date == m.light_pollution_dnb_date,
                "cached_date": m.light_pollution_viirs_dnb_cached_date,
            },
        },
        "updated_at": m.updated_at,
    }


@router.get("/admin/map-infra", response={200: dict, 403: dict})
def get_map_infra(request: HttpRequest):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    return 200, _infra_out(MapInfra.get())


# ---- User management ----


def _user_admin_out(u) -> dict:
    profile = getattr(u, "profile", None)
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": profile.display_name if profile else "",
        "is_staff": u.is_staff,
        "is_superuser": u.is_superuser,
        "is_active": u.is_active,
        "email_verified": u.email_verified,
        "last_login": u.last_login,
        "last_login_ip": u.last_login_ip or "",
        "last_login_country": u.last_login_country or "",
        "last_login_country_code": u.last_login_country_code or "",
        "last_login_city": u.last_login_city or "",
        "storage_used_bytes": profile.storage_used_bytes if profile else 0,
        "storage_quota_bytes": profile.storage_quota_bytes if profile else 0,
        "created_at": u.created_at,
    }


@router.get("/admin/users", response={200: list[dict], 403: dict})
def list_users(request: HttpRequest, q: str = ""):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    from apps.accounts.models import User

    qs = User.objects.all().select_related("profile").order_by("created_at")
    if q:
        from django.db.models import Q

        qs = qs.filter(Q(email__icontains=q) | Q(profile__display_name__icontains=q))
    return 200, [_user_admin_out(u) for u in qs[:200]]


class UserPatchIn(Schema):
    is_active: bool | None = None
    is_staff: bool | None = None


@router.patch("/admin/users/{user_id}", response={200: dict, 400: dict, 403: dict, 404: dict})
def patch_user(request: HttpRequest, user_id: str, payload: UserPatchIn):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    from apps.accounts.models import User

    try:
        target = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError):
        return 404, {"detail": "User not found"}

    # Last-superuser protection — must always have at least one active
    # superuser otherwise the instance becomes admin-less.
    fields = []
    if payload.is_active is not None and payload.is_active != target.is_active:
        if not payload.is_active and target.is_superuser:
            active_supers = User.objects.filter(is_superuser=True, is_active=True).exclude(
                pk=target.pk
            ).count()
            if active_supers == 0:
                return 400, {
                    "detail": "Cannot block the last active superuser",
                }
        target.is_active = payload.is_active
        fields.append("is_active")
    if payload.is_staff is not None and payload.is_staff != target.is_staff:
        if not payload.is_staff and target.is_superuser and target.pk == request.user.pk:
            return 400, {"detail": "Cannot demote yourself"}
        target.is_staff = payload.is_staff
        # Revoking staff also revokes superuser for safety
        if not payload.is_staff:
            target.is_superuser = False
            fields.append("is_superuser")
        fields.append("is_staff")
    if fields:
        target.save(update_fields=list(set(fields)))
    return 200, _user_admin_out(target)


class PmtilesUrlIn(Schema):
    source_url: str | None = None


@router.post("/admin/map-infra/pmtiles/download", response={202: dict, 403: dict, 409: dict})
def trigger_pmtiles_download(request: HttpRequest, payload: PmtilesUrlIn):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    infra = MapInfra.get()
    if infra.pmtiles_status == MapInfra.JobStatus.RUNNING:
        return 409, {
            "detail": "Download already in progress",
            "status_message": infra.pmtiles_status_message,
        }
    if payload.source_url:
        infra.pmtiles_source_url = payload.source_url
        infra.save(update_fields=["pmtiles_source_url"])
    async_result = download_pmtiles.delay()
    return 202, {"job_id": async_result.id, "status": "queued"}


@router.delete("/admin/map-infra/pmtiles", response={200: dict, 403: dict, 409: dict})
def delete_pmtiles(request: HttpRequest):
    """Delete the downloaded PMTiles archive to reclaim disk. Resets the
    MapInfra status to IDLE. If the active tile backend is PMTiles, it
    falls back to the public OSM source on the next /map/config fetch."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    infra = MapInfra.get()
    if infra.pmtiles_status == MapInfra.JobStatus.RUNNING:
        return 409, {
            "detail": "Download is in progress — cancel the job before deleting",
        }
    target = Path(infra.pmtiles_path)
    part = target.with_suffix(target.suffix + ".part")
    freed = 0
    for p in (target, part):
        try:
            if p.is_file():
                freed += p.stat().st_size
                p.unlink()
        except OSError as e:
            log.warning("delete_pmtiles: could not remove %s: %s", p, e)
    # Also drop the active tile backend if it was pointing at PMTiles; the
    # map falls back to OSM raster transparently for clients.
    fields = [
        "pmtiles_size_bytes",
        "pmtiles_last_update",
        "pmtiles_status",
        "pmtiles_status_message",
    ]
    infra.pmtiles_size_bytes = 0
    infra.pmtiles_last_update = None
    infra.pmtiles_status = MapInfra.JobStatus.IDLE
    infra.pmtiles_status_message = ""
    if infra.tile_backend == MapInfra.TileBackend.PMTILES:
        infra.tile_backend = MapInfra.TileBackend.OSM
        fields.append("tile_backend")
    infra.save(update_fields=fields)
    return 200, {"deleted": True, "bytes_freed": freed}


@router.delete(
    "/admin/map-infra/photon",
    response={200: dict, 403: dict, 502: dict},
)
def delete_photon(request: HttpRequest):
    """Wipe the Photon data volume and restart the container so its
    entrypoint re-imports a fresh dump. Calls Docker's HTTP API on the
    shared unix socket.
    """
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    if not os.path.exists(DOCKER_SOCK):
        return 502, {"detail": "Docker socket not available — cannot manage photon container"}

    try:
        transport = httpx.HTTPTransport(uds=DOCKER_SOCK)
        with httpx.Client(transport=transport, base_url="http://localhost", timeout=30.0) as client:
            # 1) exec rm -rf inside the (running or paused) photon container.
            #    If the container is stopped this returns 409; in that case
            #    start it briefly so we can exec, then stop again.
            exec_create = client.post(
                f"/containers/{PHOTON_CONTAINER}/exec",
                json={
                    "Cmd": ["sh", "-c", "rm -rf /photon/photon_data/* /photon/photon_data/.* 2>/dev/null; true"],
                    "AttachStdout": True,
                    "AttachStderr": True,
                },
            )
            if exec_create.status_code == 409:
                # Container not running. Start it, retry exec, then continue.
                client.post(f"/containers/{PHOTON_CONTAINER}/start", timeout=15.0)
                exec_create = client.post(
                    f"/containers/{PHOTON_CONTAINER}/exec",
                    json={
                        "Cmd": ["sh", "-c", "rm -rf /photon/photon_data/* /photon/photon_data/.* 2>/dev/null; true"],
                        "AttachStdout": True,
                        "AttachStderr": True,
                    },
                )
            if exec_create.status_code not in (200, 201):
                return 502, {
                    "detail": f"Docker /exec create returned {exec_create.status_code}: {exec_create.text[:200]}",
                }
            exec_id = exec_create.json().get("Id")
            if not exec_id:
                return 502, {"detail": "Docker /exec did not return an Id"}
            start = client.post(f"/exec/{exec_id}/start", json={"Detach": False, "Tty": False}, timeout=120.0)
            if start.status_code not in (200, 201):
                return 502, {
                    "detail": f"Docker /exec/start returned {start.status_code}: {start.text[:200]}",
                }
            # 2) restart so photon-docker's entrypoint sees the empty data
            #    dir and kicks off a fresh import.
            restart = client.post(f"/containers/{PHOTON_CONTAINER}/restart", timeout=30.0)
            if restart.status_code not in (200, 204):
                return 502, {
                    "detail": f"Docker /restart returned {restart.status_code}: {restart.text[:200]}",
                }
    except httpx.HTTPError as e:
        return 502, {"detail": f"Docker socket call failed: {e}"}

    # Reset MapInfra Photon-side state so the UI doesn't claim the old
    # import is still valid.
    infra = MapInfra.get()
    infra.photon_last_import = None
    if infra.search_backend == MapInfra.SearchBackend.PHOTON:
        infra.search_backend = MapInfra.SearchBackend.NOMINATIM
        infra.save(update_fields=["photon_last_import", "search_backend"])
    else:
        infra.save(update_fields=["photon_last_import"])
    return 200, {"reset": True, "detail": "Photon data wiped; container restarted; re-import in progress."}


@router.delete(
    "/admin/map-infra/light-pollution/{source}",
    response={200: dict, 400: dict, 403: dict, 409: dict},
)
def delete_lp_tiles(request: HttpRequest, source: str):
    """Delete the local tile cache for one LP source to reclaim disk."""
    import shutil

    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    if source not in ("black_marble_2016", "viirs_dnb_latest"):
        return 400, {"detail": f"unknown source: {source}"}
    infra = MapInfra.get()
    is_dnb = source == "viirs_dnb_latest"
    status_field = (
        "light_pollution_viirs_dnb_status"
        if is_dnb
        else "light_pollution_black_marble_status"
    )
    if getattr(infra, status_field) == MapInfra.JobStatus.RUNNING:
        return 409, {"detail": "Download is in progress — cancel the job before deleting"}

    target = _lp_local_dir(source)
    freed = 0
    if target.exists():
        # Compute freed bytes before rm (cheap on local FS, bounded by
        # tile count ~ thousands).
        for root, _dirs, files in os.walk(target):
            for f in files:
                try:
                    freed += (Path(root) / f).stat().st_size
                except OSError:
                    pass
        shutil.rmtree(target, ignore_errors=True)

    count_field = (
        "light_pollution_viirs_dnb_tile_count"
        if is_dnb
        else "light_pollution_black_marble_tile_count"
    )
    msg_field = status_field.replace("_status", "_status_message")
    setattr(infra, count_field, 0)
    setattr(infra, status_field, MapInfra.JobStatus.IDLE)
    setattr(infra, msg_field, "")
    infra.save(update_fields=[count_field, status_field, msg_field])
    return 200, {"deleted": True, "bytes_freed": freed}


class BackendSwitchIn(Schema):
    tile_backend: str | None = None
    search_backend: str | None = None


@router.post("/admin/map-infra/switch", response={200: dict, 400: dict, 403: dict})
def switch_backends(request: HttpRequest, payload: BackendSwitchIn):
    """Switch active tile/search backend. Caller must have already
    downloaded/imported the target before switching, or the map will
    break for everyone."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    infra = MapInfra.get()
    fields = []
    if payload.tile_backend is not None:
        if payload.tile_backend not in MapInfra.TileBackend.values:
            return 400, {"detail": f"Unknown tile_backend: {payload.tile_backend}"}
        if (
            payload.tile_backend == MapInfra.TileBackend.PMTILES
            and infra.pmtiles_size_bytes <= 0
        ):
            return 400, {"detail": "PMTiles not downloaded yet"}
        infra.tile_backend = payload.tile_backend
        fields.append("tile_backend")
    if payload.search_backend is not None:
        if payload.search_backend not in MapInfra.SearchBackend.values:
            return 400, {"detail": f"Unknown search_backend: {payload.search_backend}"}
        if (
            payload.search_backend == MapInfra.SearchBackend.PHOTON
            and infra.photon_last_import is None
        ):
            return 400, {"detail": "Photon not imported yet"}
        infra.search_backend = payload.search_backend
        fields.append("search_backend")
    if fields:
        infra.save(update_fields=fields)
    return 200, _infra_out(infra)


@router.post("/admin/map-infra/photon/probe", response={202: dict, 403: dict})
def trigger_photon_probe(request: HttpRequest):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    async_result = import_photon.delay()
    return 202, {"job_id": async_result.id, "status": "queued"}


class ChatSettingsIn(Schema):
    text_max_length: int


@router.patch(
    "/admin/map-infra/chat/settings",
    response={200: dict, 400: dict, 403: dict},
)
def update_chat_settings(request: HttpRequest, payload: ChatSettingsIn):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    # Sane bounds: 200 chars (Twitter-ish minimum) to 50 000 (hard ceiling
    # matches the pydantic max in chat/schemas.py).
    if payload.text_max_length < 200 or payload.text_max_length > 50_000:
        return 400, {
            "detail": "text_max_length must be between 200 and 50 000 characters"
        }
    infra = MapInfra.get()
    infra.chat_text_max_length = payload.text_max_length
    infra.save(update_fields=["chat_text_max_length"])
    return 200, _infra_out(infra)


class CloudsSettingsIn(Schema):
    """Admin payload for the clouds integration. All fields optional —
    only those provided are updated. Passing an empty string for a
    credential clears it; omit the field to leave it untouched."""

    enabled: bool | None = None
    provider: str | None = None
    frame_count: int | None = None
    cache_ttl_seconds: int | None = None
    opacity_default: float | None = None
    openweathermap_api_key: str | None = None
    eumetsat_consumer_key: str | None = None
    eumetsat_consumer_secret: str | None = None


def _clouds_settings_out(m: MapInfra) -> dict:
    """Return admin-visible clouds settings. Credentials are surfaced
    as boolean `*_set` flags — never the actual secret. The provider
    list is included so the UI can render the dropdown without hard-
    coding the choices."""
    return {
        "enabled": m.clouds_enabled,
        "provider": m.clouds_provider,
        "provider_choices": [
            {"value": v, "label": lbl}
            for v, lbl in MapInfra.CloudsProvider.choices
        ],
        "frame_count": m.clouds_frame_count,
        "cache_ttl_seconds": m.clouds_cache_ttl_seconds,
        "opacity_default": m.clouds_opacity_default,
        "openweathermap_api_key_set": bool(m.clouds_openweathermap_api_key),
        "eumetsat_consumer_key_set": bool(m.clouds_eumetsat_consumer_key),
        "eumetsat_consumer_secret_set": bool(m.clouds_eumetsat_consumer_secret),
    }


@router.get("/admin/clouds", response={200: dict, 403: dict})
def get_clouds_settings(request: HttpRequest):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    return 200, _clouds_settings_out(MapInfra.get())


@router.patch("/admin/clouds", response={200: dict, 400: dict, 403: dict})
def update_clouds_settings(request: HttpRequest, payload: CloudsSettingsIn):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    from .clouds import clear_cache as _clear_clouds_cache

    m = MapInfra.get()
    fields: list[str] = []
    if payload.enabled is not None:
        m.clouds_enabled = payload.enabled
        fields.append("clouds_enabled")
    if payload.provider is not None:
        if payload.provider not in MapInfra.CloudsProvider.values:
            return 400, {"detail": f"Unknown provider: {payload.provider}"}
        m.clouds_provider = payload.provider
        fields.append("clouds_provider")
    if payload.frame_count is not None:
        if not 1 <= payload.frame_count <= 24:
            return 400, {"detail": "frame_count must be 1..24"}
        m.clouds_frame_count = payload.frame_count
        fields.append("clouds_frame_count")
    if payload.cache_ttl_seconds is not None:
        if not 60 <= payload.cache_ttl_seconds <= 3600:
            return 400, {"detail": "cache_ttl_seconds must be 60..3600"}
        m.clouds_cache_ttl_seconds = payload.cache_ttl_seconds
        fields.append("clouds_cache_ttl_seconds")
    if payload.opacity_default is not None:
        if not 0 <= payload.opacity_default <= 1:
            return 400, {"detail": "opacity_default must be 0..1"}
        m.clouds_opacity_default = payload.opacity_default
        fields.append("clouds_opacity_default")
    if payload.openweathermap_api_key is not None:
        m.clouds_openweathermap_api_key = payload.openweathermap_api_key.strip()
        fields.append("clouds_openweathermap_api_key")
    if payload.eumetsat_consumer_key is not None:
        m.clouds_eumetsat_consumer_key = payload.eumetsat_consumer_key.strip()
        fields.append("clouds_eumetsat_consumer_key")
    if payload.eumetsat_consumer_secret is not None:
        m.clouds_eumetsat_consumer_secret = payload.eumetsat_consumer_secret.strip()
        fields.append("clouds_eumetsat_consumer_secret")
    if fields:
        m.save(update_fields=fields)
        # Settings changed → drop the cached frame list (and any
        # EUMETSAT token) so the next public read fetches afresh.
        _clear_clouds_cache()
    return 200, _clouds_settings_out(m)


class LightPollutionSourceIn(Schema):
    source: str


@router.post(
    "/admin/map-infra/light-pollution/source",
    response={200: dict, 400: dict, 403: dict},
)
def set_light_pollution_source(request: HttpRequest, payload: LightPollutionSourceIn):
    """Switch the active light-pollution overlay source. Switching to
    viirs_dnb_latest does NOT trigger a refresh — caller should also call
    /admin/map-infra/light-pollution/refresh to find the latest date."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    if payload.source not in MapInfra.LightPollutionSource.values:
        return 400, {"detail": f"Unknown source: {payload.source}"}
    infra = MapInfra.get()
    infra.light_pollution_source = payload.source
    infra.save(update_fields=["light_pollution_source"])
    return 200, _infra_out(infra)


@router.get(
    "/admin/map-infra/light-pollution/{source}/estimate-size",
    response={200: dict, 400: dict, 403: dict, 502: dict},
)
def estimate_lp_download_size(request: HttpRequest, source: str):
    """Probe 3 representative tiles per zoom level on NASA GIBS and
    extrapolate the total cache size for Europe bbox z0-z7. Used by the
    admin UI to show the user the cost BEFORE they commit to downloading.
    """
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    if source not in ("black_marble_2016", "viirs_dnb_latest"):
        return 400, {"detail": f"unknown source: {source}"}

    infra = MapInfra.get()
    dnb_date = infra.light_pollution_dnb_date
    if source == "viirs_dnb_latest" and not dnb_date:
        return 400, {
            "detail": "Set DNB date via 'Aktualizovat na poslední' first."
        }

    total_bytes_est = 0
    total_tiles = 0
    per_zoom: list[dict] = []
    with httpx.Client(timeout=10.0) as client:
        for z in range(LP_ZOOM_MIN, LP_ZOOM_MAX + 1):
            grid = _lp_grid(z, LP_BBOX_EUROPE)
            sample = grid[:: max(1, len(grid) // 3)][:3] or grid[:1]
            sizes = []
            for x, y in sample:
                url = _lp_source_url(source, dnb_date, z, x, y)
                try:
                    r = client.head(url)
                except httpx.HTTPError:
                    continue
                if r.status_code != 200:
                    continue
                cl = r.headers.get("content-length")
                if cl:
                    sizes.append(int(cl))
            avg = sum(sizes) / len(sizes) if sizes else 0
            zoom_bytes = int(avg * len(grid))
            per_zoom.append(
                {
                    "zoom": z,
                    "tiles": len(grid),
                    "avg_tile_bytes": int(avg),
                    "total_bytes_est": zoom_bytes,
                }
            )
            total_bytes_est += zoom_bytes
            total_tiles += len(grid)

    return 200, {
        "source": source,
        "bbox": list(LP_BBOX_EUROPE),
        "zoom_min": LP_ZOOM_MIN,
        "zoom_max": LP_ZOOM_MAX,
        "total_tiles": total_tiles,
        "total_bytes_estimate": total_bytes_est,
        "per_zoom": per_zoom,
    }


@router.post(
    "/admin/map-infra/light-pollution/{source}/download",
    response={202: dict, 400: dict, 403: dict, 409: dict},
)
def trigger_lp_download(request: HttpRequest, source: str):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    if source not in ("black_marble_2016", "viirs_dnb_latest"):
        return 400, {"detail": f"unknown source: {source}"}
    infra = MapInfra.get()
    field = (
        "light_pollution_viirs_dnb_status"
        if source == "viirs_dnb_latest"
        else "light_pollution_black_marble_status"
    )
    if getattr(infra, field) == MapInfra.JobStatus.RUNNING:
        return 409, {"detail": "Download already in progress"}
    if source == "viirs_dnb_latest" and not infra.light_pollution_dnb_date:
        return 400, {"detail": "Set DNB date via 'Aktualizovat na poslední' first."}
    result = download_light_pollution_tiles.delay(source)
    return 202, {"job_id": result.id, "status": "queued"}


@router.post(
    "/admin/map-infra/light-pollution/refresh",
    response={200: dict, 403: dict, 502: dict},
)
def refresh_light_pollution_latest(request: HttpRequest):
    """Probe GIBS for the freshest VIIRS DNB nightly composite and store
    that date. Walks back from today until it finds a date with tiles
    available (usually t-2 to t-3 because of publication lag)."""
    from django.utils import timezone

    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    found = _find_latest_dnb_date()
    infra = MapInfra.get()
    infra.light_pollution_last_check = timezone.now()
    if found is None:
        infra.light_pollution_status_message = (
            "No VIIRS DNB tiles available in the last 14 days "
            "(GIBS upstream may be down)."
        )
        infra.save(
            update_fields=["light_pollution_last_check", "light_pollution_status_message"]
        )
        return 502, _infra_out(infra)
    date_str, label = found
    infra.light_pollution_dnb_date = date_str
    infra.light_pollution_status_message = label
    infra.save(
        update_fields=[
            "light_pollution_dnb_date",
            "light_pollution_status_message",
            "light_pollution_last_check",
        ]
    )
    return 200, _infra_out(infra)


# ---- Public map config (read-only, no auth) ----
# Frontend reads this to decide which tile / search backend to use.

public_router = Router(tags=["map"])


@public_router.get("/clouds/frames", response={200: dict})
def public_cloud_frames(request: HttpRequest):  # noqa: ARG001
    """Last N RainViewer satellite frames for the cloud-cover overlay.

    Shape:
      { enabled, frames: [{time, tile_url_template}], opacity_default,
        attribution, fetched_at, cache_ttl_seconds }

    `frames` is empty when the admin has disabled the feature OR when
    the upstream is unreachable and we have nothing cached. The
    fetched_at + cache_ttl_seconds lets the frontend decide how often
    to re-poll (we recommend half the TTL).
    """
    from .clouds import get_frames

    return 200, get_frames()


@public_router.get("/map/config", response={200: dict})
def map_config(request: HttpRequest):  # noqa: ARG001
    m = MapInfra.get()
    return 200, {
        "tile_backend": m.tile_backend,
        "search_backend": m.search_backend,
        "pmtiles_url": (
            f"/pmtiles/{m.pmtiles_path.rsplit('/', 1)[-1]}"
            if m.tile_backend == MapInfra.TileBackend.PMTILES and m.pmtiles_size_bytes > 0
            else None
        ),
        "photon_url": (
            "/api/v1/geocode-photon"
            if m.search_backend == MapInfra.SearchBackend.PHOTON
            else None
        ),
        "light_pollution": {
            "source": m.light_pollution_source,
            "dnb_date": m.light_pollution_dnb_date or "",
            "tile_url_template": _light_pollution_tile_url(m),
            "attribution": (
                "Night lights: NASA VIIRS DNB ("
                + (
                    f"nightly composite {m.light_pollution_dnb_date}"
                    if m.light_pollution_source == MapInfra.LightPollutionSource.VIIRS_DNB_LATEST
                    and m.light_pollution_dnb_date
                    else "Black Marble 2016 annual"
                )
                + ")"
            ),
        },
    }


# ============================================================
# Admin places management — datagrid + CSV import/export
# ============================================================


@router.get("/admin/places", response={200: list[dict], 403: dict})
def admin_list_places(request: HttpRequest, q: str = ""):
    """All places in the DB, regardless of status or expiry. Used by the
    admin datagrid; the public /places listing hides drafts and
    expired-temporary spots, but admin needs to see everything."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    qs = Place.objects.select_related("owner").order_by("name")
    if q:
        from django.db.models import Q

        qs = qs.filter(Q(name__icontains=q) | Q(slug__icontains=q) | Q(address__icontains=q))
    out = []
    for p in qs[:500]:
        out.append(
            {
                "id": str(p.id),
                "slug": p.slug,
                "name": p.name,
                "kind": p.kind,
                "status": p.status,
                "lat": p.lat,
                "lon": p.lon,
                "elevation_m": p.elevation_m,
                "bortle_class_manual": p.bortle_class_manual,
                "bortle_class_map": p.bortle_class_map,
                "owner_email": p.owner.email if p.owner_id else "",
                "created_at": p.created_at,
            }
        )
    return 200, out


@router.get("/admin/places/export.csv", response={200: dict, 403: dict})
def admin_export_places_csv(request: HttpRequest):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    text = places_to_csv(Place.objects.all())
    resp = HttpResponse(text, content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = 'attachment; filename="astrozor-places.csv"'
    return resp


class _ImportPreviewRow(Schema):
    row_index: int
    name: str
    kind: str
    lat: float | None
    lon: float | None
    description: str
    address: str
    website: str
    bortle_manual: float | None = None
    elevation_m: int | None = None
    owner_email: str
    duplicates: list[dict] = []
    errors: list[str] = []


@router.post(
    "/admin/places/import-preview",
    response={200: dict, 400: dict, 403: dict},
    auth=None,
)
def admin_preview_import(request: HttpRequest, file: NinjaUploadedFile = File(...)):
    """Parse uploaded CSV + mark duplicates within 200m of any existing
    place. Pure read; nothing is written. Frontend renders rows for the
    admin to decide which to import."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    try:
        text = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return 400, {"detail": "CSV must be UTF-8 encoded"}

    existing = list(Place.objects.only("slug", "name", "lat", "lon"))
    rows = []
    new_count = 0
    dup_count = 0
    error_count = 0
    for idx, row, errors in parse_csv(text):
        if row.get("lat") is not None and row.get("lon") is not None:
            dups = find_duplicates(row, existing)
        else:
            dups = []
        rows.append(
            {
                "row_index": idx,
                "name": row["name"],
                "kind": row["kind"],
                "lat": row["lat"],
                "lon": row["lon"],
                "description": row.get("description") or "",
                "address": row.get("address") or "",
                "website": row.get("website") or "",
                "elevation_m": row.get("elevation_m"),
                "bortle_manual": row.get("bortle_manual"),
                "owner_email": row.get("owner_email") or "",
                "duplicates": dups,
                "errors": errors,
            }
        )
        if errors:
            error_count += 1
        elif dups:
            dup_count += 1
        else:
            new_count += 1
    return 200, {
        "rows": rows,
        "summary": {
            "total": len(rows),
            "new": new_count,
            "duplicates": dup_count,
            "errors": error_count,
            "duplicate_radius_m": DUPLICATE_RADIUS_METERS,
        },
    }


class _ImportRowDecision(Schema):
    row_index: int
    name: str
    kind: str
    lat: float
    lon: float
    description: str = ""
    address: str = ""
    website: str = ""
    contact: str = ""
    opening_hours: str = ""
    elevation_m: int | None = None
    bortle_manual: float | None = None
    owner_email: str = ""


class _ImportCommitIn(Schema):
    rows: list[_ImportRowDecision]


@router.post(
    "/admin/places/import-commit",
    response={201: dict, 400: dict, 403: dict},
)
def admin_commit_import(request: HttpRequest, payload: _ImportCommitIn):
    """Create Place rows from the admin's selected import rows. The
    frontend has already filtered out duplicates the admin chose to skip;
    we accept whatever it sends. Auto-Bortle estimate runs per row."""
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}

    from apps.places.api import _record_estimated_bortle

    User = None
    if any(r.owner_email for r in payload.rows):
        from apps.accounts.models import User as _U

        User = _U

    created = []
    failed: list[dict] = []
    with transaction.atomic():
        for r in payload.rows:
            if r.kind not in {k for k, _ in Place.Kind.choices}:
                failed.append({"row_index": r.row_index, "error": f"invalid kind: {r.kind}"})
                continue
            base = slugify(r.name)[:100] or "place"
            slug = base
            i = 2
            while Place.objects.filter(slug=slug).exists():
                slug = f"{base}-{i}"
                i += 1
            owner = None
            if r.owner_email and User is not None:
                owner = User.objects.filter(email__iexact=r.owner_email).first()
            try:
                p = Place.objects.create(
                    slug=slug,
                    name=r.name,
                    kind=r.kind,
                    status=Place.Status.PUBLISHED,
                    description=r.description,
                    lat=r.lat,
                    lon=r.lon,
                    elevation_m=r.elevation_m,
                    address=r.address,
                    website=r.website,
                    contact=r.contact,
                    opening_hours=r.opening_hours,
                    bortle_class_manual=r.bortle_manual,
                    bortle_class=r.bortle_manual,  # initial effective value
                    owner=owner,
                )
                if r.bortle_manual is not None:
                    BortleMeasurement.objects.create(
                        place=p,
                        value=r.bortle_manual,
                        source=BortleMeasurement.Source.MANUAL,
                        notes="csv import",
                        submitted_by=owner or request.user,
                    )
                # Auto-fill map-derived Bortle (best-effort; ignore failures)
                try:
                    _record_estimated_bortle(p, request.user)
                except Exception:  # noqa: BLE001
                    pass
                created.append(p.slug)
            except Exception as e:  # noqa: BLE001
                failed.append({"row_index": r.row_index, "error": str(e)[:200]})
    return 201, {"created": created, "failed": failed, "created_count": len(created)}
