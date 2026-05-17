# Astrozor — Progress

> Single source of truth for development status. Updated by the autonomous developer (Claude) after each meaningful change.

**Last updated:** 2026-05-17
**Phase:** Krok 0 / 20 (Foundation) — final verification
**Status:** 🟢 in-progress (waiting on Playwright build for final E2E)
**Version target:** `v0.0.1`

---

## Currently working on

**Krok 0 — Docker baseline + monorepo scaffold**

- [x] Repository created on GitHub (`robozor/astrozor`, private)
- [x] Local environment verified (Docker 29.4, ports 80/443 free, 1.2 TB disk)
- [x] Governance files (LICENSE, PROGRESS, BLOCKERS, CHANGELOG, ADRs)
- [x] Backend Django 5 + Ninja skeleton (`/api/v1/healthz`, `/api/v1/readyz`)
- [x] Frontend Vite + React + Tailwind v4 + TanStack Query placeholder
- [x] Dockerfiles per service (python-base, api, worker, beat, frontend, proxy)
- [x] `docker-compose.yml` stack (db PostGIS, redis, api, worker, beat, frontend, proxy)
- [x] Caddy reverse proxy (HTTP only for dev; HTTPS via override later)
- [x] CI workflow (`.github/workflows/ci.yml`)
- [x] Makefile with `build/up/down/smoke/test/lint/...`
- [x] Playwright E2E scaffold (`e2e/`, smoke spec, `PLAN.md`)
- [x] Build images successful (python-base 957 MB, api 957 MB, frontend 790 MB, proxy 69 MB)
- [x] Stack runs: `/api/v1/healthz` → 200 `{"status":"ok"}`, `/readyz` → 200 with DB connection
- [x] Vite serves transformed TSX through Caddy proxy
- [ ] Playwright image build + E2E smoke run
- [ ] First commit + push + tag `v0.0.1`

**Small decision (autonomous, see ADR-001):** Port 443 dropped from `proxy` service binding because port was already allocated to another service on this host. Caddyfile is HTTP-only in dev, so 443 was redundant. HTTPS layer will be added via compose override when needed (Krok 19 hardening or production).

---

## Done milestones

(nothing released yet — `v0.0.1` pending Playwright verification)

---

## Blockers

See [`BLOCKERS.md`](./BLOCKERS.md) — six soft blockers (OAuth credentials, ČAS seed data, Zenodo token, Discord webhook) that don't prevent current progress.

---

## Next planned step

**Krok 1 — Authentication & profile** (email-only auth in MVP, OAuth providers when credentials available)

---

## Recent activity

- 2026-05-17 — Krok 0 implementation complete; stack verified via curl; awaiting Playwright image pull for final E2E pass.
- 2026-05-17 — All 7 containers running (db, redis, api, worker, beat, frontend, proxy).
- 2026-05-17 — Build artifacts: `astrozor/python-base:dev`, `astrozor/api:dev`, `astrozor/frontend:dev`, `astrozor/proxy:dev`.

---

## How to read this

- ✅ checkbox = done
- ⬜ checkbox = pending in current Krok
- 🟢 in-progress / 🟡 waiting / ⏸ paused / ✅ done
- Detailed history: `git log` and `CHANGELOG.md`
- Released versions: GitHub Releases on `robozor/astrozor`
