---
title: "Publishing from RStudio"
section: "2. Publishing"
order: 40
icon: "Ⓡ"
---

# Publishing from RStudio

R users get an **RStudio addin** distributed as the CRAN-like R package `astrozorpub`. It publishes `.qmd` and `.Rmd` straight from the editor — render, zip, upload.

## 1) Install `astrozorpub`

The R repository is hosted by this Astrozor instance. In RStudio's R console:

```r
install.packages("astrozorpub", repos = "<THIS_HOST>/R")
```

(The exact snippet with your host is in Settings → R package.)

After install, an **Addins** menu appears in the RStudio toolbar.

## 2) Create an API token

In Astrozor:

1. **Settings → API tokens → Create token**
2. Scope: `publish:articles`, label e.g. "RStudio"
3. Copy the plaintext (`ast_pat_…`) — shown only once

## 3) Configure R

In the R console:

```r
# Only if you don't publish to prod (default https://astrozor.cz):
astrozorpub::astrozor_set_base_url("http://astrozor.localhost")

# Paste your token:
astrozorpub::astrozor_set_token("ast_pat_xxxxxxxxxxxx")

# Sanity check:
astrozorpub::astrozor_whoami()
# → list(user_email = "...", token_name = "...", scopes = c("publish:articles"))
```

Token + URL persist in `~/.Renviron` as `ASTROZOR_TOKEN` and `ASTROZOR_BASE_URL`. After `astrozor_set_*()`, restart the R session (**Session → Restart R**) — new env vars get picked up by new sessions automatically.

## 4) Publish via the addin

1. Open a `.qmd` or `.Rmd` in RStudio
2. **Addins** menu → **Publish to Astrozor**
3. Verify the pre-filled title / slug / summary
4. Pick a rendering theme:
   - **Dark (Astrozor design)** — bootswatch `darkly` + slate-900 background (blends with Astrozor)
   - **Light** — bootswatch `cosmo`
   - **No change** — keeps your `format: html: theme:` from the YAML
5. **Publish**

Same slug a second time = update of the existing article (idempotent).

## 5) Publish from code

```r
# Render + bundle + upload in one step
astrozorpub::astrozor_publish(
  "report.qmd",
  title   = "My experiment",
  slug    = "my-experiment",
  summary = "Short description"
)

# If an .html already exists from a prior render:
astrozorpub::astrozor_publish(
  "report.qmd",
  render = FALSE  # uses the existing report.html next to .qmd
)

# Just build the bundle without uploading (debug):
zip_path <- astrozorpub::astrozor_bundle("output/report.html")
```

## Rendering theme

Astrozor is always dark. Default `theme = "dark"` bakes in bootswatch `darkly` and forces:

- `backgroundcolor: "#0f172a"` (slate-900 — matches Astrozor)
- `fontcolor: "#e2e8f0"` (slate-200)
- `linkcolor: "#818cf8"` (indigo-400)

Override happens through Quarto's `--metadata-file` mechanism — **merged** with your YAML, all other settings (TOC, fig-cap, code-fold…) are preserved.

## What gets sent

`POST /api/publish/quarto` multipart/form-data:

| Field | Content |
|---|---|
| `bundle` | ZIP with `index.html` at root + asset dir (`*_files/`, `libs/`) |
| `title` | Article title |
| `slug` | URL slug (optional — server derives from title if missing) |
| `summary` | Short description |
| `language` | `cs` / `en` |
| `engine` | `quarto` or `rmarkdown` (auto-detected from extension) |
| `published_via` | `rstudio` |

Header: `Authorization: Bearer ast_pat_…`

## Limits

- ZIP up to 100 MB compressed / 500 MB uncompressed
- Bundle must have `index.html` at root (the R package stages this automatically)
- Symlinks in ZIP are rejected (security)
- Quota counts against `Profile.storage_quota_bytes` (default 5 GB)
- **Shiny documents** (`runtime: shiny`) are **refused** — Astrozor publishes pre-rendered HTML, Shiny apps need a live R server

## Troubleshooting

| Error | Fix |
|---|---|
| `401 Token rejected` | Token expired/revoked — create a new one and `astrozor_set_token()` |
| `400 Slug taken by another user` | Pick a different slug |
| `507 Storage quota exceeded` | Delete older articles or ask an admin to raise the quota |
| `400 Archive must contain index.html at root` | Bug in `astrozor_bundle()` — check the structure of your output dir |

## Try it with a sample

Download the test `.qmd` from [Sample articles](/samples/rstudio-quarto.qmd), open it in RStudio, and publish through the addin.
