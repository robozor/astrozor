"""Core API router — health check and version info."""

from __future__ import annotations

from django.conf import settings
from django.db import connection
from ninja import Router, Schema

router = Router(tags=["meta"])


class HealthOut(Schema):
    status: str
    version: str
    database: str


@router.get("/healthz", response=HealthOut)
def healthz(request) -> dict[str, str]:  # noqa: ARG001
    """Liveness probe. Returns 200 if process is running."""
    return {
        "status": "ok",
        "version": settings.ASTROZOR_VERSION,
        "database": "skipped",
    }


@router.get("/readyz", response=HealthOut)
def readyz(request) -> dict[str, str]:  # noqa: ARG001
    """Readiness probe. Verifies database connection."""
    db_status = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # pragma: no cover
        db_status = f"error: {exc.__class__.__name__}"
    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "version": settings.ASTROZOR_VERSION,
        "database": db_status,
    }
