# Astrozor

[![Release](https://img.shields.io/github/v/release/robozor/astrozor?logo=github&label=release&color=green)](https://github.com/robozor/astrozor/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/robozor/astrozor/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/robozor/astrozor/actions/workflows/ci.yml)
[![Docker build](https://img.shields.io/github/actions/workflow/status/robozor/astrozor/release.yml?label=docker%20images&logo=docker&logoColor=white)](https://github.com/robozor/astrozor/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/github/license/robozor/astrozor)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/robozor/astrozor)](https://github.com/robozor/astrozor/commits/main)
[![Open issues](https://img.shields.io/github/issues/robozor/astrozor)](https://github.com/robozor/astrozor/issues)

> Collaborative platform for active astronomers — online meetups, observation coordination, article publishing (Markdown / Quarto / Jupyter), a map of observatories and observing spots, GitHub-integrated projects, events, and citizen-science campaigns.

**Status:** production-ready, self-hostable · **Partner:** Czech Astronomical Society (ČAS)

| Tracking | Where |
|----------|-------|
| Architecture decisions | [`docs/decisions/`](./docs/decisions/) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Deploy guide (Synology) | [`docs/deploy-synology.md`](./docs/deploy-synology.md) |
| E2E test plan | [`e2e/PLAN.md`](./e2e/PLAN.md) |

## Deploy (Synology, VPS, anything with Docker)

Pre-built multi-arch images (`linux/amd64` + `linux/arm64`) are published to **GHCR**. To deploy you don't need to clone the repo — just grab `docker-compose.prod.yml` and `.env.example`:

```bash
mkdir astrozor && cd astrozor
curl -fL https://raw.githubusercontent.com/robozor/astrozor/main/docker-compose.prod.yml -o docker-compose.yml
curl -fL https://raw.githubusercontent.com/robozor/astrozor/main/.env.example -o .env
# Edit .env (DJANGO_SECRET_KEY, POSTGRES_PASSWORD, ASTROZOR_DOMAIN, SITE_ADDRESS, …)
docker compose pull
docker compose up -d
```

Image catalog (latest stable: `v1.2.3`):

```
ghcr.io/robozor/astrozor-python-base
ghcr.io/robozor/astrozor-api          # used by api, worker, beat
ghcr.io/robozor/astrozor-frontend     # nginx serving the Vite static build
ghcr.io/robozor/astrozor-proxy        # Caddy reverse proxy
```

Step-by-step Synology Container Manager walk-through (three TLS variants — DSM proxy, Caddy auto-LE, local IP) lives in [`docs/deploy-synology.md`](./docs/deploy-synology.md).

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

Open **http://astrozor.localhost**. Stop with `make down`. Full target list: `make help`.

## What's inside

- `backend/` — Django 5 + Django Ninja (ASGI) API. Apps: `accounts`, `admin_panel`, `chat`, `citizen` (Zooniverse projects), `core`, `docs` (in-app help), `events`, `feeds`, `geocoding`, `notifications`, `places`, `presence` (check-ins), `projects` (GitHub-integrated), `publishing` + `publishing_api`, `uploads`.
- `frontend/` — Vite + React 18 + TypeScript + Tailwind CSS v4. PWA enabled.
- `docker/` — per-service Dockerfiles (dev + `.prod` variants for the release stack).
- `docker-compose.yml` — dev stack (build from source).
- `docker-compose.prod.yml` — production stack (pull from GHCR).
- `clients/` — publishing clients:
  - `clients/cli/` — `astrozor-publish` Python CLI.
  - `clients/shared/manifest-schema.json` — bundle manifest JSON Schema, shared by all clients.
- `rstudio-addin/` — `astrozorpub` R package + RStudio addin.
- `vscode-extension/` — `astrozor-publish` VS Code extension (TypeScript).
- `jupyter-addin/` — JupyterLab extension + Python helpers for publishing notebooks.
- `samples/` — example articles (Markdown, Quarto, Jupyter) served by the running instance at `/samples/` for download.
- `e2e/` — Playwright end-to-end test suite.
- `docs/` — architecture decisions (`decisions/`), runbooks (`runbook/`), deploy guide.
- `compose/` — additional compose overlays (e2e, Weblate).
- `.github/workflows/` — CI (lint + smoke) and release (multi-arch GHCR push on `v*` tags).

## Publishing from your editor

Astrozor includes first-class publishing integrations for four toolchains:

| Editor | Format | Install | Source |
|---|---|---|---|
| **Astrozor editor** (built-in) | Markdown | n/a — open the app | `frontend/src/components/ArticlesPage.tsx` |
| **VS Code** | Markdown, Quarto | Install `.vsix` from `<host>/vscode-extension/` | [`vscode-extension/`](./vscode-extension/) |
| **RStudio** | R Markdown, Quarto | `install.packages("astrozorpub", repos = "<host>/R")` | [`rstudio-addin/`](./rstudio-addin/) |
| **JupyterLab** | Notebook | `pip install astrozorpub` (Python helper) + JupyterLab extension | [`jupyter-addin/`](./jupyter-addin/) |

In-app docs at `<host>/docs` show installation instructions for each toolchain.

## Concept

Astrozor sits between observation-planning tools (Stellarium, Telescopius) and forums (Cloudy Nights). It combines:

- a **social layer** — who's observing, when, and from where (check-ins on a map of observatories and observing spots);
- a **publishing layer** — Markdown / Quarto / Jupyter articles with optional DOI minting via Zenodo, Mastodon cross-posting, RSS / Atom feeds, and OG / JSON-LD meta for social-network crawlers;
- a **coordination layer** — projects (GitHub issue / PR mirroring), events (with calendar view), and citizen-science campaigns (Zooniverse subject-set integration).

Detailed functional specs live outside Git (`requirements/` is gitignored); maintainers have local copies.

## Help and feedback

- Issues: <https://github.com/robozor/astrozor/issues>
- In-app docs: `<host>/docs` (Czech + English)
- ČAS partnership: <https://www.astro.cz/>
