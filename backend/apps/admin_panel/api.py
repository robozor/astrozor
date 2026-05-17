"""Admin endpoints for managing self-hosted map infrastructure.

All routes here require `request.user.is_staff = True`. The 'admin' app
in Django already has its own UI at /admin/, but we expose these
operations through the same Ninja API so the SPA can render a friendly
admin section instead of falling back to Django's stock admin pages.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

from .models import MapInfra
from .tasks import download_pmtiles, import_photon

router = Router(tags=["admin"])


def _require_staff(request: HttpRequest) -> bool:
    return bool(
        getattr(request, "user", None)
        and request.user.is_authenticated
        and request.user.is_staff
    )


def _infra_out(m: MapInfra) -> dict:
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
        },
        "photon": {
            "url": m.photon_url,
            "last_import": m.photon_last_import,
            "status": m.photon_status,
            "status_message": m.photon_status_message,
            "imported_size_mb": m.photon_imported_size_mb,
            "available": m.photon_last_import is not None
            and m.photon_status != MapInfra.JobStatus.ERROR,
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
