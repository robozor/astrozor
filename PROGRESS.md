# Astrozor — Progress

> Single source of truth for development status. Updated by the autonomous developer (Claude) after each meaningful change.

**Last updated:** 2026-05-17
**Phase:** Krok 3 / 20 (Map + Places, read-only) — complete
**Status:** ✅ ready for tag `v0.3.0`
**Latest tag:** `v0.2.0` (Krok 2 — i18n)

---

## Currently working on

(idle — awaiting next iteration; will pick up Krok 4 next)

---

## Done milestones

- ✅ **Krok 0 — Docker baseline** (`v0.0.1` / `v0.0.2`)
- ✅ **Krok 1 — Authentication & profile** (`v0.1.0`)
- ✅ **Krok 2 — i18n + Weblate scaffold** (`v0.2.0`)
- ✅ **Krok 3 — Map + Places (read-only)** (`v0.3.0` pending). MapLibre on dev OSM rasters, 15 seeded CZ observatories, slide-in detail panel, kind/bbox filters. **11/11 E2E passing.**

---

## E2E coverage (Playwright)

| Krok | Tests |
|------|-------|
| 0 | 3 — heading, /healthz, /readyz |
| 1 | 3 — signup→logout (+MailHog), login, magic link |
| 2 | 2 — cs↔en switch+persist, authed profile sync |
| 3 | 3 — list places, bbox filter, marker→detail panel |
| **Total** | **11 ✓** in ~7 s |

---

## Endpoints

```
GET    /api/v1/healthz
GET    /api/v1/readyz
GET    /api/v1/csrf
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/magic-link
GET    /api/v1/auth/magic/{token}
GET    /api/v1/auth/verify/{token}
GET    /api/v1/auth/me
PATCH  /api/v1/accounts/profile
GET    /api/v1/places?bbox=&kind=&q=&limit=
GET    /api/v1/places/{slug}
GET    /api/v1/docs    (auto-generated OpenAPI 3.1)
```

---

## Blockers

See [`BLOCKERS.md`](./BLOCKERS.md). Six soft maintainer blockers + two technical-debt items (PostGIS migration, PMTiles bootstrap — both documented in ADR-005, not maintainer-blocked).

---

## Next planned step

**Krok 4 — Místa: CRUD + oprávnění + dočasná místa lifecycle**

- POST/PATCH/DELETE on /places.
- django-guardian for `place_owner` / `place_maintainer` roles.
- Temporary places — owner can create, auto-cleanup via Celery Beat when valid_to expires.
- Frontend: "Add temporary place" form.
- Storage quota enforcement infrastructure (model already has fields, now needs enforcement on uploads).

---

## Decisions made autonomously this Krok

- **ADR-005** — Defer PostGIS spatial column to Krok 3.x; use plain `FloatField` for lat/lon in MVP. Bbox queries via ORM with 4 inequality filters. Migration path to `geography(POINT, 4326)` documented.
- **OSM raster tiles for dev** instead of self-hosted PMTiles (also ADR-005). Saves ~700 MB download in MVP. Switch to PMTiles when production traffic or OSM policy warrants.
- **Place kind discriminator** kept simple (4 string values) rather than separate inheritance models. Easier filtering, single table.

---

## Recent activity

- 2026-05-17 — Krok 3 complete: places backend + seed (15 CR observatories), MapLibre frontend, 11/11 E2E green.
- 2026-05-17 — Krok 2 tagged `v0.2.0` (i18n).
- 2026-05-17 — Krok 1 tagged `v0.1.0` (auth).
- 2026-05-17 — Krok 0 baseline (`v0.0.1`/`v0.0.2`).
