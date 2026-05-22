---
title: "Events"
section: "3. Features"
order: 30
icon: "📅"
---

# Events

The **Events** section is a calendar of what's happening in the community — observation nights, meet-ups, lectures, online sessions, geocaching expeditions, dark-sky trips.

## Main screen

Top toolbar:

- **Tags** filter — click a chip to narrow the list
- **Include citizen-science sprints** (checkbox) — when on, the listing also includes sprints from Citizen Science (fuchsia cards)
- **+ New event** (button, requires sign-in)

Below the toolbar is a **calendar view** (`EventsCalendar`) — month grid, dot indicators per day. Sprints render as fuchsia bars stretched across their date range.

**Click a day** in the calendar to filter the list to events starting that day. Click again to clear.

## Event list

Each event card shows:

- **Title** + status badge (one of 7 — `draft`, `announced`, `registration_open`, `registration_closed`, `in_progress`, `finished`, `cancelled`)
- **Date + time** in your timezone (via `TimeDisplay` — see [Timezones in Profile](feature-settings))
- **Place** — either a linked place from the map (`place_name`), or `external_address`, or raw coordinates (`external_lat, external_lon`)
- **Attendee count** `5 / 20` (with capacity) or just `5` (no limit)
- **Feature icons** — 🎥 video meeting · 💬 Discord · 🧭 geocaching · 📻 radio frequency
- **Description** (truncated to 2 lines)
- **Tags**

## How to find and register

### Use-case 1: Find a weekend event nearby

1. Open **Events** in the main nav
2. Click on **Saturday or Sunday** in the calendar → the list narrows to that day
3. Filter by **tag** — pick e.g. `observation` or `Milky Way`
4. Scan the cards — feature icons tell you if it's online (🎥), on Discord (💬), or shares a radio frequency (📻)
5. Click a card to open the detail

### Use-case 2: Register

1. Open the event detail
2. Header shows status, date, place, organizer
3. If `status: registration_open` and you're signed in, you see a blue **Register** button
4. Click → server creates a registration → button flips to **Cancel registration**
5. Click **📅 Download iCal** → `.ics` file downloads, open it in your calendar (Google / Apple / Outlook) → the event is imported with full location and description

If `status: registration_closed`, you don't see the button. Detail is read-only.

If you're not signed in, instead of Register you see **Sign in to register** → opens the login modal.

### Use-case 3: Join the online portion of an event

The detail has **action chips** — visible only if the organizer filled the corresponding field:

- 🎥 **Join meeting** (`meeting_url`) — Jitsi, Zoom, Google Meet, …
- 💬 **Discord** (`discord_url`) — invite link to a Discord channel
- 🧭 **Geocaching** (`geocache_url`) — geocache link (accepts a GC code, automatically prepends `geocaching.com/geocache/`)
- 📻 **`145.500 MHz`** (`radio_frequency`) — VHF/UHF frequency for mobile observation (read-only chip)

## How to create and run an event

### Use-case 4: Create an observation night at a specific observatory

1. **Events → + New event**
2. **Title** — required, e.g. "Saturn observation — Štefánik observatory"
3. **Description** — plain text, newlines preserved (`whitespace-pre-wrap`, **not** markdown)
4. **Start + end** — datetime picker. End is optional.
5. **Location** — the `LocationPicker` component:
   - **Pick from map** — searches existing `Place` objects (observatories, sites)
   - **External address** — text + coordinates (e.g. "Lounská 5, Prague 5") — if the location isn't on the map yet
6. **Capacity** — a number or 0 (no limit)
7. **Visibility** (`VisibilityPicker`) — `public` / `members` / `private`
8. **Action fields** (optional, generate chips in the detail):
   - Meeting URL (video call)
   - Discord URL (channel)
   - Geocaching URL or GC code
   - Radio frequency (text — frequency, mode)
9. **Tags** — autocomplete helper (`TagInput`) — type and Enter
10. **Status** — defaults to `draft`
11. **Create**

The event gets `/events?e=<slug>` — easy to share.

### Use-case 5: Open registrations for a created event

After creation the status is `draft` — nobody sees it except you. To publish:

1. Open the event detail (you land there automatically after creation)
2. In the **Organizer actions** card at the bottom, click a transition button **→ announced** (event is announced but registrations not yet open)
3. Then **→ registration_open** — registrations are live
4. When you want to stop signups: **→ registration_closed**
5. On the day of the event: **→ in_progress** (event is happening)
6. After it ends: **→ finished**

All transitions are **bidirectional** except self-loops — you can flip from `registration_closed` back to `registration_open`, etc.

### Use-case 6: Cancel an event

1. Event detail → **Organizer actions**
2. **→ cancelled**
3. The status badge turns red `cancelled`
4. The event stays visible in the list (red status), but registrations are disabled
5. To fully delete, click **✕ Delete** in the top toolbar (confirmation dialog)

> **Heads-up:** There's currently no automatic notification to registered users on cancellation. Communicate manually via Discord / email.

## Citizen Science sprints

When **Include sprints** is on (default), the calendar and listing mix in **fuchsia cards** tagged `[sprint]`. Clicking goes directly to the sprint detail in [Citizen Science](feature-citizen-science) (not to event detail — sprints are managed there).

This gives you a **unified calendar** of all community activity (events + sprints) without splitting the navigation.

## Event detail — overview

| Field | Meaning |
|---|---|
| **Status** | one of 7 (see above) |
| **From/To** | `TimeDisplay` — shows UTC + local (by GPS) + your time (from profile), depending on what's enabled in Settings → Timezones |
| **Location** | `place_name` (from map) / `external_address` (text) / or `lat, lon` |
| **Organizer** | `UserNameLink` — click opens public profile |
| **Description** | plain text with preserved newlines |
| **Action chips** | 🎥 / 💬 / 🧭 / 📻 / 📅 — see above |
| **Registration** | count / capacity + Register/Cancel button (only for `registration_open`) |
| **Organizer actions** | status transition buttons (organizer + staff only) |

## iCal export

The **📅 Download iCal** button in the detail returns an `.ics` file:

- Import into Google Calendar, Apple Calendar, Outlook
- Contains: title, description, location, times
- One-shot download — **not** a subscription feed (after the event is updated you have to download again)

## What doesn't exist (and you might expect)

For honesty — these are sometimes mentioned in forum comments, but **NOT in the current FE**:

- Weather forecasts in the event (clear-sky chart) — go to an external service manually
- Carpool board (who's offering rides) — handle in the event's Discord channel
- On-site QR check-in — use a manual list as organizer
- Mass notification from organizer to attendees — via Discord webhook (Astrozor-side)
- CSV attendee export — only via Django admin for now
- Automatic 24h reminder before the event — not yet
- ICS subscription feed (subscribe URL) — single-event download only

These could be added; the current version is an MVP.
