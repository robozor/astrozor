---
title: "Troubleshooting and common issues"
section: "4. Advanced"
order: 90
icon: "🔧"
---

# Troubleshooting and common issues

Most common problems and how to fix them. If you don't find your answer, open an issue in the Astrozor project repo.

## Sign-in

| Problem | Fix |
|---|---|
| **SSO redirect fails with `oauth_error`** | The OAuth app doesn't have the right redirect URI. Ping the admin or check `.env.example` for the correct URL. |
| **Email verification not delivered** | Check spam. In dev mode it lands in **MailHog** — `http://localhost:8025`. |
| **`Account exists with different sign-in method`** | An existing account has a different provider. Sign in with the original one, then add the new provider in Settings → Connected accounts. |

## Publishing

| Problem | Fix |
|---|---|
| **`401 Token rejected`** | Create a new token in Settings → API tokens |
| **`403 Token missing 'publish:articles' scope`** | Token created without the right scope — create a new one |
| **`400 Slug taken by another user`** | Pick a different slug |
| **`507 Storage quota exceeded`** | Delete older articles or ask an admin to raise the quota (default 5 GB) |
| **`400 Archive must contain index.html at root`** | The ZIP has an enclosing folder — zip the **contents** of the folder instead |
| **VS Code `Could not run "quarto"`** | Install the Quarto CLI or set the full path in Settings → `astrozor.quartoExecutable` |
| **Quarto render: `Specified 'language' file does not exist`** | YAML uses `language: cs` (Quarto-specific) — use `lang: cs` instead |

## Map

| Problem | Fix |
|---|---|
| **Tiles not showing** | Network error — check `/pmtiles/` in dev tools. Maybe the protomaps archive is still downloading (admin) |
| **Markers grey, no icons** | Engine icons load from `/icons/`. Cached after first load — try hard refresh (`Ctrl+F5`) |
| **Position outside CZ** | Set position in Settings → Profile |

## Events and registrations

| Problem | Fix |
|---|---|
| **ICS email not delivered** | MailHog in dev / spam folder in prod |
| **Can't unregister** | Organizer locked registrations — contact them |

## Citizen Science

| Problem | Fix |
|---|---|
| **Zooniverse iframe doesn't render** | Third-party cookies / X-Frame-Options — the Zooniverse classification UI requires you to be signed in on Zooniverse |
| **Classifications don't show in leaderboard** | Astrozor syncs periodically (1h default). Force sync in Admin panel → Zooniverse → Refresh |

## Projects (GitHub)

| Problem | Fix |
|---|---|
| **Issues don't show** | Repo isn't public, or the GitHub PAT is missing (Admin panel) |
| **List doesn't refresh after creating an issue** | GitHub eventual consistency — refresh after 1–2 seconds |
| **Issue counter ≠ visible issues count** | GitHub `open_issues_count` includes PRs. The button reads `X issues · + N PR` |

## Mastodon

| Problem | Fix |
|---|---|
| **`OAuth app registration failed`** | Server doesn't allow dynamic registration (Pleroma with closed registrations) |
| **Toot doesn't go out, `401 Unauthorized`** | Token revoked Mastodon-side — disconnect and re-link |

## Notifications

| Problem | Fix |
|---|---|
| **Web push not delivered** | Browser permission removed — Settings → Privacy and security → Site settings → Notifications |
| **Discord webhook test fails** | Wrong URL (trailing `/` or token), or Discord deleted the webhook |
| **Event reminder email not delivered** | Profile.notify_email off, or SMTP issue |

## Self-hosting

| Problem | Fix |
|---|---|
| **API container restarting** | Check `docker compose logs api` — typically failed DB migration or missing env var |
| **Frontend Vite HMR not updating** | `docker compose restart frontend` |
| **`Cannot connect to PostgreSQL`** | DB healthcheck still running, wait 10s |
| **Caddy 502** | Backend unreachable — `docker compose ps`, verify api is running |

## Last resort

1. **Hard refresh** (`Ctrl+F5`) — rules out cache issues
2. **Developer Tools → Console** — shows JavaScript errors
3. **Developer Tools → Network** — shows failing requests with response body
4. **Open an issue in the Astrozor project** — repro steps, browser version, screenshot
