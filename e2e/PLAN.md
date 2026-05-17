# Astrozor — E2E Test Plan

> Test plan that grows with each Krok. Each Krok contributes 1–3 acceptance tests that prove the user-visible behavior of that Krok. Before each release tag, the full suite is executed.

## Current coverage

| Krok | Test file | What it verifies |
|------|-----------|------------------|
| **Krok 0** | `specs/krok-0-smoke.spec.ts` | Stack is up; `/api/v1/healthz` returns 200; placeholder UI renders; API+DB cards displayed |

## Planned per future Krok

- **Krok 1 (Auth):** signup with e-mail → magic link clicked → logged in; logout; profile edit.
- **Krok 2 (i18n):** language switch CS↔EN persists in profile.
- **Krok 3 (Map):** map loads, seed places visible, click marker → detail panel.
- **Krok 4 (Places CRUD):** create temporary place → visible on map → expires.
- **Krok 5 (Check-in):** check-in by user A → marker animates for user B → TTL expires.
- **Krok 6 (WebSocket):** real-time presence update reaches second client.
- **Krok 7 (Chat):** two-client chat exchange, history persists.
- **Krok 8 (Feed):** follow place → new check-in appears in feed.
- **Krok 9 (Notif):** mention → in-app inbox + web-push + Discord webhook fires.
- **Krok 10 (Publish MD):** write article → publish → comment → appears in feed.
- **Krok 11 (DOI):** publish → DOI minted against Zenodo sandbox (mocked in CI).
- **Krok 12 (RSS in):** add RSS feed → poll → items appear in feed.
- **Krok 13 (Mastodon):** connect Mastodon → timeline appears → cross-post article.
- **Krok 14 (Projects + GH):** create project, link repo, issues fetched.
- **Krok 15 (Events):** state machine transitions across simulated time.
- **Krok 16 (Citizen science):** create campaign, contribution submitted, accepted.
- **Krok 17 (Publish API):** generate token, `astrozor publish` via API.
- **Krok 18 (PWA + mobile):** install prompt, offline feed.
- **Krok 19 (Hardening):** rate-limit, CSP header presence.
- **Krok 20 (Release):** full regression.

## Running locally

```bash
# Stack must be running
make up

# Run smoke
make e2e
# Or directly:
docker compose -p astrozor --profile e2e run --rm e2e

# Open HTML report after a run
docker compose -p astrozor --profile e2e run --rm e2e npx playwright show-report
```

## Running in CI

`.github/workflows/ci.yml` runs the `lint` and `smoke` jobs on every PR. The full Playwright suite (`e2e/specs/regression/`) will be added when there's enough to regression-test.

## Conventions

- Test naming: `krok-N-<feature>.spec.ts` for per-Krok acceptance.
- Critical paths in `specs/critical/` (run nightly).
- Mock external services (GH, Mastodon, Discord, Zenodo) via `playwright-test` fixtures.
- Test users seeded via `scripts/seed_e2e.py` before each run.
