---
title: "Publishing from Jupyter notebook"
section: "2. Publishing"
order: 50
icon: "📓"
---

# Publishing from Jupyter notebook

There's no dedicated Jupyter addin for Astrozor (yet) — the Jupyter ecosystem is too varied, and `jupyter nbconvert` already does everything we need natively.

## Three-step flow

1. Run all cells (`Cell → Run All`)
2. Convert to HTML: `jupyter nbconvert --to html --embed-images analysis.ipynb`
3. Publish the resulting HTML folder via the VS Code extension or `curl`

## 1) Render the notebook

In the terminal, where your `.ipynb` lives:

```bash
# Static HTML — interactive plotly charts + ipywidgets keep their look
jupyter nbconvert --to html analysis.ipynb

# Better for Astrozor: embed images in HTML (no sibling asset dir needed)
jupyter nbconvert --to html --embed-images analysis.ipynb

# For large notebooks with many figures, leave assets external:
jupyter nbconvert --to html analysis.ipynb --output-dir ./out
```

Output is `analysis.html` (or `out/analysis.html`). Astrozor needs a **folder containing `index.html`**, so:

```bash
mkdir -p bundle
cp analysis.html bundle/index.html
# If there's a sibling _files/ dir (figures, scripts), copy it too:
cp -r analysis_files bundle/
```

## 2) Create an API token

In Astrozor:

1. **Settings → API tokens → Create token**
2. Scope: `publish:articles`
3. Copy `ast_pat_…`

## 3) Publish

### Path A — VS Code (easiest)

Open the `bundle/` folder in VS Code, right-click → **`Astrozor: Publish folder`**. Details in [Publishing from VS Code](publish-vscode).

### Path B — curl

```bash
TOKEN="ast_pat_xxxxxxxxxxxx"
HOST="http://astrozor.localhost"

# Zip with index.html at the root
cd bundle
zip -r ../article.zip .
cd ..

curl -X POST "$HOST/api/v1/publish/quarto" \
  -H "Authorization: Bearer $TOKEN" \
  -F "bundle=@article.zip" \
  -F "title=Meteor shower analysis" \
  -F "slug=meteor-shower-analysis" \
  -F "summary=Jupyter notebook on a meteor shower" \
  -F "language=en" \
  -F "engine=jupyter" \
  -F "published_via=jupyter"
```

Response:

```json
{
  "article_slug": "meteor-shower-analysis",
  "article_id": "...",
  "status": "published",
  "url": "/clanky/meteor-shower-analysis",
  "asset_url": "/media/quarto/<user>/<slug>/index.html"
}
```

### Path C — Python script

```python
import requests

TOKEN = "ast_pat_xxxxxxxxxxxx"
HOST = "http://astrozor.localhost"

with open("article.zip", "rb") as zf:
    response = requests.post(
        f"{HOST}/api/v1/publish/quarto",
        headers={"Authorization": f"Bearer {TOKEN}"},
        files={"bundle": ("article.zip", zf, "application/zip")},
        data={
            "title": "Meteor shower analysis",
            "slug": "meteor-shower-analysis",
            "summary": "Jupyter notebook on a meteor shower",
            "language": "en",
            "engine": "jupyter",
            "published_via": "jupyter",
        },
    )

response.raise_for_status()
print(response.json())
```

## ipywidgets / interactive content

`jupyter nbconvert --to html` keeps **static snapshots** of ipywidgets, not live widgets bound to a Python kernel. For full interactivity:

- **plotly** — works in the iframe out of the box
- **bokeh** — embed via `bokeh.io.output_file` before `nbconvert`
- **ipywidgets with a live kernel** — Astrozor can't host these (you'd need Voila / Binder / mybinder)

For scientific work, plotly + a static table is usually enough — and runs at full speed in the iframe.

## Troubleshooting

| Problem | Fix |
|---|---|
| `400 Archive must contain index.html at root` | Your ZIP has a top-level folder — zip the **contents** instead (`cd bundle && zip -r ../x.zip .`) |
| Charts not showing | Use `--embed-images` or zip the sibling `_files/` dir |
| `507 Storage quota exceeded` | ZIP exceeds quota (default 5 GB) — delete older articles |
| `401 Token rejected` | Create a new token in Settings |

## Try it with a sample

Grab the test `.ipynb` from [Sample articles](/samples/jupyter-notebook.ipynb), render it, and publish.
