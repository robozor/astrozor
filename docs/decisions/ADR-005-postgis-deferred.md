# ADR-005 — PostGIS spatial queries deferred to Krok 3.x

**Status:** accepted
**Date:** 2026-05-17

## Context

The spec calls for `Place` with `geography(POINT, 4326)` via `django.contrib.gis`. Using GeoDjango requires GDAL/GEOS/PROJ libraries inside the api container, adding ~400 MB to the base image and complicating the build chain. Krok 3 needs a working map and place listing — not yet large-scale spatial queries.

## Decision

- `Place` model uses **plain `FloatField`** for `lat`/`lon`. No `django.contrib.gis`, no PostGIS type column.
- Bbox queries filter via standard Django ORM: `lat__gte=...&lat__lte=...&lon__gte=...&lon__lte=...`.
- The DB container remains `postgis/postgis:16-3.4-alpine` — when we add proper spatial features, the extension is already there.
- Migration to PostGIS happens in **Krok 3.x** (or whenever query performance / "near me" features demand it):
  1. Add GDAL/GEOS to `Dockerfile.python` base image.
  2. Add `django.contrib.gis` to `INSTALLED_APPS`.
  3. Change `lat`/`lon` to `geography(POINT, 4326)` via data migration.
  4. Replace bbox filter with `ST_Within` on PostGIS column.

Cost of deferral: at MVP scale (10s–100s of places per bbox), no perceptible difference. Map UI is unaffected.

## Tile serving (PMTiles vs OSM raster)

Related simplification: Krok 3 uses **OpenStreetMap raster tiles** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) for dev. This avoids the PMTiles bootstrap (download Europe build ~700 MB to MinIO, configure pmtiles:// protocol).

PMTiles is the **production target** (per Q5 decision = D, scope Europe). Migration happens in **Krok 3.x**:
- Download `europe.pmtiles` from Protomaps Daily builds (~700 MB).
- Serve via Caddy with byte-range support (or via MinIO presigned URLs).
- MapLibre style references `pmtiles://...` protocol via `pmtiles` plugin.

For Krok 3 acceptance, an OSM raster background + filled marker layer is sufficient. **OSM attribution** is rendered in the map UI as required by the OSMF tile usage policy.

## Consequences

- Faster Krok 3 delivery, smaller image.
- Two deferred follow-ups recorded in `BLOCKERS.md` as **technical debt** (not maintainer-blocked):
  - T-1: PostGIS migration of Place model (when spatial queries are needed).
  - T-2: PMTiles Europe bootstrap (when OSM tile policy becomes a concern or production traffic warrants self-host).
- Self-hostability statement (`docs/README` / quickstart) remains accurate — both upgrades are documented procedures, not architectural rewrites.
