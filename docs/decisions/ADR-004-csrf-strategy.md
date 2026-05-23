# ADR-004 — CSRF strategy: SameSite=Lax cookies + no API CSRF

**Status:** accepted
**Date:** 2026-05-17

## Context

Astrozor uses session-based authentication (Django session cookies). Django's `CsrfViewMiddleware` requires a CSRF token on all unsafe methods (POST/PATCH/DELETE) by default. For a single-page application talking to its own backend, the standard CSRF token dance (fetch cookie, mirror in header) adds complexity.

## Decision

- Django's `SESSION_COOKIE_SAMESITE = "Lax"` prevents cross-origin POST requests from carrying the session cookie. This neutralizes the main CSRF attack vector for state-changing requests.
- `NinjaAPI(csrf=False)` — API endpoints don't require CSRF tokens. NinjaAPI applies `@csrf_exempt` automatically.
- The Django admin (`/admin/`) keeps full CSRF protection via the standard middleware. *(Superseded by [ADR-008](./ADR-008-disable-django-admin.md): the `/admin/` URL is no longer exposed.)*
- A `/api/v1/csrf` endpoint is provided for future use (e.g., if we ever embed forms or accept third-party referrers).

## Consequences

- Simpler API client implementation. No CSRF token plumbing in the SPA or in clients (CLI, R, VS Code).
- Slight reduction in defense-in-depth — if browsers ever weaken SameSite enforcement, the API would be vulnerable to CSRF. We accept this trade-off for now.
- Cross-origin embedding (e.g., another site iframing our pages and making state-changing requests via fetch) is blocked at the cookie layer, not at the application layer.
- Krok 19 (hardening) will revisit this if pen-test recommends stricter posture.

## Alternatives considered

- **Full CSRF (token-in-header)** — too much plumbing for MVP; can be added later via a single middleware change.
- **Disable Django middleware globally** — would weaken admin protection. Rejected.
