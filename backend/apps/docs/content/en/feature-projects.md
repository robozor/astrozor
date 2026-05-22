---
title: "Projects"
section: "3. Features"
order: 50
icon: "💻"
---

# Projects

The **Projects** section is a directory of the community's open technical activities — software, hardware, research repos. Each project can have linked **GitHub repositories** and Astrozor enriches them with an issue tracker, assignee management, and a solver leaderboard.

## Main screen

### Hero intro (`ProjectsIntro`)

First thing on screen — a gradient card with an illustration **CollaborationIllustration** (inline SVG, no external images). Pitch:

- "Want to get involved?"
- 3 bullets of what you can do
- Browse without sign-in, claim an issue requires sign-in

### Issue Leaderboard panel

Global solver leaderboard across **all visible project repositories**. Per GitHub username:

- **Avatar** + GH login (link to GitHub profile)
- **Open issues count** assigned to this user
- **Astrozor display name** next to the GH login (if the user has an Astrozor identity with the same login in the Identity table) — format `Robozor (robozor)`
- Sorted desc by issue count

When >8 entries: **Expand** button.

### Project list

Each project card:

- **Title**
- **Description** with linkified http(s) URLs (clickable links in plain text, see `linkifyText`)
- **Owner** + visibility badge (`public` / `members` / `private`) + status badge (when != `active`)
- **Members** badge
- **Tags**
- **Linked GH repos** — when present, icon + open issue count

**+ New project** top-right.

## Project detail

Below the top bar (back left, Join/Leave + Edit/Delete right):

### Header

- **Title** (h2)
- **Owner: `email`** + visibility badge + status badge
- Buttons:
  - **Join** — anyone can (open membership, no invitation flow)
  - **Leave** — disabled if you're the creator (creator can't leave)
  - **✎ Edit** — only when `can_edit` (creator + Astrozor admin)
  - **Delete** — only when edit

### Description

Plain text with `linkifyText` — http/https URLs become clickable `<a>` (target=_blank). A trailing period / comma / paren isn't treated as part of the URL ("see https://x.com." → link goes to `https://x.com`).

### Members

Sub-section with the `Membership` list:

- **Avatar + display name** (via `UserNameLink` to the public profile)
- **Role** badge — `OWNER` / `MAINTAINER` / `CONTRIBUTOR`
- Default `CONTRIBUTOR` on Join; OWNER is the creator (auto); MAINTAINER currently only via Django admin / shell

### GitHub repositories (`RepoCard` per repo)

For each linked GitHub repo:

- **Logo + URL** (link to GitHub)
- **Metadata** — description, stars, language, default branch
- **Last release** + date (from GH API)
- **Last commit** date
- **🐛 Issues counter** — `X open issues · + N PR` (issues and PRs counted separately)
- **+ New issue** button — opens a modal:
  - Title, body (markdown)
  - Type: `bug` / `feature` / `task`
  - Astrozor POSTs to GitHub `/repos/{owner}/{name}/issues` with a label per type + an `astrozor` label (origin marker)
  - After creation: 800 ms delay + setQueryData refresh (GitHub eventual-consistency workaround)

### IssuesPanel

Expanded list of open issues from the repo:

- **#number, title, labels, assignees**
- **Click an issue** → opens `IssueDetailPanel` (in-app)

### IssueDetailPanel

Modal with full issue details:

- Title, body (raw text from GH), labels
- **Assignees** — list of avatars with GH logins
- Buttons:
  - **🙋 Take this** — when you're not an assignee (adds you via `POST /issues/{n}/assignees`)
  - **Join the solvers** — when someone else is already assigned (adds you as a co-assignee)
  - **✕ Step down** — when you're already an assignee (removes you via `DELETE /issues/{n}/assignees` with body)
  - **✓ You're solving this** — green badge when you're currently an assignee

If a claim fails with `not_collaborator`, Astrozor tells you GitHub refused the assignment (you need write access to the repo).

## Use-case scenarios

### Use-case 1: Join a project

1. **Projects** in the main nav
2. Listing of projects, click the one you're interested in
3. In the detail click **Join** (blue button top-right)
4. You become a `CONTRIBUTOR`
5. You see all `members`-only content of the project (if `visibility=members`)

### Use-case 2: Take an issue

1. Project detail → find the GH repo → expand the IssuesPanel
2. Listing of open issues — you see #number + title + assignees (yellow avatars)
3. Click an issue → `IssueDetailPanel`
4. **🙋 Take this**
5. Astrozor POSTs to GitHub: your GH login is added as an assignee
6. After ~1 second (GH eventual consistency) the panel shows your **✓ You're solving this** badge + **✕ Step down** button
7. Your counter in the project leaderboard increments

### Use-case 3: Create a new issue from Astrozor

1. Project detail → RepoCard → **+ New issue**
2. Title: "Crash when saving the bundle from VS Code"
3. Body (markdown): description + steps to reproduce + expected/actual behavior
4. Type: `bug`
5. **Create**
6. Astrozor:
   - POST `/repos/<owner>/<name>/issues` to GitHub with labels `["bug", "astrozor"]`
   - 800 ms delay (GH eventual-consistency workaround on the listing endpoint)
   - Refreshes the issue list — the new issue appears
7. The open_issues counter increases by 1 (atomic F-expression on the backend)

### Use-case 4: Create a new project

1. **Projects → + New project**
2. Editor fields:
   - **Name** — required
   - **Description** — multi-line, plain text with linkify
   - **Visibility** — `public` / `members` / `private`
   - **Status** — `active` (default) / `paused` / `archived`
   - **Tags** — autocomplete
   - **GitHub repositories** — multi-add (validates URL via GH API)
3. **Create**
4. You become the `OWNER` (automatic)

### Use-case 5: An owner leaving a project

**Not possible.** The server returns 403. Instead:

1. Promote another member to `MAINTAINER` (via Django admin or manually via API — no UI flow yet)
2. Then delete the whole project (`Delete` button top-right)

## What currently DOES NOT EXIST

- **Invitation flow** — no "invite member", "accept invitation". Open membership: anyone can click Join.
- **UI for role transitions** — promoting `CONTRIBUTOR` → `MAINTAINER` only via Django admin
- **Project chat / discussion** — comments on projects are planned, missing for now (comments only on articles / events / campaigns)
- **Activity feed** — who did what in the project, not yet
- **Issue closing from Astrozor** — for close, go to GitHub (Astrozor isn't a maintainer of GitHub API mutations)

## Data model

```python
class Project:
    slug, name, description, visibility, status, tags,
    created_by, created_at, top_contributors (JSON), ...

class Membership:
    project (FK), user (FK), role (OWNER / MAINTAINER / CONTRIBUTOR),
    joined_at

class GHRepo:
    project (FK), owner, name, github_url, description, stars,
    language, default_branch, last_release_*, last_commit_at,
    open_issues, last_fetched_at, last_status, ...
```
