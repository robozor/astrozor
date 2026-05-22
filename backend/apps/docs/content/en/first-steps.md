---
title: "First steps"
section: "1. Getting started"
order: 20
icon: "🚀"
---

# First steps in Astrozor

## 1) Account

Click **Sign in** at the top right. Two paths:

- **SSO** via GitHub, Google, GitLab, or Discord — one click and you're in. Astrozor reads only your name, email, avatar — no repository write access.
- **Email + password** — local account, you get a verification email, click the link.

## 2) Profile

In **Settings**, fill in:

- **Display name** — shown next to your articles and comments
- **Language** — whole UI + default language for new articles
- **Bio** — a few sentences about yourself, shown on your profile
- **Location** — pick a precise spot (share coordinates) or just a region/city. Default is `Private` (share only region). Useful for finding local observers.

## 3) Connected accounts

In **Settings → Connected accounts** you can link **additional SSO providers** to the same Astrozor account (sign in via Google tomorrow, via GitHub next time — still the same user). Plus:

- **Mastodon** — for cross-posting articles to your fediverse account
- **Zooniverse** — for automatic enrollment in citizen-science campaigns

## 4) Notifications

In **Settings → Notifications** turn on:

- **Web push** — browser notifications for new comments, replies, registrations
- **Discord webhook** — fan-out to your channel (for group projects)
- **E-mail** — only for auth flows (verification, password reset), never for routine notifications (ADR-003 — Astrozor doesn't send marketing email)

## 5) Your first article

Easiest path:

1. **Articles** → **+ New article**
2. Type a few paragraphs of markdown (live preview)
3. **Publish**

Details: [Publishing in Astrozor](publish-astrozor-editor).

## 6) Advanced publishing

For Quarto / Jupyter / RMarkdown:

- [From Astrozor (markdown)](publish-astrozor-editor)
- [From VS Code](publish-vscode)
- [From RStudio](publish-rstudio)
- [From Jupyter](publish-jupyter)

## 7) Community

Explore:

- **Map** — local observatories and sites, their sky quality, light pollution
- **Events** — who's organizing what this week / month
- **Citizen Science** — campaigns to join (Zooniverse data classification)
- **Projects** — software, hardware, research projects with open issues you can help with

## Tips

- **Keyboard shortcuts** — in the editor `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link
- **Tag filtering** — click a tag under an article to filter the listing
- **Search** — text search across articles (basic for now, FTS coming)
- **Browse anonymously** — your own content stays hidden, but Map + public Articles + Events are accessible without sign-in
