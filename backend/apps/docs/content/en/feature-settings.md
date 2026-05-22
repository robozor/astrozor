---
title: "Settings"
section: "3. Features"
order: 60
icon: "⚙"
---

# Settings

The **Settings** section is split into 7 cards. Each is a separate `<section>` with its own save action.

## 1) Email verification

First card `EmailVerificationCard`:

- If `email_verified = false`: yellow warning + **Send verification e-mail again** button
- Once verified: green text **✓ E-mail verified**

You need a verified email to publish articles + organize events.

## 2) Profile

The main `ProfileSection` card has 4 sub-sections:

### Basic fields

- **Display name** (`display_name`)
- **Club / observatory** (`club`)
- **About me** (`bio`) — textarea
- **Equipment** (`equipment`) — textarea, free-form (e.g. "Newton 200/1000, ASI 533MC")
- **Preferred language** — `cs` / `en` (the UI flips immediately on save)

### My location (`LocationPicker`)

- **Location label** (`location_label`) — text input
- **🔍 Search** — button next to it, click geocodes the label via the internal Photon (returns top 5 suggestions). Picking one auto-fills `lat/lon` and refines the label
- **📍 Detect from browser** — `navigator.geolocation.getCurrentPosition()` (requires a permission prompt)
- **Coordinate display** — below the input: `📍 50.08340, 14.44000` (or "No coordinates set — region mode shares the label only")
- **Clear coordinates** — link on the right (only when coordinates exist)
- **Location visibility** (`location_visibility`):
  - `precise` — share precise GPS + label (default)
  - `region` — share the label only (e.g. "Prague"), coordinates stay private
  - `hidden` — don't share at all
- A hint below the select explains what each mode shares

### Timezones

- **My timezone** (`timezone_name`) — IANA TZ picker (complete via `Intl.supportedValuesOf("timeZone")`)
- Three checkboxes control the `TimeDisplay` component across the app:
  - **Show UTC**
  - **Show local time** (by place / event GPS)
  - **Show my time** (per profile)

All on by default — you see three time lines next to events and articles. Turning one off narrows the display.

### Use-case — set location

**Use-case: Astrozor watches my region, not exact coordinates:**

1. Type into **Location label**: "Olomouc"
2. Click **🔍 Search**
3. Pick the suggestion "Olomouc, Olomouc Region, Czechia" → `lat/lon` fills in automatically
4. Change **Visibility** to `region`
5. **Save**

From now on other users see only "Olomouc" on your profile, never exact coordinates. The map doesn't pin you either.

**Use-case: Share precise position for local observers:**

1. Click **📍 Detect from browser** → grant permission → coordinates fill in
2. Optionally write a **Location label** manually ("My balcony in Smíchov")
3. **Visibility**: `precise`
4. **Save**

Your position appears on the map as a marker (when implemented; currently just visible in `location_label` on your public profile).

## 3) Connected accounts

The `ConnectedAccounts` card — list of OAuth identities tied to your account. For each provider:

- **Green dot + brand name** — provider is linked
- **Display name from the provider** (e.g. "Robozor" from GitHub)
- **Disconnect** — removes the identity row (the server checks that at least one auth method remains — you can't lock yourself out)

For an unlinked provider: button **+ Connect GitHub** etc. — starts the OAuth flow.

### Supported providers

| Provider | Scopes | URL |
|---|---|---|
| **GitHub** | `read:user`, `user:email` | github.com/settings/developers |
| **Google** | `openid`, `email`, `profile` | console.cloud.google.com |
| **GitLab** | `read_user` (configurable instance via `GITLAB_OAUTH_BASE_URL`) | gitlab.com (or self-hosted) |
| **Discord** | `identify`, `email`, optional bot install scope | discord.com/developers/applications |
| **Zooniverse** | `read:profile` | panoptes.zooniverse.org |
| **Mastodon** | `write:statuses`, `read:accounts` (dynamic OAuth app per instance) | your instance |

Provider setup details — see `.env.example` or [Administration](feature-admin).

### Use-case: pre-existing account, add a second SSO

1. You're signed in via GitHub (original SSO)
2. **Settings → Connected accounts → + Connect Google**
3. OAuth flow via Google
4. The Google email MUST match your Astrozor email (otherwise the server refuses, as protection against account takeover)
5. Identity is stored — from now on you can sign in via GitHub OR Google

## 4) Integrations (per-user)

The `IntegrationsSection` card — external services:

### Discord webhook URL

Per-user channel for Discord notifications. URL format `https://discord.com/api/webhooks/<id>/<token>`. Click **Save** to validate and persist.

→ Details in [Notifications](feature-notifications).

### Zenodo API token

Per-user Zenodo token (when you want articles minted on **your Zenodo account** instead of the platform-wide sandbox):

- **Paste token** (password-style field — the server shows it only as `(stored)`)
- **Use Zenodo sandbox** checkbox — for testing (sandbox.zenodo.org, no real DOIs)
- Link to generate a token (sandbox.zenodo.org/account/settings/applications/tokens/new for sandbox, zenodo.org/... for production)
- **Clear token** — wipes

### Mastodon — auto cross-post

- **Auto-post check-ins to my Mastodon** (`mastodon_autopost_checkin`) — checkbox
- When on: every check-in at an observatory/site posts a "🔭 Observing from X" status to your linked Mastodon instance
- Requires a linked Mastodon account (see Connected accounts)
- Anonymous check-ins are never posted

## 5) Discord notifications — event types

The `DiscordPrefsSection` card — per-event-kind opt-in with filters:

- List of 6 event types (place_followed_checkin, place_any_checkin, article_published, event_status_changed, project_lifecycle, campaign_status_changed)
- For each: an **Enabled** checkbox
- For some: additional filter fields (`author_emails`, `event_slugs`, `to_states`, `actions`, …)

Logic detail → [Notifications](feature-notifications).

## 6) API tokens

The `ApiTokensSection` card — manage personal access tokens for external publishing:

- **Input** for token name (e.g. "RStudio on laptop")
- **Create** — generates a token `ast_<base64>`, **shows it ONCE** in a green card with a **Copy** button
- **List of existing tokens**:
  - Name
  - Prefix (`ast_xxxx…`) — first 8 chars
  - Created / last used (auto-update on every request)
  - **Revoke** button

Details in [API tokens](api-tokens).

## 7) Storage

The `StorageSection` card:

- **Progress bar** (indigo) — `storage_used_bytes / storage_quota_bytes`
- Numerical overview: `30.2 MB / 5 GB`
- No actions (read-only stat)

Storage is consumed by:
- Article cover images (server-resized to 1600px)
- Quarto/RMarkdown/Jupyter bundles (extracted HTML + assets)
- Avatars, chat attachments, ... (anything that uses `apps.uploads`)

To raise the quota: contact an admin (or `python manage.py shell` → `user.profile.storage_quota_bytes = 10 * 1024**3`).

## What currently DOES NOT EXIST

For completeness (so the docs don't mislead):

- **Avatar upload** — the avatar comes from the OAuth identity (first linked provider). No own upload yet.
- **Delete account** UI — for a full delete, go to Django admin (or ask an admin). Soft block is `is_active=False`.
- **Email visibility toggle** — `email` is always private (only you + admin see it). The public profile doesn't show it.
- **Markdown bio** — `bio` is plain text, not markdown.
- **Test Discord webhook** button — trigger an event manually (a check-in at a followed place, etc.)
