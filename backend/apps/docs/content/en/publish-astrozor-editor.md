---
title: "Publishing in Astrozor (in-app editor)"
section: "2. Publishing"
order: 20
icon: "✍"
---

# Publishing directly in Astrozor

For short texts, blog posts, and notes there's nothing to install — Astrozor ships a **markdown editor** with live preview.

## Workflow

1. Click **Articles** in the main nav
2. Top-left of the listing: **+ New article**
3. Fill in:
   - **Title** — required, 2 to 200 chars
   - **Short summary** — shown in the listing, optional
   - **Language** — `cs` / `en`
   - **Tags** — for search and filtering
   - **License** — default `CC BY 4.0`
   - **Visibility** — `Public` (default) / `Members only` / `Private`
4. Write the body in markdown in the left pane — the right pane is a **live preview**
5. **Publish**

The article gets a DOI via Zenodo and is stored with `published_via="astrozor"`.

## Markdown features

The editor supports GFM (GitHub Flavored Markdown):

- Headings (`# H1`, `## H2`, …)
- **Bold**, _italic_, ~~strikethrough~~, `inline code`
- Lists and nested lists
- Numbered lists
- Task lists: `- [x] done`, `- [ ] todo`
- Syntax-highlighted code blocks (` ```python `)
- Tables
- Links and images
- Blockquotes
- Horizontal rules
- MathJax (LaTeX in `$...$` and `$$...$$`)

The server runs markdown through `markdown-it` + `bleach` sanitization — `<script>`, inline event handlers, and other dangerous HTML are stripped.

## Images

The editor has an **📷 Upload image** button. Files land on the server at `/media/uploads/<user_id>/<file>` and the markdown link `![alt](URL)` is inserted. Max 8 MiB per file, 5 GB per user.

## Tags

Start typing in the tag field and the editor suggests **existing tags** from the whole app (articles + events + projects + campaigns). If none match, create a new one.

## Templates

Look at the example articles in **Articles** for inspiration — each is published a different way, the in-app editor is the first one.

## Editing after publish

1. Open the article from the listing
2. Toolbar at top-right → **✎ Edit**
3. Edit in the markdown editor
4. **Save**

Same slug → same article. DOI persists, comments persist.

## Comments

Below each article you find a **threaded comment tree** — users can discuss and reply to each other. Comments live inline; no separate windows.

## Sharing to Mastodon

After publish, an **🐘 Share to Mastodon** button appears in the article header. It opens a dialog with a pre-filled toot — `title + URL + tags` — and (depending on Settings → Mastodon) cross-posts to your linked account.

## Troubleshooting

| Problem | Fix |
|---|---|
| **Publish** is greyed out | Fill in the required title (min 2 chars) |
| `415 Unsupported Media Type` on image upload | Not an image, or over 8 MiB |
| `Quota exceeded` | Delete older images / articles in Settings |
| Preview doesn't show formulas | Refresh — MathJax initializes on load |
