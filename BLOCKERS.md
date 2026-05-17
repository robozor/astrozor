# Astrozor — Blockers

> Single source of truth for items waiting on the human maintainer. The autonomous developer (Claude) checks this list before each iteration and works around blockers when possible.

**Last updated:** 2026-05-17

---

## How this works

When the autonomous developer needs something from the human that cannot be self-resolved, an entry is added here. The developer continues with other work in the meantime and notifies when reaching a natural pause point. The human resolves the blocker (provides credentials, data, decision, etc.) and the developer resumes in the next iteration.

---

## Active blockers

### 🔵 Soft (don't block start, will block specific later Krok)

#### ~~B-1 — GitHub OAuth~~ — **resolved 2026-05-17**

OAuth App `Ov23liDVuKvNiSyzAEhb` registered. Backend wired:
- `GET  /api/v1/auth/github/start` redirects to GitHub authorize
- `GET  /api/v1/auth/github/callback` exchanges code, creates/links `Identity`, stores access_token, logs in
- `GET  /api/v1/accounts/identities` — list own connected providers
- `DELETE /api/v1/accounts/identities/{id}` — disconnect (blocks last identity removal if user has no password)
- `POST /api/v1/auth/resend-verification` — re-send verify email

Per-user `access_token` lifts the `projects.github.fetch_repo_metadata()` rate limit from 60 req/h (anon) to 5000 req/h (per-user).

Frontend has "Sign in with GitHub" button in unauth view. Profile UI for connect/disconnect is a follow-up.

#### B-2 — Reálná data ČAS pro seed *(blocks Krok 3 final acceptance)*

**What:** Seznam hvězdáren / stanovišť ČR (CSV/JSON s polemi: název, lat, lon, typ, kontakt, web).
**How to resolve:** Umísti do `seed-data/cas/places.csv` nebo dej URL ke stažení.
**Workaround:** Krok 3 dokončím s vygenerovanou ukázkou 15 hvězdáren (reálné polohy známých hvězdáren ČR — z veřejných údajů). Tvá data nahradí seed když je dodáš.

#### B-3 — Google OAuth credentials *(blocks full Krok 1 acceptance)*

**What:** Google Cloud project + OAuth 2.0 client.
**How to resolve:**
1. https://console.cloud.google.com/apis/credentials
2. Create project `Astrozor (dev)` → OAuth client ID → Web application
3. Authorized redirect URIs: `http://astrozor.localhost/auth/google/callback`
4. Add to `.env` as `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`

**Workaround:** Stejné jako B-1 — email-only auth funguje, Google OAuth doplníme.

#### B-4 — Mastodon OAuth registration *(blocks Krok 13)*

**What:** Decision on which Mastodon instance to register Astrozor as application (default `mastodon.social`).
**Workaround:** Plánováno až v Kroku 13, není akutní.

#### B-5 — Zenodo Sandbox API token *(blocks Krok 11 DOI)*

**What:** API token pro `sandbox.zenodo.org` (test) a `zenodo.org` (prod).
**How to resolve:**
1. Vytvořit účet na https://sandbox.zenodo.org/
2. *Settings → Applications → New token*
3. Scopes: `deposit:write deposit:actions`
4. Add to `.env` as `ZENODO_SANDBOX_TOKEN` (a později `ZENODO_PROD_TOKEN`)

**Workaround:** Krok 11 ukáže DOI mintování proti Zenodo sandbox; pokud token chybí, mockuju.

#### B-6 — Discord test webhook URL *(soft — only for testing Krok 9)*

**What:** Test Discord webhook pro ověření doručení notifikací.
**How to resolve:** Discord server → channel settings → Integrations → Webhooks → New → copy URL → `.env` `DISCORD_TEST_WEBHOOK_URL`.
**Workaround:** Mockuju s `httpx-mock`, reálný test až s URL.

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
