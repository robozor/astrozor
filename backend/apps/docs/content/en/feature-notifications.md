---
title: "Notifications"
section: "3. Features"
order: 70
icon: "🔔"
---

# Notifications

Astrozor has **three independent notification channels**:

1. **In-app bell** in the header (always on, default)
2. **Discord webhook** (opt-in, per event type)
3. **Web push** in the browser (opt-in, full set)

## 1) In-app bell

Top-right of the header: **🔔 bell**. Astrozor fans out **2 in-app event kinds**:

| Kind | Trigger |
|---|---|
| `chat.message` | Someone sent a message in the chat of a place you subscribe to |
| `presence.checkin` | Someone checked in at a place you subscribe to |

> Other types (`publishing.article`, `events.event`, `citizen.campaign`) are **reserved in the backend, not activated yet** — they appear as TODOs in the model. For those events you currently only get a Discord notification (if enabled — see below) or web push.

### Bell behavior — standard read/unread logic

- **Badge with a count** in the top-right of the bell shows **unread count** (rose-500, max display `99+`)
- **Click the bell** opens a dropdown with the latest **20 notifications**
- **Unread** notifications have:
  - Indigo-950/30 background
  - Blue dot to the left of the text
- **Read** ones have the standard (slate-800 hover) background, no dot
- **Click a notification**:
  1. Marks it as read (POST `/notifications/<id>/read`)
  2. If it has a `link` (e.g. `/places/stefanikova-hvezdarna`), navigates there
  3. Closes the dropdown
- **"Mark all as read"** button in the dropdown header (visible only when `unread > 0`) — POST `/notifications/read-all`
- Auto-refreshes every 15 seconds (polling, no WebSocket)

### Use-case: Clear a pile of old notifications

1. Click 🔔 → opens dropdown
2. You see 20 items, some indigo (unread)
3. Top-right of the dropdown click **Mark all as read**
4. All flip to read (badge disappears)
5. The server stores `read_at = now` on all of them

### Use-case: Jump to detail from a notification

1. Click 🔔
2. Find "Someone checked in at Praděd"
3. Click the row
4. Astrozor navigates to `/places/praded` (map detail panel)
5. The notification is marked read in DB

## 2) Discord notifications (webhook)

**Self-service** opt-in via Settings → Notifications.

### Setup

1. In Astrozor Settings → Notifications → **Discord webhook URL**:
   - On your Discord server: **Server Settings → Integrations → Webhooks → New Webhook → Copy URL**
   - URL format: `https://discord.com/api/webhooks/<id>/<token>`
   - Paste into the Astrozor field, click Save
2. **Discord notifications — event types** section below — tick the kinds you want:

| Kind | What it fans out |
|---|---|
| `place_followed_checkin` | Check-in at a **place you follow** |
| `place_any_checkin` | **Any** check-in anywhere (can be a lot) |
| `article_published` | New article (filterable by author email) |
| `event_status_changed` | Event status change (filterable by organizer, slugs, target states) |
| `project_lifecycle` | Project created / archived (you can pick one direction or both) |
| `campaign_status_changed` | Citizen-science campaign status change (filterable) |

Each kind has a `filters` (JSON) field — the UI offers checkboxes / text fields per type.

3. **Save**

### Test webhook

After setting the webhook URL: there's **no "Test" button** in the Discord webhook detail in Astrozor (yet) — trigger a real event manually or wait for one to fire.

> **TODO**: Test webhook button missing. Workaround: do a check-in at a followed place yourself and watch Discord.

### Per-kind filters

Some Discord kinds have a **filters JSON field**:

- `article_published` → `{author_emails: ["a@x.com"]}` (empty = all)
- `event_status_changed` → `{organizer_emails: [...], event_slugs: [...], to_states: ["registration_open"]}` (each empty = no filter)
- `project_lifecycle` → `{actions: ["created", "archived"]}` (empty = both)
- `campaign_status_changed` → analogously to events

The UI for these filters lives in the `DiscordPrefsSection` component in Settings.

## 3) Web push

**Status:** Currently **not exposed as a UI toggle**. The backend `apps.notifications` has VAPID infrastructure ready, but the **Enable push** button in Settings is missing.

> **TODO**: Web push toggle in the UI. Backend is ready (VAPID keys via env vars `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`).

## 4) E-mail

ADR-003: Astrozor **does not send notification email** except:

1. **Email verification** at signup
2. **Password reset** flow

No marketing email, no digests, no comment-reply emails. Use Discord or the bell for real-time.

> **Note:** Event reminders 24h before an event, which I previously mentioned, **are also not implemented**. For a reminder, add the event to your calendar via the iCal export (see [Events](feature-events)).

## Subscriptions

For the bell and Discord to fire, you need an active **subscription**. Astrozor currently supports subscriptions to **places only** (`kind: place`).

- In the place detail on the map, click **Subscribe**
- A `Subscription(kind=place, target_id=<place_slug>)` is created
- From now on you'll receive:
  - In-app bell: `chat.message` and `presence.checkin` from this place
  - Discord webhook (if enabled): `place_followed_checkin` from this place

> Planned but **not yet**: subscriptions to projects (kind: project) and events (kind: event).

## Data model

For completeness:

```python
class Notification:
    user, kind, source_kind, source_id, title, body, link,
    created_at, read_at  # read_at=None == unread

class Subscription:
    user, kind (only "place"), target_id, created_at

class DiscordPreference:
    user, kind (6 types), enabled, filters (JSON), updated_at
```
