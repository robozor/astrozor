"""Admin endpoints for managing self-hosted map infrastructure.

All routes here require `request.user.is_staff = True`. The 'admin' app
in Django already has its own UI at /admin/, but we expose these
operations through the same Ninja API so the SPA can render a friendly
admin section instead of falling back to Django's stock admin pages.
"""

from __future__ import annotations

import logging

import httpx
from django.core.cache import cache
from django.http import HttpRequest
from ninja import Router, Schema

from .models import MapInfra
from .tasks import download_pmtiles, import_photon

log = logging.getLogger(__name__)

PROTOMAPS_INDEX_URL = "https://build-metadata.protomaps.dev/builds.json"
PROTOMAPS_BUILD_URL = "https://build.protomaps.com/{key}"


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
        "created_at": u.created_at,
    }


@router.get("/admin/users", response={200: list[dict], 403: dict})
def list_users(request: HttpRequest, q: str = ""):
    if not _require_staff(request):
        return 403, {"detail": "Staff only"}
    from apps.accounts.models import User

    qs = User.objects.all().select_related("profile").order_by("date_joined")
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


# ---- Public map config (read-only, no auth) ----
# Frontend reads this to decide which tile / search backend to use.

public_router = Router(tags=["map"])


@public_router.get("/map/config", response={200: dict})
def map_config(request: HttpRequest):  # noqa: ARG001
    m = MapInfra.get()
    return 200, {
        "tile_backend": m.tile_backend,
        "search_backend": m.search_backend,
        "pmtiles_url": (
            f"/media/pmtiles/{m.pmtiles_path.rsplit('/', 1)[-1]}"
            if m.tile_backend == MapInfra.TileBackend.PMTILES and m.pmtiles_size_bytes > 0
            else None
        ),
        "photon_url": (
            "/api/v1/geocode-photon"
            if m.search_backend == MapInfra.SearchBackend.PHOTON
            else None
        ),
    }
