# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

## [1.2.4] — 2026-05-26

### Added

- **Admin delete actions** for the three big disk-eaters: drop the PMTiles archive, reset Photon data (stops container, wipes volume, restarts → fresh import), purge LP tile cache per source. Confirm dialog quotes the bytes that will be freed. All three refuse with 409 if a download is in progress. ([#18](https://github.com/robozor/astrozor/issues/18))
- **GitHub Release auto-creation**: `release.yml` now runs `softprops/action-gh-release@v2` after pushing images, so tagging `vX.Y.Z` produces the GHCR images *and* the matching GitHub Release page in one step. Notes are auto-generated from PRs/commits since the previous tag.
- **README status badges**: release version, CI status, Docker build status, MIT, last commit, open issues — all auto-tracked via shields.io.
- **`/healthz` reports the running release tag** (was hardcoded `0.0.1`). Tag is baked into the api image at build time via `ASTROZOR_VERSION` build-arg, exposed through `settings.ASTROZOR_VERSION`. ([#15](https://github.com/robozor/astrozor/issues/15))

### Fixed

- **Light pollution downloads fail with `Permission denied`**: `astrozor_light_pollution` named volume was creating its mount point as `root:root` because the image didn't pre-create the path; the celery worker (uid 1000) couldn't write. Added the dir to the Dockerfile's `mkdir -p` line so the subsequent `chown -R` covers it. ([#17](https://github.com/robozor/astrozor/issues/17))
- **OAuth callback error UX**: identity-conflict (and other backend `oauth_error` codes) now show a friendly localized message instead of `OAuth chyba: identity_owned_by_another_user`. New `auth.oauth.errors.<code>` i18n key set in cs/en. The identity-conflict flash gets 30 s display time instead of 5 s. ([#14](https://github.com/robozor/astrozor/issues/14))
- **Project activity graph stayed stale after add/remove repo**: `addRepo` and `removeRepo` mutations only invalidated `["project-repos", slug]`; the activity graph + issue leaderboard ran on separate query keys and required a page reload. Both mutations now invalidate all three. ([#16](https://github.com/robozor/astrozor/issues/16))

### Changed

- **PMTiles is *not* Europe-only** — the default download is the full world Protomaps Daily build (~130 GB). Dropped the misleading "Europe" label from the admin card title, the i18n keys, and the map-infra runbook; bumped the runbook's disk estimate from 100 GB → 150 GB. ([#19](https://github.com/robozor/astrozor/issues/19))
- **Backend lint clean**: 93 pre-existing ruff warnings cleared (unused imports, ambiguous loop vars, mis-placed module imports). `pyproject.toml` per-file-ignores for `B008` on Ninja route handlers and `E402` on bootstrap scripts.

## [1.2.3] — 2026-05-26

### Fixed

- **PWA service worker intercepted backend URLs**: vite-plugin-pwa's default `NavigationRoute` served the precached `index.html` for *any* navigation, including direct visits to `/api/v1/auth/<provider>/start`. The OAuth redirect to the provider never happened — the user saw the SPA shell at the wrong URL and stayed anonymous. Added an explicit `navigateFallbackDenylist` covering every backend-served prefix (`/api/`, `/admin/`, `/static/`, `/media/`, `/pmtiles/`, `/lp-tiles/`, `/R/`, `/vscode-extension/`, `/samples/`, `/clanky/`, `/articles.{atom,rss}`, `/sitemap.xml`, `/robots.txt`). Also enabled `cleanupOutdatedCaches`, `skipWaiting`, and `clientsClaim` so a future SW update replaces the old one immediately instead of waiting for every tab to close.

## [1.2.2] — 2026-05-26

### Fixed

- **OAuth callback over HTTPS proxy**: behind a TLS-terminating reverse proxy (DSM nginx, Cloudflare, …) Astrozor was building OAuth `redirect_uri` with `http://` even though the user browsed over `https://`, causing GitHub/Google/etc. to reject the callback. Two-place fix:
  - `docker/proxy/Caddyfile.prod`: declare upstream private ranges as `trusted_proxies` so Caddy preserves `X-Forwarded-Proto: https` from the outer proxy instead of appending its own `http` value.
  - `backend/astrozor/settings.py`: gate `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")` + `USE_X_FORWARDED_HOST = True` on the new `TRUST_FORWARDED_HEADERS` env (default `true` in prod, `false` in dev).

## [1.0.0-rc.1] — 2026-05-17

### Added — Krok 20: UI completion + cross-post

- **Projects UI** (`frontend/src/components/ProjectsPage.tsx`): list, detail with linked GitHub repos (stars / forks / issues / language), refresh & remove buttons, create form. Owner-only management. Re-uses user's connected GitHub `access_token` for per-user rate limit (5000 req/h vs anon 60).
- **Events UI** (`frontend/src/components/EventsPage.tsx`): list with status color-coding (7-state FSM), detail with register / cancel registration, iCal download link, organizer-only status transition controls.
- **Citizen science campaigns UI** (`frontend/src/components/CampaignsPage.tsx`): campaigns list with progress (accepted / total), detail with methodology, contribution submission form pre-filled from `contribution_schema`, coordinator review (accept / reject / needs_revision) with comments.
- **Top-nav tabs** in `App.tsx`: Map / Articles / Projects / Events / Campaigns / Settings.
- **Mastodon cross-post hook** (`backend/apps/accounts/mastodon_post.py` + wired in `apps/publishing/api.publish_article`): when an author with a connected Mastodon Identity publishes an article, post a status to their instance with title + summary + URL. Best-effort — failures swallowed so they never block publish.
- **i18n** keys `projects.*`, `events.*`, `campaigns.*`, `common.back` in both `cs.json` and `en.json`.
- Typed API clients for `projects`, `events`, `campaigns` in `frontend/src/lib/api.ts`.

### Fixed

- `oauth_start` now forwards `?instance=` query to `get_provider("mastodon", instance_url=…)` so per-user Mastodon registration flow can complete.
- OAuth callback URL is now derived from request Host so it works on both `http://localhost` (required by Google Cloud Console) and `http://astrozor.localhost`.

### Status

- All blockers resolved (`B-1`..`B-6`). Soft items remaining: replace synthetic ČAS seed with real data, opt-in Zenodo prod token per-user.
- 38/38 E2E tests passing.

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
