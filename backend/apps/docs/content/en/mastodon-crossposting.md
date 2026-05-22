---
title: "Mastodon cross-posting"
section: "4. Advanced"
order: 10
icon: "🐘"
---

# Mastodon cross-posting

Astrozor is a first-class Fediverse citizen. You can link your **Mastodon account** (or any ActivityPub-compatible server) to your Astrozor profile, and articles, events, or successful sprints will cross-post as toots.

## How it works

Astrozor isn't itself a Fediverse server (yet — federation server is on the roadmap). Instead it **registers an OAuth app** on your Mastodon server and posts toots **on your behalf**.

That means:
- **Your followers see your toot** (Astrozor isn't a middle layer)
- **Your moderation** — Mastodon server moderates your toots the same as if you wrote them by hand
- **No vendor lock-in** — disconnect, and your previous toots stay on Mastodon

## Linking

In **Settings → Connected accounts → Mastodon**:

1. **Enter your Mastodon server URL** — `mastodon.social`, `fosstodon.org`, `astrodon.social`, anything compatible (Pleroma, GoToSocial, Akkoma work)
2. Astrozor dynamically **registers an OAuth app** on that server (once, per instance)
3. Redirect to your Mastodon → approve permissions (`write:statuses`, `read:accounts`)
4. Astrozor stores a per-instance access token
5. Done — your Mastodon handle appears in your profile

**Multiple Mastodon servers?** No problem — you can have multiple identities, Astrozor distinguishes them per-instance.

## Cross-posting an article

After publishing, an article header shows the **🐘 Share to Mastodon** button. It opens a dialog:

```
📰 Test Markdown publication from VS Code
https://astrozor.cz/clanky/test-markdown-publication-from-vs-code

#astronomy #astrozor #publishing
```

- **Edit the text** before sending
- **Visibility** — Public / Unlisted / Followers only / Direct (per Mastodon)
- **Content warning** (CW) — optional warning above the toot (e.g. "Spoiler: result reveal")
- **Image attach** — if the article has a cover image, it's attached as Mastodon media

Click **Toot** — a Mastodon API request goes out, you get the toot ID back, and Astrozor stores it in `Article.mastodon_status_id`.

## Mastodon Rail

In your Astrozor profile, next to the main content, a **Mastodon Rail** shows your last ~10 toots. Read-only, pulls via Mastodon API.

So your Astrozor profile shows not only your articles, but also your Mastodon activity — for science fans and federated culture.

## Auto-share

In **Settings → Mastodon → Auto-share**:

- **Always** — every published article auto-toots (no dialog)
- **Prompt** — default, always opens a dialog
- **Never** — the button isn't shown at all

## Disconnecting

In **Settings → Mastodon → Disconnect**:

- Astrozor deletes the access token
- The OAuth app on the Mastodon server stays (you can revoke it Mastodon-side via Settings → Authorized apps)
- Existing toots remain on Mastodon (Astrozor can't delete or retroactively edit them)

## Security

- **Per-instance OAuth** = if one Mastodon server goes down or leaks, other instances' Astrozor users aren't affected
- **The token is read+write on `statuses`** — Astrozor can read your toots (for the Rail) and post new ones. It **cannot** delete your existing toots, change profile, block/mute, or read DMs
- **An Astrozor toot is always `from your account`** — Mastodon shows it as your post, not as from "Astrozor bot"

## Who's it for

- Astronomers on Mastodon (`@astro@mastodon.social` etc.) — automatic article sharing
- The public — see not just Astrozor content but also the author's Mastodon activity
- Community — follow `#astrozor` and `#astronomy` across the Fediverse

## Troubleshooting

| Problem | Fix |
|---|---|
| `Mastodon server unreachable` | Server temporarily down — try again later |
| `OAuth app registration failed` | The server doesn't allow `POST /api/v1/apps` (Pleroma with closed registrations) |
| Toot doesn't go out, `401 Unauthorized` | Token revoked Mastodon-side — disconnect and re-link |
| Rail doesn't show toots | Account is `private` or `silenced` — Astrozor reads via public timeline |
