---
title: "Managing API tokens"
section: "2. Publishing"
order: 60
icon: "🔑"
---

# API tokens

External publishing (from VS Code, RStudio, Jupyter, curl, your own scripts) needs a **personal access token** — you create it in Astrozor and paste it into the tool.

## Creating a token

1. Sign in to Astrozor
2. **Settings → API tokens**
3. **Create token**
4. Label (e.g. "RStudio – work laptop") — visible only to you
5. Scope: tick **`publish:articles`** (for publishing). Optionally `read:profile` (reserved, not used yet).
6. **Create**
7. **COPY the plaintext token** — shown **ONCE ONLY**. Once you close the dialog, the server keeps only a hash; the token can't be re-displayed.

Token format: `ast_pat_<base64url-40>`.

## Security

- The token = a persistent password to publish on your behalf. **Don't share it.**
- If you leak it (git commit, screenshot, Slack), **revoke immediately** (below) and create a new one.
- Tokens don't expire by default — `expires_at` can be set at creation (currently only via Django admin).
- The token CANNOT sign you into the web UI or change your profile / password. Just `publish:articles`.

## Revocation

1. **Settings → API tokens**
2. Click **Revoke** next to the token
3. The server stops accepting it immediately. No grace window, no refresh.

## Where to put the token

| Tool | How to set it |
|---|---|
| VS Code | `Astrozor: Set API token` (Secret Storage, encrypted) |
| RStudio addin | `astrozorpub::astrozor_set_token("ast_pat_…")` — writes to `~/.Renviron` |
| Jupyter / curl | Env var `ASTROZOR_TOKEN` or directly into the `Authorization: Bearer …` header |

## Verifying

`GET /api/v1/publish/whoami` (header `Authorization: Bearer …`) returns:

```json
{
  "user_email": "you@example.com",
  "token_name": "RStudio – work laptop",
  "scopes": ["publish:articles"]
}
```

Status `401 Unauthorized` = the token doesn't exist, is revoked, or expired.

## Best practices

- **Per-device tokens.** Same token on 3 devices = lose one, revoke all three. Better: one token per device.
- **Self-documenting labels.** "VS Code – home desktop", "RStudio – office", … — handy in the listing.
- **Periodic rotation.** Revoke + create new every six months. Not enforced, just good hygiene.
- **Never commit to public repos.** Tokens in git history get leaked by automated scanners. Use `.env` or Secret Storage.

## Troubleshooting

| Error | Cause |
|---|---|
| `401 Unauthorized` | Token doesn't exist / revoked / expired / mis-copied (last char often missing) |
| `403 Token missing 'publish:articles' scope` | Token created without the right scope — create a new one |
