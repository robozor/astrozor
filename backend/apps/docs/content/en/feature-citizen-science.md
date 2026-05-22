---
title: "Citizen Science"
section: "3. Features"
order: 40
icon: "🔬"
---

# Citizen Science

The **Citizen Science** section is a portal into [Zooniverse](https://www.zooniverse.org) — thousands of volunteer scientists who classify images, transcribe historical documents, measure objects. Astrozor is a **directory of admin-curated Zooniverse projects** + **own sprints** for coordinated group classification.

## Main screen

Three content layers top to bottom:

1. **GroupDashboardHero** — stats for the **Astrozor Zooniverse Group** (total classifications, top contributors)
2. **JoinAstrozorGroupCard** — onboarding card with current state (4 states, see below)
3. **Featured projects grid** — admin-curated Zooniverse projects (`is_featured = True`)
4. Below: **CampaignsBelow** — Astrozor in-house campaigns without Zooniverse links (if any exist)

## Onboarding — 4 states of the "Join Astrozor Group" card

Astrozor is registered as a **Group** on Zooniverse (group ID via `ZOONIVERSE_GROUP_ID` env var). Group classifications cumulate into stats and leaderboards.

### State A — Anonymous

You see a blue card with a prompt **"Sign in and help us"** + a link to the **public group page** on Zooniverse (members, stats).

### State B — Signed in, no Zooniverse link

Blue card with a **"Link Zooniverse"** button. Click → OAuth flow via `panoptes.zooniverse.org` (Settings → Connected accounts → Zooniverse, see [Settings](feature-settings)).

### State C — Linked, not yet a member

Blue card with **"Join the group of X users"**. Click:

1. Opens Zooniverse in a new tab at `join_url` (Astrozor Group invite page)
2. Click **Join** on Zooniverse
3. Come back to Astrozor
4. Astrozor periodically **polls** membership state at 30 s / 2 min / 10 min (worst-case staircase)
5. A re-check also fires on window `focus` (when you return to the tab)
6. Once Zooniverse confirms, the card turns green

### State D — Active member

Green card `● You're a member` + link to the public group page.

## Featured projects

Grid of admin-picked cards (`is_featured: true`). Each card:

- **Banner / avatar** (with a telescope-emoji fallback for missing images)
- **Title** + owner login (`@username`)
- **Tags**
- **Total classifications** count
- **Group contribution** count (how many classifications the Astrozor group made)

Click opens `ZooniverseProjectDetail` (URL `?p=<zooniverse_id>`).

> Admins add projects via **Admin → Zooniverse projects** ([see Administration](feature-admin)).

## Project detail

After clicking a card:

### Banner + meta

- Large background-image banner (21:9 ratio)
- Title + owner_login
- Button **Open project on Zooniverse** (top right, link)

### Main content (left column)

- **Introduction** or description (whitespace-pre-wrap)
- **Zombie warning** — alert banner if the project is "zombie" (= Zooniverse archive)
- **ClassifyButtons** — list of workflows from the project, each a button:
  - Click opens the Zooniverse classification UI for that workflow in a new tab
  - If you're not signed in, a hint below the buttons explains Zooniverse will let you in as anonymous (classifications won't be saved to an account)
- **SprintsSection** — chronological list of sprints (see below)

### Right sticky aside

- **Activity sparkline** — classification count chart for the last 30 days (from the `projectSeries` endpoint)
- **Stats card**:
  - Total classifications (number)
  - Group classifications (Astrozor group, indigo)
  - Project state (`live`, `paused`, etc.)
  - Primary language
- **Tags** chip list

## Sprints

A **sprint** = a time-bounded group classification window for one workflow within a project. Astrozor sprints:

- Have their own `slug`, title, description
- **starts_at + ends_at** (date range) OR just `starts_at` (open-ended) OR neither (any-time)
- **Coordinator** — who runs it (email + display_name)
- **Workflow** — which Zooniverse workflow gets classified during the sprint (`workflow_id`, `workflow_name`, `workflow_classify_url`)
- **Status** — `draft` / `live` / `archived`
- **Participants** — explicit opt-in via Join button

### Sprint detail (`SprintFullPage`)

URL `/citizen-science?p=<zid>&s=<slug>`. Layout:

- **← Back to project** + status badge
- **Title + dates + coordinator + workflow name**
- **Description** (whitespace-pre-wrap)
- **🔭 Open workflow on Zooniverse** (CTA, opens classification UI in a new tab)
- **Join / Leave sprint** button
- If you're not a participant: an indigo prompt card **"👋 Join this sprint"** with its own Join button
- **SprintChat** — threaded chat among sprint participants (separate from Zooniverse Talk)
- **ZooniverseTalkBrowser** — embedded Zooniverse Talk forum for the project (read via Talk API)

## Use-cases

### Use-case 1: Start contributing (first visit)

1. Open **Citizen Science** in the nav
2. You see the onboarding card "Sign in and help us"
3. Sign in via SSO (GitHub / Google / …)
4. The card flips to **"Link Zooniverse"**
5. Click → OAuth flow → approve the `read:profile` scope on Zooniverse
6. The card flips to **"Join the group"**
7. Click → opens Zooniverse in a new tab → **Join** there
8. Come back → after about 30 s Astrozor confirms membership → card turns green
9. Click a **featured project** → open the **Classify** button → Zooniverse classification UI in a new tab
10. Your classifications cumulate into `group_contribution_count` (and your `ZooniverseContributor` row)

### Use-case 2: Join a sprint

1. Open a project detail (from the grid)
2. Below ClassifyButtons is the **SprintsSection** with a list of active sprints
3. Click a sprint → opens `SprintFullPage` (URL `?s=<slug>`)
4. Click **Join** → your `Sprint.is_joined = true`
5. Your classifications for `workflow_id` during `starts_at..ends_at` count toward the sprint
6. In SprintChat you can discuss with other participants
7. To classify, click **🔭 Open workflow on Zooniverse** → Zooniverse UI

### Use-case 3: Watch group stats

1. Open **Citizen Science**
2. At the top `GroupDashboardHero` shows:
   - Total group classifications across projects
   - Top contributors (Astrozor users)
   - Recent activity
3. For per-project stats, open the project detail → right aside card **Activity last 30 days** (sparkline)

## In-house campaigns (CampaignsBelow)

Below the Zooniverse projects grid is a section with Astrozor in-house campaigns (via the `CampaignsPage` component). These campaigns are NOT on Zooniverse — they're our own organized activities (e.g. "Meteor shower observation").

`Campaign` fields:
- Title, description, methodology
- Status (`draft` / `live` / `archived`)
- Coordinator email
- Kind (`other` default)
- `contribution_schema` (JSON for structured submissions)
- Tags
- starts_at, ends_at

This block is visible only when at least one in-house campaign exists.

## Data model

```python
class ZooniverseProject:
    zooniverse_id, slug, title, owner_login, classifications_count,
    group_contribution_count, is_featured, tags, ...

class Campaign:
    id, slug, title, description, status, coordinator_email,
    starts_at, ends_at, zooniverse_project (FK), workflow_id, workflow_name, ...
    # When zooniverse_project is set → Campaign is a "sprint"

class ZooniverseContributor:
    user (FK), zooniverse_login, classifications_count, last_seen, ...
```
