# Weblate setup — translation platform

> Status: **scaffold present, not enabled by default**. Decision Q4 = A: Weblate from Krok 2 (in compose). Activated when translation contributions are opened to the community (typically at v1.0-rc).

## Start

```bash
# All Astrozor services + Weblate
docker compose -p astrozor \
  -f docker-compose.yml \
  -f compose/docker-compose.weblate.yml \
  --profile weblate \
  up -d
```

This launches:

- `weblate-db` — dedicated Postgres for Weblate (separate from astrozor `db`).
- `weblate` — Weblate web + worker container (single all-in-one image).
- Reuses the existing `redis` and `mailhog` services.

First boot of Weblate takes 2–5 minutes (migrations, language data, full-text index).

## Default credentials (dev)

- URL: http://localhost:8080 (or wire `weblate.astrozor.localhost` in Caddyfile)
- Username: `admin`
- Password: `WEBLATE_ADMIN_PASSWORD` env var (default `astro-weblate-dev`)

**Change password on first login.**

## Wiring our repo

1. In Weblate UI: *Manage → Components → Add new translation project* `Astrozor`.
2. Add component:
   - Repository: `git@github.com:robozor/astrozor.git`
   - Branch: `main`
   - File mask: `frontend/src/i18n/*.json`
   - File format: `JSON file`
   - Push branch: `weblate/translations` (Weblate opens PRs)
3. Configure GitHub credentials (token with `repo` scope) under *Manage → Integrations*.
4. Open a PR from Weblate to `main` whenever new translations are submitted.

## Adding the backend gettext source

For Django models (Profile, etc.) we use `gettext_lazy`. Generate `.po` files:

```bash
docker compose -p astrozor exec api python manage.py makemessages -l cs -l en
```

Add second Weblate component:

- File mask: `backend/locale/*/LC_MESSAGES/django.po`
- Format: gettext PO

## Disabling

```bash
docker compose -p astrozor -f docker-compose.yml -f compose/docker-compose.weblate.yml --profile weblate down
```

Volumes persist; restart resumes where you left off.

## Production caveats

For a public Weblate instance:
- Set `WEBLATE_DEBUG=0`
- Set strong `WEBLATE_ADMIN_PASSWORD` and `WEBLATE_DB_PASSWORD`.
- Route via Caddy with proper TLS.
- Configure outbound SMTP (replace MailHog).
- Consider memcached for performance over pure Redis cache.
