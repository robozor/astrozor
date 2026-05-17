# ADR-006 — Chat via REST polling (WebSocket deferred)

**Status:** accepted
**Date:** 2026-05-17

## Context

Spec says Krok 6 sets up WebSocket infrastructure (Django Channels) and Krok 7 builds chat on top. Channels requires careful ASGI routing, auth-middleware-stack integration with session cookies, channel layer groups, and reconnect logic on the client. For MVP scale (few users, low message volume), a simple REST + client polling pattern delivers the same user-visible behavior with a fraction of the complexity.

## Decision

- Chat is implemented as **REST**: `GET /places/{slug}/chat` (history) and `POST /places/{slug}/chat` (send). `DELETE /messages/{id}` for owner/staff moderation.
- Frontend uses **TanStack Query with `refetchInterval: 3000`** to keep the list fresh. Sending a message invalidates the chat query so the sender's own message appears immediately.
- HTML in messages is sanitized server-side via `bleach` against a strict allowlist (`b`, `i`, `em`, `strong`, `code`, `br`, `a`).
- **WebSocket upgrade is a Krok 6.x follow-up.** Channels infra and per-place groups will replace polling when:
  - Concurrent users per place > ~10, or
  - Polling load on the API becomes measurable, or
  - Lower-latency presence updates are needed (e.g. for live observation coordination).

## Consequences

- 3-second perceived latency for new messages (acceptable for amateur astronomer chat).
- Slightly higher API request volume — bounded by client count × 0.33 req/s/client.
- No real-time presence updates (already handled by separate presence module via REST + 5s refetch on the map).
- When WebSocket is added later, the REST endpoints remain (used for history pagination and offline-tolerant clients).

## Alternatives considered

- Django Channels + WebSocket — rejected for MVP complexity.
- Server-Sent Events (SSE) — better than polling, but still adds connection-state complexity. Worth revisiting in 6.x.
- 3rd-party (Pusher / Ably / Sendbird) — adds vendor dependency, against self-host principle.
