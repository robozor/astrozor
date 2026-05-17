# Astrozor

> Kolaborativní platforma pro aktivní astronomy — setkávání online, koordinace pozorování, publikace článků (Markdown / Quarto), mapa hvězdáren a pozorovacích míst, projekty s GitHub integrací, akce a citizen science kampaně.

**Status:** early development · **License:** [MIT](./LICENSE) · **Partner:** Česká astronomická společnost (ČAS)

| Tracking | Where |
|----------|-------|
| Current development state | [`PROGRESS.md`](./PROGRESS.md) |
| Items waiting on the maintainer | [`BLOCKERS.md`](./BLOCKERS.md) |
| Architecture decisions | [`docs/decisions/`](./docs/decisions/) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| E2E test plan | [`e2e/PLAN.md`](./e2e/PLAN.md) |

## Quickstart (dev)

Requires only **Docker Desktop**. Nothing installed on the host.

```bash
git clone https://github.com/robozor/astrozor.git
cd astrozor
cp .env.example .env
make build       # one-time: build python-base, then service images
make up          # start the stack
make smoke       # verify /api/v1/healthz
```

Open: **http://astrozor.localhost**

Stop with `make down`. Full target list: `make help`.

## What's inside

- `backend/` — Django 5 + Django Ninja (ASGI) API
- `frontend/` — Vite + React + TypeScript + Tailwind CSS v4
- `clients/` — publishing clients (CLI, Quarto provider, VS Code ext, R package) — *added in M8*
- `docker/` — Dockerfiles per service
- `compose/` — Docker Compose overlays (dev, prod, observability, e2e)
- `e2e/` — Playwright end-to-end tests
- `docs/` — architecture decisions, runbooks
- `.github/workflows/` — CI (lint, smoke, build)

## Concept

Astrozor stojí mezi nástroji pro plánování pozorování (Stellarium, Telescopius) a fórem (Cloudy Nights). Spojuje **sociální vrstvu** (kdo, kdy, odkud pozoruje), **publikační vrstvu** (Quarto/Markdown články s DOI) a **koordinační vrstvu** (projekty, akce, citizen science kampaně).

Detailní funkční specifikace je vedena mimo Git (`requirements/` je gitignored); pro maintainery dostupná lokálně.
