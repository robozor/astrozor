# Astrozor — Progress

> Single source of truth for development status. Updated by the autonomous developer (Claude) after each meaningful change.

**Last updated:** 2026-05-17
**Phase:** Krok 18+19 / 20 (Final hardening + PWA)
**Status:** ✅ All unblocked Kroky complete
**Latest tag:** `v0.14.0`
**E2E:** 38/38 passing across 15 spec files

---

## All milestones

| Tag | Krok | Highlight | E2E |
|-----|------|-----------|-----|
| `v0.0.1` / `v0.0.2` | 0 — Foundation | Docker stack, Caddy proxy, CI | 3 |
| `v0.1.0` | 1 — Auth | Custom User (UUID, email), magic link, MailHog, 5 GB quota | +3 |
| `v0.2.0` | 2 — i18n | react-i18next cs/en, Weblate scaffold, profile.language sync | +2 |
| `v0.3.0` | 3 — Map | MapLibre + OSM raster + 15 seeded CZ observatories | +3 |
| `v0.4.0` | 4 — Places CRUD | POST/PATCH/DELETE, temp places auto-expiry beat task | +4 |
| `v0.5.0` | 5 — Presence | Check-in TTL, anonymous mode, beat GC | +2 |
| `v0.6.0` | 6+7 — Chat | REST per-place + bleach sanitize (ADR-006: WS deferred) | +3 |
| `v0.7.0` | 8+9 — Notifications | Subscriptions, in-app inbox, signal fanout (ADR-007) | +3 |
| `v0.8.0` | 10+11 — Articles | Markdown + bleach + comments + mock DOI | +2 |
| `v0.9.0` | 12 — RSS | feedparser, beat poller, idempotent dedup, test fixture | +2 |
| `v0.10.0` | 14 — Projects + GH | Project + Membership + GHRepo + anon GH API | +2 |
| `v0.11.0` | 15 — Events | FSM (7 states), Registration, iCal export | +2 |
| `v0.12.0` | 16 — Citizen | Campaign + Contribution + coordinator review | +1 |
| `v0.13.0` | 17 — Publish API | API tokens, Bearer auth, manifest schema, Python CLI scaffold | +2 |
| `v0.14.0` | 18+19 — PWA + Hardening | vite-plugin-pwa manifest, security headers, rate limit | +4 |

---

## Stack (8 containers + Weblate behind --profile)

```
astrozor-api        Django 5 + Ninja, 12 Django apps
astrozor-worker     Celery worker
astrozor-beat       Celery beat (3 periodic tasks)
astrozor-db         PostgreSQL 16 + PostGIS 3.4
astrozor-redis      Cache + Celery + Channels layer
astrozor-mailhog    Dev SMTP capture
astrozor-frontend   Vite + React + Tailwind v4 + MapLibre + i18next + PWA
astrozor-proxy      Caddy reverse proxy :80
```

Django apps: `accounts`, `core`, `places`, `presence`, `chat`, `notifications`, `publishing`, `feeds`, `projects`, `events`, `citizen`, `publishing_api`.

Celery beat: places-cleanup (5m), presence-cleanup (60s), feeds-poll (10m).

---

## Architecture decisions (ADRs)

- ADR-001 — Autonomous development model
- ADR-002 — Tier 0 publishing (no server-side user code execution)
- ADR-003 — Email is not a notification channel
- ADR-004 — CSRF strategy: SameSite=Lax cookies, no API CSRF tokens
- ADR-005 — PostGIS + PMTiles deferred (lat/lon float + OSM raster in MVP)
- ADR-006 — Chat via REST polling (WebSocket deferred to Krok 6.x)
- ADR-007 — Notifications in-app inbox only (web-push, Discord deferred)

---

## Blockers — still soft

See [`BLOCKERS.md`](./BLOCKERS.md).
- **B-1, B-3, B-4** — GitHub / Google / Mastodon OAuth credentials (email auth works; Krok 13 Mastodon fully blocked)
- **B-2** — Real ČAS seed data (using synthetic 15-place seed)
- **B-5** — Zenodo Sandbox token (DOIs minted as MOCK)
- **B-6** — Discord test webhook (notifications inbox-only)

### Technical debt (deferred by ADRs, not maintainer-blocked)
- **T-1** — Migrate Place lat/lon to PostGIS `geography(POINT, 4326)`
- **T-2** — Bootstrap self-hosted PMTiles Europe build
- **T-3** — Web-push (VAPID + service worker + subscribe endpoint)
- **T-4** — Discord webhook dispatcher
- **T-5** — Frontend pages for: chat panel, notifications inbox, article editor, project pages, event pages, campaign pages, token management UI (backend complete + E2E; frontend partial — Kroky 0–3 fully rendered)

---

## What now

**Backend is functionally complete for Kroky 0–19.** Frontend renders Kroky 0–3 (map + auth + i18n). Subsequent Kroky have full backend + E2E coverage; their UIs are well-scoped follow-up work.

When OAuth credentials are provided (B-1, B-3, B-4), `accounts/middleware` + `publishing_api` can wire in OAuth login. When Zenodo Sandbox token (B-5) is provided, `apps/publishing/doi.py` flips from MOCK to live Zenodo calls.

---

## Recent activity

- 2026-05-17 — Krok 18+19 v0.14.0: PWA + security headers + rate limit. 38/38 E2E.
- 2026-05-17 — Krok 17 v0.13.0: Publish API + tokens + CLI scaffold.
- 2026-05-17 — Krok 16 v0.12.0: Citizen science campaigns + contributions.
- 2026-05-17 — Krok 15 v0.11.0: Events + state machine + iCal.
- 2026-05-17 — Krok 14 v0.10.0: Projects + GitHub anon API.
- 2026-05-17 — Krok 12 v0.9.0: RSS aggregator.
- 2026-05-17 — Krok 10+11 v0.8.0: Articles + DOI mock.
- 2026-05-17 — Krok 8+9 v0.7.0: Subscriptions + notifications.
- 2026-05-17 — Krok 6+7 v0.6.0: Chat (REST polling).
- 2026-05-17 — Krok 5 v0.5.0: Presence (check-ins).
- 2026-05-17 — Krok 4 v0.4.0: Places CRUD + temp expiry.
- 2026-05-17 — Krok 3 v0.3.0: Map + 15 seeded CZ places.
- 2026-05-17 — Krok 2 v0.2.0: i18n + Weblate scaffold.
- 2026-05-17 — Krok 1 v0.1.0: Authentication + profile.
- 2026-05-17 — Krok 0 v0.0.1 / v0.0.2: Docker baseline + foundation.
