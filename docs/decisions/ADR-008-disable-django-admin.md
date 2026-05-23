# ADR-008 — Disable `django.contrib.admin` URL

**Status:** accepted
**Date:** 2026-05-23

## Context

`django.contrib.admin` was mounted at `/admin/` by default since the project's
first Krok. We never relied on it for product administration — that is
implemented in the React UI (`AdminPage.tsx`) consuming `/api/v1/admin/*`
endpoints (clouds settings, photon imports, OAuth provider toggles, etc.).

Two problems with leaving the Django admin URL exposed:

1. **It looks broken.** Django admin needs `/static/admin/*.css` to be served.
   The dev stack runs Django through `uvicorn` (ASGI), not `manage.py
   runserver`, so the magic dev-time static serving doesn't kick in.
   `collectstatic` is not run in dev (`COLLECTSTATIC=0`). Result: an
   unstyled HTML skeleton at `/admin/` that screams "this site is broken"
   to anyone who finds it.

2. **It's a footgun.** Anyone with a stale superuser flag can edit raw DB
   rows in production, bypassing the validation that lives in the Ninja
   API layer (visibility rules, slug uniqueness across active/soft-deleted
   articles, presence-state machine guards, etc.). The product admin in
   the React UI deliberately exposes only safe operations.

`is_active=True, is_staff=True, is_superuser=False` for the maintainer
account already left the page useless — "Nemáte oprávnění k zobrazení ani
úpravám" with no models listed — proving the URL had no actual user value.

## Decision

- **Remove the `/admin/` URL** from `backend/astrozor/urls.py`.
- **Remove Caddy `handle /admin/*`** routes from both `Caddyfile` (dev) and
  `Caddyfile.prod`. `/admin/` now hits the SPA's catch-all and renders a
  404 page in the frontend.
- **Keep `django.contrib.admin` in `INSTALLED_APPS`.** Its `LogEntry` model
  is referenced by historical migrations on existing deployments;
  removing it would generate a destructive migration that drops the
  table. The admin app simply becomes unreachable code.
- **Drop `Disallow: /admin/`** from `robots_txt`. The URL doesn't exist; no
  need to gesture at it for crawlers.

## Consequences

- One-way change. If raw DB inspection is ever needed, use
  `docker compose exec api python manage.py shell` or a direct
  `psql` against the `db` container — not a web UI.
- Future contributors who instinctively visit `/admin/` after `makemigrations`
  will get a 404. They should consult the React admin in the UI instead.
- No effect on `/api/v1/admin/*` — that's our own product admin layer and
  stays exactly as-is.
