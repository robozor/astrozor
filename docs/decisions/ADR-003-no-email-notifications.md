# ADR-003 — Email is not a notification channel

**Status:** accepted
**Date:** 2026-05-17

## Context

Originally the notification system planned three channels: in-app, e-mail, web-push. The human maintainer requested removing e-mail from notifications because the in-app inbox (with history) covers the same need with better UX, and chat-platform webhooks (Discord first) better fit modern astronomer workflows.

## Decision

**E-mail is used only for authentication flows** (account verification, password reset, magic link).
**Notifications go through three channels:**
1. **In-app inbox** — persistent history with mark-as-read, filtering. Primary channel.
2. **Web-push** — opt-in browser notifications via service worker + VAPID.
3. **Discord webhook (per-user URL)** — optional external feed for users who prefer chat.

Mastodon DM is a planned later addition (opt-in).

## Consequences

- No e-mail digest infrastructure to build.
- Lower deliverability risk (no spam filter problems for notification volume).
- Users without notifications enabled simply see them in the in-app inbox when they return.
- Slack / Matrix / Microsoft Teams webhooks can be added later — same pattern as Discord.
- E-mail provider (`django-anymail`) is still needed for transactional auth e-mails. MailHog used in dev.

## Related

- `requirements/specification.md` §6.11 (Notifications)
- `requirements/decisions-qa.md` Q6
