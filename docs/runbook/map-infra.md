# Runbook — Self-hosted map infrastructure

This guide explains how to switch Astrozor from the public external map
services (Nominatim, OSM raster tiles) to self-hosted equivalents
(PMTiles Europe + Photon). After this, Astrozor has **zero dependency**
on external rate-limited services for its primary map experience.

> **Audience:** Astrozor application administrator. Requires shell access
> on the host running the compose stack and an account in the Astrozor
> app with `is_staff = True`.

---

## 1. Prerequisites

| What | Why | Minimum |
|---|---|---|
| Disk space | PMTiles Europe build is ~80 GB. Photon DE/CZ extract is ~3 GB. | **100 GB free SSD** |
| RAM | Photon needs ~2 GB headroom at runtime; PMTiles is just file serving. | **4 GB free RAM** |
| Outbound bandwidth | One-time ~80 GB pull for PMTiles, ~1 GB for Photon import. | Stable connection |
| Maintenance | Refresh PMTiles every 1–4 weeks to stay current. | Cron or manual reminder |

---

## 2. PMTiles Europe (map tiles)

### 2.1 Trigger the download via admin UI

1. Sign into Astrozor as the staff user.
2. Open the **Admin** tab in the top nav.
3. In the **PMTiles Europe** card, edit the **Source URL** if needed
   (default points to a recent Protomaps Daily build; check
   <https://maps.protomaps.com/builds/> for the freshest date).
4. Click **Download**. The Celery worker streams the file to
   `/var/lib/astrozor/pmtiles/europe.pmtiles` (atomic — writes to
   `.part`, renames on success). Progress polls every 3 s.
5. When `Last update` populates and status flips to `idle`, click
   **Use this** in the same card. Tile backend in `/map/config`
   becomes `pmtiles`. All clients pick this up on next map load.

### 2.2 Manual / scripted refresh

If you prefer cron over the UI, the same Celery task can be triggered
from the shell:

```bash
docker compose -p astrozor exec api python manage.py shell -c "
from apps.admin_panel.tasks import download_pmtiles
download_pmtiles.delay()"
```

### 2.3 Verification

```bash
# File is present and recently modified
docker compose -p astrozor exec api ls -lh /var/lib/astrozor/pmtiles/

# Served through Caddy
curl -I http://localhost/pmtiles/europe.pmtiles | head
# Should be 200 + content-type: application/octet-stream
```

### 2.4 Rollback

In the admin UI, click **Switch back to OSM** on the PMTiles card. The
file stays on disk but `/map/config` reverts to `tile_backend: osm`,
so all clients fall back to public OSM tiles.

---

## 3. Photon (geocoding search)

### 3.1 Start the Photon container

```bash
docker compose -p astrozor --profile photon up -d photon
```

Container is `astrozor-photon`, listens internally on `:2322` and
mounts the `astrozor_photon_data` volume at `/photon/photon_data`.

### 3.2 Import OSM extract

Photon-docker (rtuszik/photon-docker) auto-imports an extract on first
run if `COUNTRY_CODE` is set (default `cz` in our compose). For larger
coverage edit compose:

```yaml
environment:
  COUNTRY_CODE: europe   # or de, fr, etc.
```

Then rebuild + restart:

```bash
docker compose -p astrozor --profile photon up -d --force-recreate photon
```

The import typically takes:

- `cz`: **15–30 min**, ~3 GB
- `de`: **2–4 h**, ~15 GB
- `europe`: **12–24 h**, ~60 GB

Tail logs to watch:

```bash
docker compose -p astrozor logs -f photon
```

### 3.3 Probe + activate

1. In the Astrozor **Admin** tab, scroll to the **Photon** card.
2. Click **Probe availability**. The backend calls
   `http://photon:2322/status` from inside the docker network; on
   success `Last import` populates and status flips to `idle`.
3. Click **Use this**. `/map/config` flips to `search_backend: photon`.
   The browser search box now routes through `/api/v1/geocode` →
   Photon container → no external traffic at all.

### 3.4 Verification

```bash
# From host (container exposes only inside docker network)
docker compose -p astrozor exec api curl -s "http://photon:2322/api?q=Praha&limit=3" | head -c 200
```

### 3.5 Refresh

Photon's data is OSM, so refreshing every few months is sane:

```bash
docker compose -p astrozor --profile photon down photon
docker volume rm astrozor_astrozor_photon_data    # discard old data
docker compose -p astrozor --profile photon up -d photon
```

---

## 4. Operational notes

- **Cache invalidation**: When you switch backends, the
  `/api/v1/geocode` endpoint keys its Redis cache by backend, so the
  old Nominatim results don't contaminate Photon answers and vice versa.
- **Public access**: Both `/pmtiles/*` and `/media/*` are publicly
  readable (no auth). PMTiles is by design public data; if you need to
  restrict access, add a Caddy `@authed` matcher and route through the
  Django session check.
- **Disk usage cap**: Until we wire a Caddy quota, monitor with
  `df -h $(docker volume inspect astrozor_astrozor_pmtiles -f '{{.Mountpoint}}')`.
- **Where status lives**: The `admin_map_infra` table (single row, pk=1)
  is the source of truth for which backend is active. The product admin
  in the React UI (Settings → Administrace → Map infra) edits the same
  row; `manage.py shell` can read/write it directly when the UI is
  unreachable. (Native Django admin at `/admin/` is intentionally not
  exposed — see [ADR-008](../decisions/ADR-008-disable-django-admin.md).)

---

## 5. What stays on external services

After this runbook the **only** external map service hits are from
optional alternate tile presets (Carto Dark / Esri Satellite /
OpenTopoMap). These are user-clickable from the map controls but
- are loaded only on demand,
- have client-side 429/403 detection that falls back to the primary tile
  layer automatically (see `MapView.tsx`).

If you want truly zero external traffic, restrict the layer switcher to
only `osm`/`pmtiles` by editing `STYLES` in `frontend/src/components/MapView.tsx`.
