---
title: "Articles"
section: "3. Features"
order: 20
icon: "📰"
---

# Articles

The **Articles** section is the main publishing space — markdown texts, interactive Quarto/RMarkdown bundles, Jupyter notebooks. Scientific articles with DOI, comments, and Mastodon sharing.

## Main screen

Left column:

- **+ New article** + **Import Quarto** buttons (signed-in only)
- **Tag filter** (`TagFilter`) — multi-select chip filter
- **Language filter** — `All` / `cs` / `en` (defaults to your profile language)
- **HeroCard** — biggest, magazine-style, newest article + cover image + summary (16:9 mobile, 280px sidebar desktop)
- **Card grid** (3 columns on desktop) for other articles

Right column (desktop, lg+): **`MastodonRail`** — community Mastodon feed (see [Mastodon](mastodon-crossposting)).

On mobile the left/right columns live on separate tabs (Articles ↔ Mastodon).

## Article card

Each card in the grid / hero has:

- **Cover image** — `article.cover_image_url` or a generated gradient fallback (from slug hash) in 16:9
- **Engine badge** bottom-left on the cover — markdown / quarto / rmarkdown / jupyter (official brand icon in a colored square)
- **Featured badge** (HeroCard only) — full indigo label if `article.featured = true`
- **Members-only badge** top-right (yellow lock) — if `visibility=members`
- **Engine label** + language + reading minutes ("5 min read")
- **Title** (text-xl for hero, text-base for grid)
- **Summary** (line-clamp-2 grid, line-clamp-4 hero)
- **Author** (via `UserNameLink` — click opens public profile) + date + DOI (if any)
- **Tags** chip list (xs size)

## Article detail

URL `/articles?a=<slug>` (SPA deep-link) or `/clanky/<slug>` (server-rendered SEO redirect).

### Layout

1. **Top toolbar**:
   - **← Back to list** (left)
   - **🐘 Share to Mastodon** (right) — only for published articles
   - **✎ Edit** (right) — only for the article author
2. **Cover image** (optional) — if `cover_image_url` is set, rendered in a centered box with `max-h-72/80`, `object-contain` (never cropped)
3. **Header**:
   - **Title** (h2, semibold)
   - **Author / date / language / license / DOI** (xs line below the title)
4. **Article body**:
   - **Markdown engine** → rendered HTML from `content_html`, styled via `.article-html`
   - **Quarto/RMarkdown/Jupyter engine** → `QuartoIframe` with `asset_url` (auto-resize iframe)
5. **Comments** — `ThreadedDiscussion` (see below)

### Cover image rendering — rules

| Place | Object-fit | Reason |
|---|---|---|
| **HeroCard** | `object-cover` (16:9 + min-h 180-260px desktop) | Magazine style, uniform grid |
| **ArticleCard** | `object-cover` (16:9) | Uniform grid in the listing |
| **Detail** | `object-contain` (max-h-72/80, justify-center) | Full image without cropping — 800×600 stays whole |

If an article has no `cover_image_url`, the list cards show a **gradient fallback** (HSL from slug hash) — colored square with a star glyph. The detail in that case **renders no banner at all** (you go straight to the title).

## Article editor

Opened via **+ New article** or **✎ Edit**. Fields:

- **Title** — required, 2-200 chars
- **Summary** — short description for the listing (line-clamp in the card)
- **Language** — `cs` / `en`
- **License** — text field, defaults to "CC BY 4.0"
- **Tags** — autocomplete (`TagInput`) over the global taggit DB
- **Visibility** — `public` / `members` (signed-in only)
- **Featured** — toggle (admin only?)
- **Cover image** — upload via `uploads.articleCover` (server resizes to 1600px width, JPEG re-encode)
- **Content** — `MarkdownEditor` (left pane edit, right pane live preview)

When you're done:

- **Save as draft** → status `draft`, only you see it
- **Publish** → server adds it to the listing, optionally **mints a DOI** via Zenodo

### Use-case 1: Write a blog post

1. **Articles → + New article**
2. Title: "How I saw the Perseids"
3. Language: en
4. Body: write in the markdown editor — bold, italic, code, lists, MathJax, images
5. **Upload cover image** — drop a jpeg/png (server resizes to 1600px max)
6. Tags: `perseids, meteors, observation`
7. Visibility: public
8. **Publish**
9. Optionally tick **Mint DOI** → server sends to Zenodo (sandbox in dev, prod in production)
10. After publish you get URL `/articles?a=how-i-saw-the-perseids`

### Use-case 2: Import an existing Quarto bundle (browser flow)

1. **Articles → 📦 Import Quarto bundle** (modal)
2. Drag-drop a `.zip` (Quarto output with `index.html` at root)
3. Title, slug (optional), summary
4. **Upload** → server stores under `/media/quarto/<user_id>/<slug>/`
5. The article gets a URL, the detail shows it as an iframe

Alternatively from VS Code / RStudio — see [Publishing — overview](publish-overview).

### Use-case 3: Edit a published article

1. Open the detail
2. **✎ Edit** top-right
3. Change anything except the slug (slug is permanent)
4. **Save**
5. After update, the cache invalidates, others see the new version immediately

## Comments

The `ThreadedDiscussion` component below the article. Features:

- **Threaded** structure — reply to a specific comment to build a tree
- **Markdown** in comments (basic — bold, italic, code, lists, links)
- **Edit / delete** your own comments (admin can delete any)
- **Auto-refresh** via React Query polling
- **Empty state** — `articles.commentsEmpty` text when no comments

Comments are visible **only on published articles** (`status === "published"`). On drafts you see a hint instead: "Comments will be available after publishing".

## Sharing to Mastodon

Detail toolbar → **🐘 Share to Mastodon** → opens `MastodonShareModal` (see [Mastodon cross-posting](mastodon-crossposting)).

The shared URL is **`/clanky/<slug>`** (the server-rendered SEO route) — not `/articles?a=<slug>`. Reason: the SEO route emits OG meta tags + JSON-LD, so when Mastodon (or any social server) fetches the URL it renders a proper preview card with cover, title, summary. Real users clicking through get a `<meta refresh>` redirect to the SPA URL.

## DOI / Zenodo

When you publish with `Mint DOI` checked:

1. Backend sends article metadata to **Zenodo API** (`/api/deposit/depositions`)
2. Zenodo returns a DOI like `10.5281/zenodo.<id>`
3. Backend stores it in `article.doi`
4. The card and detail show it as `DOI 10.5281/zenodo.503402`

Per-user Zenodo token in Settings → Integrations → Zenodo API token. Without a token Astrozor mints against the **platform-wide Zenodo sandbox** (env `ZENODO_SANDBOX_TOKEN`).

In dev mode (`DJANGO_DEBUG=true`) it defaults to **sandbox.zenodo.org** (test DOIs, not real).

## RSS / Atom feed

Public articles export as:

- `<HOST>/articles.atom` — Atom 1.0 feed
- `<HOST>/articles.rss` — RSS 2.0 feed

Useful for RSS readers (Feedly, Miniflux, Newsboat).

## SEO route `/clanky/<slug>`

Server-rendered HTML page with OG meta + JSON-LD `ScholarlyArticle`. When you share the URL on a social network, the crawler fetches it, parses meta, and shows a nice preview card. Then the browser gets a `<meta refresh>` redirect to `/articles?a=<slug>` (SPA).

> Heads-up: even though the share URL is `/clanky/<slug>`, **inside Astrozor** navigation goes to `/articles?a=<slug>` (via the Mastodon share modal and the server SEO redirect).

## Engine icons

The card + detail show the engine type via a brand SVG icon:

| Engine | Icon (in `/icons/`) | Background |
|---|---|---|
| `markdown` | markdown.svg | slate-800 |
| `quarto` | quarto.svg | indigo-950 |
| `rmarkdown` | r.svg | sky-950 |
| `jupyter` | jupyter.svg | amber-950 |

## Reserved / TODO

- **Full-text search** — TagFilter works, but full-text search across title + body is missing (tag filter only)
- **Translation linking** — linking CS ↔ EN versions of the same article doesn't exist yet
- **Versioning** — DOI is per-publication; editing an article doesn't change the DOI (Zenodo has a "new version" flow, but we're not there yet)
- **Citation export** (BibTeX) — manual copy of the DOI for now
