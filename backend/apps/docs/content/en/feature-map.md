---
title: "The observatory map"
section: "3. Features"
order: 10
icon: "🗺"
---

# The observatory map

The default screen after sign-in. Interactive map of the Czech Republic (and surroundings) with layers and hundreds of marked sites.

## Layers and styles

The right-hand panel **Map controls** (☰):

- **Map style** — `OSM`, `Dark`, `Satellite`, `Topo`
- **PMTiles theme** — `Dark` / `Light` (per-tile vector style)
- **Light pollution** — overlay with night-sky brightness (NASA VIIRS), opacity adjustable. Dark areas = good sky.
- **State filter** — `All` / `Active` (someone just checked in) / `Subscribed`
- **Kind filter** — visible marker kinds (checkboxes)
- **Events toggle** — show/hide event markers

Choices are saved to your profile (`map_preferences`) — next sign-in keeps the same view.

## Place markers (4 kinds)

The marker **shape** signals the place kind; **color** only signals activity (someone is currently there). Kinds:

| Shape | Kind | Meaning |
|---|---|---|
| 🌐 Dome with a vertical aperture slit | `observatory_public` | **Public observatory** — open to the public, often with tours and a calendar |
| 🏛 Boxy building with peaked roof + padlock | `observatory_private` | **Private observatory** — private telescope site, detail visible only when signed in |
| ⭐ 5-pointed star | `spot_permanent` | **Permanent dark-sky spot** — outdoor observation site (Říp, Praděd, Pasecká skála…) |
| ⛺ Steep narrow triangle (tent) | `spot_temporary` | **Temporary spot** — pop-up observation site (star party on a non-permanent location) |

Markers are **SVG silhouettes**, not emoji. 22 px, scan-friendly even at mid-zoom.

## Colors and states

- **Greyish/white marker** = idle, no activity
- **Blue body + pulsing red halo** = **active site** (someone just checked in). The red pulse pops over OSM's green landuse layers
- **Yellow star in the marker's bottom-right corner** = **subscribed** (Subscribed badge — you follow this site)

## Event markers (📍)

Events use a **separate marker** — the pin emoji **📍** with a drop shadow. Toggle on/off via **Events** in Map controls.

- Hover shows title + status (`draft` / `announced` / `registration open` / `closed` / `in progress`)
- Click opens the event detail panel — description, date, registration, organizer

Events can sit on top of places (e.g. a star party at a specific observatory) — you'll then see both a dome marker and a pin at the same spot.

## Cluster markers

At low zoom, markers cluster into a **circular bubble with a count** — `2`, `5`, `12`… Click to zoom into the cluster.

## Place detail

Click a marker → **right-hand detail panel**:

- Name + description
- Coordinates + elevation
- **Bortle scale** + SQM (sky quality)
- Operator + contact
- Current activity (who's there today — check-ins)
- **Subscribe button** — get notified when the operator schedules an event or someone checks in
- Linked **events** (calendar for this site)

## Check-in

If you're physically at a place, you can **check in**:

- **I'm here** button in the detail panel (requires current GPS within range of the place)
- The place's status flips to **active** (blue body + pulse)
- Other subscribers see someone is there
- Optionally posts a Mastodon toot "checked in @ X" (enable in Settings → Mastodon → autopost checkin)

## Mobile use

Full-screen on mobile. Bottom button **Open panel ☰** opens Map controls. Pinch-to-zoom, drag pan, double-tap zoom — standard.

## What it's good for

- **Planning an observation night** — pick the closest site with the lowest Bortle scale
- **Eclipse / comet travel** — find dark sky on the route
- **Educators** — show students the sky quality in their region
- **Observatories** — promote your observation nights and events

## Contributing

**Missing a place?** Add it via Settings → Places (admin-only for now, public PR flow coming). Private spots can already be created by any user.
