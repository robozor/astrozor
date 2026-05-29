# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

## [1.2.10] — 2026-05-29

### Fixed

- **Zooniverse project descriptions rendered tables / sized images / new-tab links as raw markdown source** — `CitizenSciencePage` used a plain `<p whitespace-pre-wrap>` for `introduction` / `description`, which left GFM tables (`| ---- |`), Zooniverse's `=NNNx` image-sizing syntax and the `+tab+` link prefix visible as unparsed source on pages like `Galaxy Zoo: Clump Scout II`. Now rendered via Zooniverse's own `markdownz` package (Apache 2.0) so the Astrozor output matches the upstream project page. Scope is limited to citizen-science descriptions; articles / docs / chat keep their existing server-side markdown pipeline. See [ADR-009](./docs/decisions/ADR-009-zooniverse-markdownz.md) for the dependency rationale.

## [1.2.9] — 2026-05-29

### Fixed

- **VIIRS DNB "Aktualizovat na poslední" returned 405 Method Not Allowed** — `POST /admin/map-infra/light-pollution/refresh` collided with the earlier-declared `DELETE /admin/map-infra/light-pollution/{source}` because Django URL resolution is first-match-wins and the wildcard `{source}` matched the literal `refresh`. The handler for that pattern only accepts DELETE, so POST was rejected before reaching the refresh handler. The refresh route is now declared before the wildcard DELETE; behaviour and contract are unchanged.

### Changed

- **"Aktualizovat na poslední" button hidden once tiles match the latest known DNB date** — backend already computes `viirs_dnb.cached` as `tile_count > 0 AND cached_date === dnb_date`. The admin button is now gated on `!viirs_dnb.cached`, so it disappears the moment a download finishes for the date the backend currently tracks. Clicking it in that state would have been a no-op against GIBS anyway.

## [1.2.8] — 2026-05-29

### Changed

- **Article language filter defaults to "All" regardless of profile / UI language** — previously the chip on the article list initialised to `cs` for Czech UI and `en` for English UI, which hid the other half of the catalogue from first-time visitors. The default is now always `all`; users explicitly opt into narrowing per browsing session. The lift-up of filter state to `ArticlesPage` is unchanged, so the choice still survives the list ↔ detail roundtrip.

## [1.2.7] — 2026-05-28

### Fixed

- **Anonymous visitors stuck on "Načítám…" splash** — `App` was rendering a full-screen spinner while the `/auth/me` query was in flight, blocking the SPA shell from mounting until the round-trip resolved (typically 100–200 ms, but indefinitely on slow network or service-worker glitches). Anonymous users now see the `AnonApp` (article list, map, events) immediately; authed users get a brief anon flash then swap to `AuthedApp` once `/auth/me` resolves. This fixes the reported "sometimes article pages and article list don't load" symptom on www.astrozor.cz without login.

## [1.2.6] — 2026-05-26

### Added

- **Pause / resume for the long PMTiles + Photon downloads** — new ⏸ Pause chip on each admin card, visible only while the respective job is running. For PMTiles the celery task is revoked (terminate=True) and the `.part` stays on disk; the next Download click resumes via the existing HTTP `Range:` request. For Photon the container is stopped via the Docker socket; restarting the container picks up the partial dump where it left off. New `JobStatus.PAUSED` enum + migration 0008. ([#25](https://github.com/robozor/astrozor/issues/25))

### Fixed

- **Event meeting / Discord URLs leaked to anyone who could see the event** — `meeting_url`, `discord_url`, `geocache_url`, `radio_frequency` are now masked to `""` unless the viewer passes the same `can_view_discussion` check that already gates the chat. The SPA chip renders only when the URL is set, so it just disappears for out-of-circle viewers. Event form field renamed from "Viditelnost diskuse" to "Viditelnost diskuse a možnost připojení k online setkání" with a hint explaining the new semantics. ([#24](https://github.com/robozor/astrozor/issues/24))

## [1.2.5] — 2026-05-26

### Added

- **Temporary places: `valid_to` is editable** — datetime-local picker in the place form, shown only for `spot_temporary`. Default = now + 4 h (matches the backend's old hidden default). Edit mode pre-fills the existing value so the owner can extend a place that's about to expire. ([#21](https://github.com/robozor/astrozor/issues/21))

### Fixed

- **Expired temporary places now visible to owner + admin** — backend `/places` listing and `/places/{slug}` used to hide expired temp places from *everyone* including the owner, so the user had no way to find, extend, or delete them. Now public still sees them disappear; owner + staff keep them on the map rendered desaturated + 50 % opacity (struck-through-look) with the full edit / delete actions available. ([#21](https://github.com/robozor/astrozor/issues/21))
- **Modal backdrop click no longer silently discards form data** — PlaceFormModal, LoginModal, Zooniverse import-review + disconnect modals, and the CSV import preview each had `onClick={onClose}` on the backdrop wrapper. A misclick anywhere outside the inner box dropped the entire form. Backdrop click is now a no-op on these form modals; closing happens through ✕ in the header and Cancel buttons. ([#20](https://github.com/robozor/astrozor/issues/20))
- **Draft events were invisible to the organizer in the listing** — `/events` had a blanket `.exclude(status=DRAFT)` that hid drafts from everyone, including the user who just created the event. Now drafts are hidden from anon + other authed users only; the organizer and staff see their own drafts (matching the per-event GET policy that was already correct). ([#22](https://github.com/robozor/astrozor/issues/22))

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
