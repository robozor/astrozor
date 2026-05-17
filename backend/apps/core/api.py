"""Core API endpoints — health check and version info."""

from __future__ import annotations

from django.db import connection
from ninja import NinjaAPI, Schema

api = NinjaAPI(
    title="Astrozor API",
    version="0.0.1",
    description="Astrozor backend API",
)


class HealthOut(Schema):
    status: str
    version: str
    database: str


@api.get("/healthz", response=HealthOut, tags=["meta"])
def healthz(request) -> dict[str, str]:  # noqa: ARG001
    """Liveness probe. Returns 200 if process is running."""
    return {"status": "ok", "version": "0.0.1", "database": "skipped"}


@api.get("/readyz", response=HealthOut, tags=["meta"])
def readyz(request) -> dict[str, str]:  # noqa: ARG001
    """Readiness probe. Verifies database connection."""
    db_status = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # pragma: no cover
        db_status = f"error: {exc.__class__.__name__}"
    return {"status": "ok" if db_status == "ok" else "degraded", "version": "0.0.1", "database": db_status}
