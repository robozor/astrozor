# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

## [0.0.1] — 2026-05-17 (planned)

Initial Docker baseline. Stack runs locally with placeholder pages.

### Added
- Monorepo scaffold (`backend/`, `frontend/`, `clients/`, `docker/`, `docs/`, `e2e/`).
- Docker compose stack: PostgreSQL+PostGIS, Redis, MinIO, Django API stub, Vite/React frontend stub, Caddy reverse proxy.
- `/api/v1/healthz` endpoint returning JSON `{"status": "ok"}`.
- Frontend placeholder page rendering "Astrozor — Krok 0".
- GitHub Actions CI: lint + smoke test.
- Governance: LICENSE (MIT), PROGRESS.md, BLOCKERS.md, ADR-001..003.
