# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

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
