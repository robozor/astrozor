# Architecture Decision Records (ADR)

This directory captures **non-trivial decisions** made during autonomous development. Each ADR is a short markdown file with context, decision, alternatives considered, and consequences.

## Index

- [ADR-001 — Autonomous development model and decision authority](./ADR-001-autonomous-development.md)
- [ADR-002 — Tier 0 publishing (no server-side user code execution)](./ADR-002-tier-0-publishing.md)
- [ADR-003 — Email is not a notification channel](./ADR-003-no-email-notifications.md)
- [ADR-004 — CSRF strategy: SameSite=Lax cookies, no API CSRF tokens](./ADR-004-csrf-strategy.md)
- [ADR-005 — PostGIS + PMTiles deferred to Krok 3.x; OSM raster + float lat/lon in MVP](./ADR-005-postgis-deferred.md)
- [ADR-006 — Chat via REST polling (WebSocket deferred to Krok 6.x)](./ADR-006-chat-rest-polling.md)

## Conventions

- Number sequential: `ADR-NNN-short-kebab-title.md`.
- Status: `proposed` → `accepted` → `superseded` (link forward).
- One concept per ADR. Keep them short.
- If a decision is reversed, write a new ADR that supersedes the old one.
