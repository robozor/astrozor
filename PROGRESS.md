# Astrozor — Progress

> Single source of truth for development status. Updated by the autonomous developer (Claude) after each meaningful change.

**Last updated:** 2026-05-17
**Phase:** Krok 2 / 20 (i18n + Weblate scaffold) — complete
**Status:** ✅ ready for tag `v0.2.0`
**Latest tag:** `v0.1.0` (Krok 1 — Authentication & profile)

---

## Currently working on

(idle — awaiting next iteration; will pick up Krok 3 next)

---

## Done milestones

- ✅ **Krok 0 — Docker baseline** (`v0.0.1` / `v0.0.2`). 7-container stack, `/api/v1/healthz` + `/readyz`, Caddy proxy on :80, Vite dev with HMR through proxy, Playwright scaffold (3/3 passing).
- ✅ **Krok 1 — Authentication & profile** (`v0.1.0`). Custom User model (UUID, email), Profile + EmailToken models, hand-rolled email/password + magic link auth, MailHog for dev SMTP, frontend auth UI (tabbed Login/Signup/Magic-link), 6/6 E2E passing.
- ✅ **Krok 2 — i18n + Weblate** (`v0.2.0` pending). Django i18n + ProfileLanguageMiddleware, react-i18next with cs/en bundles, LanguageSwitcher in header, profile.language sync for authenticated users, Weblate scaffold in compose (profile-gated). **8/8 E2E passing.**

---

## E2E coverage (Playwright)

- **Krok 0** (3): heading visible, `/healthz` 200, `/readyz` DB connected.
- **Krok 1** (3): signup → authenticated → logout (w/ MailHog assertion), login, magic-link generic response.
- **Krok 2** (2): cs↔en switch + reload persistence; authenticated profile.language sync.

Full suite (8 tests) runs in ~5 s. Run via `make e2e` (target to add) or:
`docker compose -p astrozor -f docker-compose.yml -f compose/docker-compose.e2e.yml --profile e2e run --rm e2e`

---

## Endpoints available

Same as Krok 1 plus all responses now respect Accept-Language / profile.language for authenticated users.

---

## Blockers

See [`BLOCKERS.md`](./BLOCKERS.md). Six soft blockers, none preventing current progress.

---

## Next planned step

**Krok 3 — Mapa + Místa (read-only)**

- `apps/places` Django app: Place model with PostGIS `geography(POINT, 4326)`, type discriminator (`observatory_public`/`observatory_private`/`spot_permanent`/`spot_temporary`).
- API: `GET /api/v1/places?bbox=...&type=...&filter=...` with cluster hints.
- PMTiles serving infrastructure (Protomaps Daily Europe build).
- MapLibre on frontend.
- Detail panel (slide-in) — read-only for this Krok.
- Seed script for 15 Czech observatories (synthetic until ČAS data arrives, B-2).

---

## Decisions made autonomously this Krok

- **Weblate behind `--profile weblate`** — not started by default. Adds ~1 GB to image weight; activated when translation contributions are opened (typically at v1.0-rc). Documented in `docs/runbook/weblate.md`.
- **i18next via `i18next-browser-languagedetector`** with `localStorage` cache (key `astrozor_lang`). Order: localStorage → navigator → htmlTag.
- **String extraction strategy** — all current strings in `cs.json` + `en.json`, flat 4 namespaces (common/lang/auth/profile). Future Kroks contribute to the same files.

---

## Recent activity

- 2026-05-17 — Krok 2 complete: backend i18n middleware, frontend i18next, LanguageSwitcher, Weblate scaffold. 8/8 E2E green.
- 2026-05-17 — Krok 1 tagged `v0.1.0` with GitHub release.
- 2026-05-17 — Krok 0 baseline (`v0.0.1`/`v0.0.2`).
