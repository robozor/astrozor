# Astrozor — Progress

> Single source of truth for development status. Updated by the autonomous developer (Claude) after each meaningful change.

**Last updated:** 2026-05-17
**Phase:** Krok 1 / 20 (Authentication & profile) — complete
**Status:** ✅ ready for tag `v0.1.0`
**Latest tag:** `v0.0.2` (Krok 0 — Foundation, E2E green)

---

## Currently working on

(idle — awaiting next iteration; will pick up Krok 2 next)

---

## Done milestones

- ✅ **Krok 0 — Docker baseline** (tag `v0.0.1` / `v0.0.2` fix). 7-container stack, `/api/v1/healthz` + `/readyz` green, Caddy proxy on :80, Vite dev server with HMR through proxy, Playwright E2E scaffold (3/3 passing).
- ✅ **Krok 1 — Authentication & profile** (tag `v0.1.0` pending). Custom User model (UUID, email), Profile model with 5 GiB quota and language/timezone/Discord-webhook fields, EmailToken model (verify + magic link + reset). Hand-rolled auth (no allauth in MVP — OAuth providers will plug in when credentials available, see BLOCKERS). MailHog captures auth e-mails for dev. 6/6 E2E passing.

---

## Endpoints available (live)

- `GET /api/v1/healthz` — liveness
- `GET /api/v1/readyz` — readiness (with DB ping)
- `GET /api/v1/csrf` — CSRF token bootstrap (kept for future use)
- `POST /api/v1/auth/signup` — email + password registration, fires verification e-mail
- `POST /api/v1/auth/login` — password login
- `POST /api/v1/auth/logout` — clear session
- `POST /api/v1/auth/magic-link` — request passwordless link
- `GET /api/v1/auth/magic/{token}` — consume magic-link
- `GET /api/v1/auth/verify/{token}` — consume verification token
- `GET /api/v1/auth/me` — current user + profile
- `PATCH /api/v1/accounts/profile` — partial profile update
- `GET /api/v1/docs` — OpenAPI 3.1 (auto by Django Ninja)

---

## E2E coverage (Playwright)

- Krok 0 (3 tests): heading visible, `/healthz` 200, `/readyz` DB connected.
- Krok 1 (3 tests): signup → authenticated → logout (with MailHog assertion), login with existing user, magic link generic response.

---

## Blockers

See [`BLOCKERS.md`](./BLOCKERS.md). Six soft blockers — none preventing current progress. GitHub/Google OAuth credentials will enable full Krok 1 acceptance; current MVP uses email-only auth.

---

## Next planned step

**Krok 2 — i18n infrastructure + Weblate**

- Django gettext + `django-modeltranslation` for translatable models.
- Frontend `react-i18next` with cs/en namespaces.
- Weblate in compose (decision Q4 = A: hned od Kroku 2).
- Language switcher in UI, persisted to user profile.

---

## Decisions made autonomously this Krok

- **ADR-004** — CSRF strategy: SameSite=Lax cookies, no API CSRF tokens. Simpler client code, accepted trade-off for MVP.
- **Skip django-allauth in MVP** — hand-rolled email/password + magic link + verification is simpler. Allauth comes back when OAuth providers (GitHub/Google) need integration (B-1, B-3).
- **Email validation** — switched from Pydantic `EmailStr` to a regex-based custom validator that accepts `.localhost`/`.test` TLDs (special-use names rejected by RFC-strict email-validator). Real email deliverability is enforced by SMTP, not by request validation.
- **DB reset** — accepted destructive `down -v` for Krok 1 because schema diverged (custom AUTH_USER_MODEL). Acceptable in pre-1.0 dev.

---

## Recent activity

- 2026-05-17 — Krok 1 complete: backend accounts app (4 modules), frontend auth UI (single file with tabs), MailHog in compose, E2E auth tests passing.
- 2026-05-17 — Krok 0 E2E suite trimmed to true foundation regression checks.
- 2026-05-17 — Krok 0 acceptance verified; tagged `v0.0.1` and `v0.0.2`.
