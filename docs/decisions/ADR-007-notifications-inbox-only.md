# ADR-007 — Notifications in-app inbox only in MVP

**Status:** accepted
**Date:** 2026-05-17

## Context

Q9 decided: notifications via in-app + web-push + Discord webhook. Web-push requires service worker, VAPID key pair, browser permission UX, and `pywebpush` integration. Discord webhook requires per-user URL handling and live test endpoint (B-6 blocker for verification).

For MVP autonomous build, **in-app inbox** alone delivers the user-visible feedback loop. Other channels become 9.x follow-ups.

## Decision

- **In-app inbox** is the only channel implemented in Krok 9 MVP.
- `Notification` model (per-user, with `read_at`).
- Fanout on signals: chat Message → notify subscribers of that place. Generic extensible signal pattern for future event sources.
- `Subscription` model (user → place, expandable later to project/event).
- **Web-push deferred** — schema for VAPID env vars and `pywebpush` integration is documented in `.env.example`. Activate in Krok 9.x.
- **Discord webhook deferred** — model field `profile.discord_webhook_url` already exists. Dispatcher to be added in Krok 9.x when B-6 unblocks live test, or use mock for offline test.

## Consequences

- Users open the app to see notifications. No push-to-device.
- Acceptable for the autonomous-build phase; we get the data model right first, transports plug in later.

## Follow-up tech debt

- T-3 — Web-push (VAPID + service worker + subscribe endpoint).
- T-4 — Discord webhook dispatcher with retry / dedup.
