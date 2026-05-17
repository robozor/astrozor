# Astrozor — Blockers

> Single source of truth for items waiting on the human maintainer. The autonomous developer (Claude) checks this list before each iteration and works around blockers when possible.

**Last updated:** 2026-05-17

**Overall status:** ✅ All blockers resolved for `v1.0.0-rc.1`. Open items below are soft / forward-looking (real data, prod tokens, T-1/T-2 tech debt).

---

## How this works

When the autonomous developer needs something from the human that cannot be self-resolved, an entry is added here. The developer continues with other work in the meantime and notifies when reaching a natural pause point. The human resolves the blocker (provides credentials, data, decision, etc.) and the developer resumes in the next iteration.

---

## Active blockers

### 🔵 Soft (don't block start, will block specific later Krok)

#### ~~B-1 — GitHub OAuth~~ — **resolved 2026-05-17**

OAuth App `Ov23liDVuKvNiSyzAEhb` registered. Callback URL **must be** `http://astrozor.localhost/api/v1/auth/github/callback` (with `/api/v1/` prefix). Production instance updates this in the same place to the public hostname.

Backend wired:
- `GET  /api/v1/auth/github/start` redirects to GitHub authorize
- `GET  /api/v1/auth/github/callback` exchanges code, creates/links `Identity`, stores access_token, logs in
- `GET  /api/v1/accounts/identities` — list own connected providers
- `DELETE /api/v1/accounts/identities/{id}` — disconnect (blocks last identity removal if user has no password)
- `POST /api/v1/auth/resend-verification` — re-send verify email

Per-user `access_token` lifts the `projects.github.fetch_repo_metadata()` rate limit from 60 req/h (anon) to 5000 req/h (per-user).

Frontend has "Sign in with GitHub" button in unauth view. Profile UI for connect/disconnect is a follow-up.

#### B-2 — Reálná data ČAS pro seed *(soft, post-v1)*

**What:** Seznam hvězdáren / stanovišť ČR (CSV/JSON s polemi: název, lat, lon, typ, kontakt, web).
**How to resolve:** Umísti do `seed-data/cas/places.csv` nebo dej URL ke stažení.
**Workaround:** Aplikace běží se synthetic seedem 15 hvězdáren z veřejných údajů — funkčně ekvivalentní pro v1. Tvá data nahradí seed když je dodáš (import job stačí spustit).

#### ~~B-3 — Google OAuth~~ — **resolved 2026-05-17**

Google OAuth client registered. Redirect URI is `http://localhost/api/v1/auth/google/callback` (Google rejects `astrozor.localhost` in its console form; `localhost` is allowed). Callback URL on backend is dynamic from the request Host header, so opening the app on `http://localhost` keeps cookies consistent through the OAuth round-trip.

Re-uses the same Identity / access_token machinery as B-1. Settings page shows Google as clickable "Connect Google" once `/auth/providers` reports it configured.

#### ~~B-4 — Mastodon OAuth~~ — **resolved 2026-05-17**

Resolved with **per-user dynamic app registration** instead of a platform-wide pre-registered app. Each user enters their instance hostname in Settings; the backend POSTs to `/api/v1/apps` on that instance to obtain per-instance `(client_id, client_secret)`, stores them in `MastodonInstance`, and re-uses them for every subsequent user from that same server.

Scopes: `read:accounts read:statuses write:statuses` (sufficient for login + cross-post).

Cross-post hook in `apps/publishing/api.publish_article()` posts a status to the author's Mastodon when an article is published, best-effort (failures swallowed).

#### B-5 — Zenodo Sandbox API token *(soft — per-user, falls back to MOCK)*

**What:** API token pro `sandbox.zenodo.org` (test) a `zenodo.org` (prod).
**Resolution model:** Per-user (ne per-instance) — uživatel si svůj token vloží v Settings → Integrations. Aplikace pak při publikaci článku mintuje DOI proti **tomu** Zenodo účtu. Pokud token chybí, DOI se vygeneruje jako MOCK (`10.5281/zenodo.mock-<uuid>`) — článek se publikuje normálně.
**How to resolve (volitelné):**
1. Vytvořit účet na https://sandbox.zenodo.org/
2. *Settings → Applications → New token*
3. Scopes: `deposit:write deposit:actions`
4. Vlož ho v Astrozor Settings → Integrations → Zenodo API token

#### ~~B-6 — Discord webhook~~ — **resolved 2026-05-17**

Per-user Discord webhook URL field v `profile.discord_webhook_url`, viditelný v Settings → Integrations. Notifikace se posílají na uživatelův webhook při subscribed event (chat zpráva, article comment, atd.).

---

## Technical debt (NOT maintainer-blocked, but tracked here for visibility)

#### T-1 — PostGIS migration of Place model *(deferred from Krok 3)*

**What:** Migrate `Place.lat/lon` from `FloatField` to `geography(POINT, 4326)` so we can do `ST_Within`, `ST_Distance` queries efficiently.
**Trigger:** When place count grows past a few thousand OR when "places near me" feature is needed.
**Steps:** Add GDAL/GEOS to `Dockerfile.python`, enable `django.contrib.gis`, data migration to populate the new column, switch API filter to spatial.
**Reference:** ADR-005.

#### T-2 — PMTiles Europe bootstrap *(deferred from Krok 3)*

**What:** Replace dev OSM raster tiles with self-hosted PMTiles (Europe extract from Protomaps Daily builds).
**Trigger:** When OSM tile usage policy becomes a concern (~production traffic) or when offline / self-host pure setup is required.
**Steps:** Download `europe.pmtiles` (~700 MB), upload to MinIO, configure Caddy byte-range serving, add `pmtiles` MapLibre plugin to frontend, update style to use `pmtiles://` protocol.
**Reference:** ADR-005, runbook `docs/runbook/map-update.md` (to be written).

---

## Resolved blockers

(none yet)

---

## Decision-needed items

(none currently — all major decisions in `requirements/decisions-qa.md` resolved, žádné ve frontě)
