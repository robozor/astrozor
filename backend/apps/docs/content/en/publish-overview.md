---
title: "Publishing — overview"
section: "2. Publishing"
order: 10
icon: "📰"
---

# What you can publish on Astrozor

Astrozor isn't just for static text. You can publish **full interactive scientific articles** with everything modern formats offer.

## Supported content

- **Markdown** — text, lists, tables, syntax-highlighted code, images, LaTeX math (via MathJax).
- **Quarto** (`.qmd`) — Markdown + R/Python code blocks rendered as **interactive output**: sortable tables, plotly charts, leaflet maps, MathJax equations, table of contents.
- **RMarkdown** (`.Rmd`) — same from the R ecosystem, compatible with every existing R-Markdown widget (kable, gt, ggplot, plotly, htmlwidgets).
- **Jupyter notebook** (`.ipynb`) — rendered to HTML (e.g. via `jupyter nbconvert`), keeping interactive widgets, plotly charts, and markdown cells alive.

Pre-rendered output renders inside an **iframe** in the article — JavaScript runs at full speed (plotly hover/zoom, MathJax DOM mutation).

## How an article gets in

Four equivalent paths — pick whichever is closest to your workflow.

| Path | Best for | Required |
|---|---|---|
| **Astrozor in-app editor** | Short texts, notes, blogs | Just a browser |
| **VS Code extension** | Markdown or Quarto users in VS Code | VS Code + extension (instructions inside) |
| **RStudio addin** | R users, Quarto/RMarkdown with R code | RStudio + `astrozorpub` package |
| **Jupyter notebook** | Python / Julia / scientific workflow | Jupyter + `jupyter nbconvert` |

All paths hit the same backend — **`POST /api/v1/publish/articles`** (markdown) or **`POST /api/v1/publish/quarto`** (pre-rendered HTML bundle).

## Idempotence

Publishing with the **same slug** (URL-friendly name) twice:

- **Markdown publish**: creates a new article with a `-2`, `-3` suffix (not idempotent yet)
- **Quarto/HTML bundle publish**: updates the existing article in place — no duplicates, preserves DOI and comments

Great for iterative writing: write, render, publish, fix, publish again — all under one URL.

## DOI and citation

Every published article gets a **DOI** via Zenodo (sandbox in dev mode, production Zenodo otherwise). You can cite the article from scholarly work.

## License

Default is **CC BY 4.0** — anyone can share and adapt with attribution. Override in the manifest (`license: "..."` in the frontmatter or in the addin dialog).

## Try it

The **Articles** section ships with 4 example articles — each published through a different path. Download the source, open it in your favourite IDE, render, and publish back to verify your toolchain works.

Detailed guides:

- [Publishing from Astrozor (in-app editor)](publish-astrozor-editor)
- [Publishing from VS Code](publish-vscode)
- [Publishing from RStudio](publish-rstudio)
- [Publishing from Jupyter](publish-jupyter)
- [Managing API tokens](api-tokens)
