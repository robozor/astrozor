---
title: "Publikování z Jupyter notebook"
section: "2. Publikování"
order: 50
icon: "📓"
---

# Publikování z Jupyter notebook

Pro Jupyter notebook neexistuje vlastní Astrozor addin (zatím) — Jupyter ekosystém je rozmanitý a `jupyter nbconvert` umí všechno potřebné nativně.

## Postup ve 3 krocích

1. Spusť všechny buňky v notebooku (`Cell → Run All`)
2. Konvertuj na HTML: `jupyter nbconvert --to html --embed-images analyza.ipynb`
3. Publikuj HTML složku přes VS Code extension nebo `curl`

## 1) Render notebooku

V terminálu, kde máš `.ipynb`:

```bash
# Statické HTML — interaktivní plotly grafy + ipywidgets se zachovají
jupyter nbconvert --to html analyza.ipynb

# Lepší pro Astrozor: embed images do HTML (nepotřebujeme sibling asset dir)
jupyter nbconvert --to html --embed-images analyza.ipynb

# Pro velké notebooky s mnoha grafy je lepší ponechat externí assety:
jupyter nbconvert --to html analyza.ipynb --output-dir ./out
```

Výstup je `analyza.html` (nebo `out/analyza.html`). Pro Astrozor potřebujeme **složku obsahující `index.html`**, takže:

```bash
mkdir -p bundle
cp analyza.html bundle/index.html
# Pokud máš sibling _files/ adresář (figures, scripts), zkopíruj ho taky:
cp -r analyza_files bundle/
```

## 2) Vytvoření API tokenu

V Astrozoru:

1. **Nastavení → API tokeny → Vytvořit token**
2. Scope: `publish:articles`
3. Zkopíruj `ast_pat_…`

## 3) Publikování

### Cesta A — VS Code (nejjednodušší)

Otevři `bundle/` složku ve VS Code, pravým klikem na ni → **`Astrozor: Publish folder`**. Detaily v [Publikování z VS Code](publish-vscode).

### Cesta B — curl

```bash
TOKEN="ast_pat_xxxxxxxxxxxx"
HOST="http://astrozor.localhost"

# Zip s index.html v rootu
cd bundle
zip -r ../article.zip .
cd ..

curl -X POST "$HOST/api/v1/publish/quarto" \
  -H "Authorization: Bearer $TOKEN" \
  -F "bundle=@article.zip" \
  -F "title=Analýza meteorického roje" \
  -F "slug=meteoricky-roj-analyza" \
  -F "summary=Jupyter notebook s analýzou meteorického roje" \
  -F "language=cs" \
  -F "engine=jupyter" \
  -F "published_via=jupyter"
```

Odpověď:

```json
{
  "article_slug": "meteoricky-roj-analyza",
  "article_id": "...",
  "status": "published",
  "url": "/clanky/meteoricky-roj-analyza",
  "asset_url": "/media/quarto/<user>/<slug>/index.html"
}
```

### Cesta C — Python skript

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
            "title": "Analýza meteorického roje",
            "slug": "meteoricky-roj-analyza",
            "summary": "Jupyter notebook s analýzou meteorického roje",
            "language": "cs",
            "engine": "jupyter",
            "published_via": "jupyter",
        },
    )

response.raise_for_status()
print(response.json())
```

## ipywidgets / interaktivní obsah

`jupyter nbconvert --to html` zachová **statické snímky** ipywidgets, ne aktivní widgety napojené na Python kernel. Pro plně interaktivní obsah:

- **plotly** — funguje v iframe out-of-the-box
- **bokeh** — embed přes `bokeh.io.output_file` před `nbconvert`
- **ipywidgets s aktivním kernelem** — to Astrozor neumí (potřebovalo by Voila / Binder / mybinder)

Pro vědecké výpočty obvykle stačí plotly + statická tabulka — to běží v iframe naplno.

## Diagnostika

| Problém | Řešení |
|---|---|
| `400 Archive must contain index.html at root` | ZIP má top-level složku — zazipuj **obsah** složky, ne ji samotnou (`cd bundle && zip -r ../x.zip .`) |
| Grafy nezobrazeny | Použij `--embed-images` nebo zazipuj sibling `_files/` dir |
| `507 Storage quota exceeded` | ZIP je nad kvótou (default 5 GB) — smaž starší články |
| `401 Token rejected` | Vytvoř nový token v Settings |

## Vyzkoušej s ukázkou

Stáhni si testovací `.ipynb` z [Ukázkové články](/samples/jupyter-notebook.ipynb), vyrenderuj a publikuj.
