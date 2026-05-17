# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

## [0.3.0] — 2026-05-17

### Added — Krok 3: Map + Places (read-only)
- `apps/places` Django app with `Place` model (UUID, slug, kind discriminator, lat/lon as float — see ADR-005 — status, description, lat/lon, elevation, address, contact, opening hours, Bortle class, valid_from/valid_to for temporary places).
- Place kinds: `observatory_public`, `observatory_private`, `spot_permanent`, `spot_temporary`.
- API endpoints:
  - `GET /api/v1/places?bbox=lon_min,lat_min,lon_max,lat_max&kind=...&q=...&limit=...`
  - `GET /api/v1/places/{slug}`
- Seed command `python manage.py seed_places` populates 15 well-known CR observatories and spots (Štefánikova, Brno, Plzeň, Ondřejov, Valašské Meziříčí, Hradec Králové, Karlovy Vary, Vsetín, Úpice, Jindřichův Hradec, Sedlčany + 4 dark-sky spots). Idempotent (upsert by slug).
- Frontend `MapView` component (MapLibre GL via `react-map-gl/maplibre`):
  - OSM raster tile background (ADR-005 — PMTiles deferred).
  - Color-coded markers per kind.
  - Slide-in detail panel with full place info on marker click.
- Translation keys `places.*` in both `cs.json` and `en.json`.
- 3 Playwright tests for Krok 3 acceptance.
- ADR-005 — PostGIS + PMTiles deferred to Krok 3.x. Trade-offs and migration path documented.

### Changed
- Authenticated home view now renders MapView prominently with a compact profile/logout strip below.
- Step badge updated to "Krok 3".

### Deferred (tech debt)
- T-1 PostGIS migration of Place lat/lon to `geography(POINT, 4326)`.
- T-2 PMTiles Europe bootstrap (download Protomaps Daily build, serve via Caddy/MinIO).

## [0.2.0] — 2026-05-17

### Added — Krok 2: i18n + Weblate scaffold
- Django i18n: `LocaleMiddleware`, `LOCALE_PATHS`, `LANGUAGE_COOKIE_NAME=astrozor_lang`.
- `ProfileLanguageMiddleware` — for authenticated users, overrides request language with `profile.language`.
- Frontend i18next setup with cs/en JSON bundles and `i18next-browser-languagedetector`.
- All UI strings extracted to `frontend/src/i18n/{cs,en}.json` (common, lang, auth, profile namespaces).
- `LanguageSwitcher` component in the header — CS / EN toggle. For authenticated users, the choice is persisted to `profile.language` via PATCH.
- Weblate compose scaffold (`compose/docker-compose.weblate.yml`) behind `--profile weblate`. Includes weblate + dedicated postgres + reuses shared redis/mailhog.
- Runbook: `docs/runbook/weblate.md` with setup procedure, GitHub integration steps.
- 2 Playwright tests for Krok 2 acceptance (cs↔en switch + reload persistence, authenticated user profile sync).

### Changed
- `App.tsx` rewired to use `useTranslation()` and translation keys for every visible string.
- `data-testid` attributes added to tabs (`tab-login`/`tab-signup`/`tab-magic`) and language buttons (`lang-cs`/`lang-en`) for stable E2E selectors that don't depend on translated text.

## [0.1.0] — 2026-05-17

### Added — Krok 1: Authentication & profile
- Custom `accounts.User` model (UUID primary key, email as username).
- `Profile` model — display name, bio, equipment, language (cs/en), timezone, GPS location with visibility (precise/region/hidden, default precise), Discord webhook URL, storage usage tracking, onboarding flag.
- `EmailToken` model — verification, magic link, password reset (one-time, expiring).
- Auth endpoints: `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/magic-link`, `/auth/magic/{token}`, `/auth/verify/{token}`.
- Profile endpoint: `/accounts/profile` (PATCH).
- Auth e-mails sent via MailHog (dev SMTP capture, exposed at `localhost:8025`).
- Frontend auth UI: tabbed Login / Signup / Magic-link form, authenticated home with profile preview and logout.
- `@tanstack/react-query` wired for `/auth/me` polling + mutation cache invalidation.
- 3 Playwright tests for Krok 1 acceptance (signup→logout, login, magic-link).
- ADR-004 — CSRF strategy: SameSite=Lax cookies, no API CSRF tokens.

### Changed
- Central Django Ninja API in `astrozor.api` composes routers from apps (`core`, `accounts`).
- Apps export `Router` instances; previously each app used a `NinjaAPI`.

### Fixed
- Krok 0 E2E spec trimmed to foundation-only checks (heading + API endpoints) so it stays green across future UI changes.

## [0.0.1] — 2026-05-17 (planned)

Initial Docker baseline. Stack runs locally with placeholder pages.

### Added
- Monorepo scaffold (`backend/`, `frontend/`, `clients/`, `docker/`, `docs/`, `e2e/`).
- Docker compose stack: PostgreSQL+PostGIS, Redis, MinIO, Django API stub, Vite/React frontend stub, Caddy reverse proxy.
- `/api/v1/healthz` endpoint returning JSON `{"status": "ok"}`.
- Frontend placeholder page rendering "Astrozor — Krok 0".
- GitHub Actions CI: lint + smoke test.
- Governance: LICENSE (MIT), PROGRESS.md, BLOCKERS.md, ADR-001..003.
