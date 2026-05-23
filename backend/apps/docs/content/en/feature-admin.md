---
title: "Administration"
section: "3. Features"
order: 80
icon: "🛡"
---

# Administration (Admin panel)

The **Admin** section is available **only to staff users** (`User.is_staff = True`). Anonymous and regular users don't see the **Admin** button in the header; navigating to /admin in the UI hits a banner "This section isn't available".

The Astrozor admin panel has **4 sections**. (Native Django admin at `/admin/` is intentionally not exposed — see [ADR-008](https://github.com/robozor/astrozor/blob/main/docs/decisions/ADR-008-disable-django-admin.md).)

## 1) Users

Table of every registered user. Columns:

| Column | What it shows |
|---|---|
| **User** | email + display name |
| **Joined** | signup date |
| **Last login** | date + time (local format) |
| **Origin (IP / location)** | IP + country + city (geo-IP lookup) + flag |
| **Storage** | current `storage_used_bytes` / `storage_quota_bytes` |
| **Role** | toggle **+ admin** / **− admin** (is_staff) |
| **Status** | toggle **Block** / **Unblock** (is_active) |

Top bar: **search by email / name**.

### Use-case: Find and block a spammer

1. Open **Admin**
2. In the **Users** section, type part of the email or name in the search box
3. The table filters live (deferred query)
4. Find the row → click **Block** in the Status column
5. `is_active = False` → the user can't sign in (login flow rejects)
6. Their content (articles, comments, registrations) stays — soft block, not delete
7. For a full hard delete: `docker compose exec api python manage.py shell -c "from django.contrib.auth import get_user_model; get_user_model().objects.filter(email='...').delete()"`

### Use-case: Promote someone to admin

1. **Users** → search for that person
2. Click **+ admin** → `is_staff = True`
3. From now on they see the **Admin** nav tab and have access to this panel
4. For full superuser rights (`manage.py shell` access, not via web UI): open the shell → `u.is_superuser = True; u.save()`

> **Heads-up:** You can't demote yourself (`isMe` flag prevents lockout).

## 2) Places

The **AdminPlacesPanel** — management of places on the map.

### Actions

- **Create place** (`+ New place`) — form with fields for:
  - Title, description
  - Coordinates (lat/lon via mini-map or manually)
  - Bortle scale + SQM (sky quality)
  - Kind (`observatory_public` / `observatory_private` / `spot_permanent` / `spot_temporary`)
  - Operator, contact
- **Edit** existing places
- **Delete** a place (heads-up — also removes its check-ins, subscriptions, chat)
- **Merge duplicates** (when a user created a duplicate)

### Use-case: Add a new public observatory

1. **Admin → Places → + New place**
2. Title: "Karlovy Vary Observatory"
3. Coordinates: click the map or enter lat/lon by hand
4. Kind: `observatory_public`
5. Bortle: estimate from the VIIRS overlay (e.g. 5)
6. SQM: if known (e.g. 19.5 mag/arcsec²)
7. Operator + contact (optional)
8. **Save**

The place appears on the map immediately with the correct icon (dome with slit for `observatory_public`).

## 3) Zooniverse projects

Management of the link with [Zooniverse](https://www.zooniverse.org) — Astrozor is a portal into citizen-science campaigns.

### Features

- **Search** Zooniverse projects — search-as-you-type via the Panoptes API
- **Tag filter** — defaults to `astronomy`, you can change (`physics`, `space,nature`, empty = all)
- **Add** — links the project to Astrozor as a `ZooniverseProject` DB row
- **Patch** — toggle `is_featured` (project shows at the top of the citizen-science page) + edit tags
- **Remove (disconnect)** — disconnects the project, deletes local sprints, participants, snapshots (cascade count shown in the notification)

### Use-case: Add a new Zooniverse project

1. **Admin → Zooniverse projects**
2. In the search box type "galaxy" or "supernova"
3. The default `astronomy` tag filter restricts to astronomy projects
4. You see the list — Astrozor shows avatar, title, classifications count
5. Click **Add** on the project you want
6. A review modal opens with the full metadata preview
7. **Confirm** → the project is saved locally
8. From now on users see it in [Citizen Science](feature-citizen-science)

### Use-case: Disconnect a project

1. **Admin → Zooniverse projects** → find the project
2. Click **Disconnect**
3. The modal warns how many **sprints, participants, snapshots** will be deleted
4. **Confirm** → project + cascading data disappear
5. Flash banner: "Disconnected X project — Y sprints, Z snapshots deleted"

## 4) Map infrastructure

The most technical panel — manages self-hosted tile datasets and the geocoder.

### PMTiles card

**Self-hosted vector tiles for the entire map** (Protomaps format, ~130 GB for the world).

- **Status**: idle / running / error
- **Last update**: date of the last successful update
- **Size**: current archive size
- **Download / Refresh button** — fires a background job (live progress every 1.5 s)

### Photon card (geocoder)

**Self-hosted OpenStreetMap geocoder** for `apps.geocoding` (search for user locations and places).

- **Status**: idle / running / error
- **Phase**: downloading / extracting / ready
- **Country**: defaults to `cz` (env `COUNTRY_CODE`)
- **Pull data button** — fetches the current dump

### Light Pollution card

**Map overlay for light pollution**.

- **Source switcher** — `viirs_dnb_latest` (current NOAA) vs `black_marble_2016` (historical NASA)
- **Tile count** + size — how many tiles are downloaded
- **Refresh latest** — re-fetches the newest VIIRS data

### Chat settings

- **Max chat message length** — slider 200–50,000 chars
- Default 4000

### Use-case: Pull the latest Light Pollution

1. **Admin → Light Pollution card**
2. **Source**: pick `viirs_dnb_latest` (current monthly data from NOAA)
3. Click **Refresh latest**
4. A background job downloads the new dataset (~1 hour)
5. The UI tracks progress live (refresh 1.5 s)
6. When done, the main-map overlay updates automatically

> **Heads-up:** Don't restart the api container while a download is running — it'll interrupt.

## 5) Advanced tasks (shell)

The native Django admin at `/admin/` is **not exposed** (see [ADR-008](https://github.com/robozor/astrozor/blob/main/docs/decisions/ADR-008-disable-django-admin.md)). Raw DB inspection and anything outside the product admin's scope happens through the Django shell:

```bash
docker compose -p astrozor exec api python manage.py shell
```

The shell gives you full ORM access to every model. For bulk changes, prefer `manage.py` commands (validation, transactions).

## Logs and monitoring

In the api container:

```bash
docker compose -p astrozor logs -f api
docker compose -p astrozor logs -f worker  # Celery jobs (Zenodo, Discord dispatch, …)
```

Health endpoint: `GET /api/v1/health` (returns 200 OK if DB + Redis work).

## Best practices for admins

1. **For bulk data changes, prefer management commands or the Astrozor admin panel** (more validation than the bare shell)
2. **Places**: before deleting, check whether it has check-ins / subscriptions / chat
3. **Zooniverse**: disconnect is destructive — sprints cascade-delete
4. **PMTiles / Light Pollution download**: run off-peak, traffic-heavy job
5. **User blocking**: prefer soft block (`is_active=False`) over delete — the user's content remains citable
