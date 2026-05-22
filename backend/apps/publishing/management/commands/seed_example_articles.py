"""Seed 4 example articles demonstrating each publishing path.

Articles created (idempotent on slug):

  1. Astrozor in-app markdown editor   (engine=markdown)
  2. Quarto from RStudio addin         (engine=markdown — source linked, render is user's job)
  3. Quarto from VS Code extension     (engine=markdown — same)
  4. Jupyter notebook + nbconvert      (engine=markdown — same)

Articles 2–4 are presented as **markdown stubs** that explain the path
and link to the downloadable source in ``/samples/``. Users can grab the
source, render it locally, and publish back — they'll then see articles
2–4 replaced by their own rendered Quarto/Jupyter HTML bundle (idempotent
slug).

Usage:
    python manage.py seed_example_articles
    python manage.py seed_example_articles --replace
    python manage.py seed_example_articles --author you@example.com
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.publishing.models import Article
from apps.publishing.rendering import render_markdown

User = get_user_model()


EXAMPLES = [
    {
        "slug": "ukazka-markdown-z-astrozoru",
        "title": "Ukázka: Markdown článek psaný přímo v Astrozoru",
        "summary": (
            "Demonstruje markdown features v in-app editoru — tabulky, "
            "kód, MathJax, citace. Zdroj ke stažení."
        ),
        "engine": Article.Engine.MARKDOWN,
        "source_filename": "astrozor-markdown.md",
        "body_template": """
# Ukázka: Markdown článek psaný přímo v Astrozoru

Tento článek byl publikován **přímo z Astrozor in-app markdown editoru**. Slouží jako ukázka, co všechno markdown s GFM rozšířeními umí — když chceš jen napsat text, nepotřebuješ vůbec nic kromě prohlížeče.

[**📥 Stáhnout zdroj** (`astrozor-markdown.md`)](/samples/astrozor-markdown.md) · [Návod „Publikování v Astrozoru"](/?from=docs&d=publish-astrozor-editor)

## Co je v ukázce

- Texty, **bold**, _italic_, `inline code`, ~~strikethrough~~
- Listy číslované, odrážkové, task lists s `[x]` / `[ ]`
- Bloky kódu Python / R s vyznačením syntaxe
- Tabulka s hvězdnými magnitudami
- Citace (blockquote)
- MathJax — inline $m_1 - m_2 = -2.5 \\log_{10}(F_1 / F_2)$ a display

## Reprodukuj sám

1. Stáhni si výše zdrojový `.md`
2. V Astrozoru otevři **Články → + Nový článek**
3. Vlož obsah do markdown editoru
4. **Publikovat**

Astrozor projde markdown přes `markdown-it` + `bleach` sanitization a uloží jako tvůj vlastní článek. Tag `astrozor` v listingu označuje origin.

## Co dál

- Pro **interaktivní grafy** se podívej na [Quarto ukázku](ukazka-quarto-z-rstudia) nebo [Jupyter ukázku](ukazka-jupyter-notebook)
- Detailní návod k publikování přímo v Astrozoru: [docs](/?from=docs&d=publish-astrozor-editor)
""",
    },
    {
        "slug": "ukazka-quarto-z-rstudia",
        "title": "Ukázka: Quarto článek publikovaný z RStudia",
        "summary": (
            "Quarto dokument s R kódem, plotly grafem a tabulkou. "
            "Publikováno přes RStudio addin astrozorpub."
        ),
        "engine": Article.Engine.MARKDOWN,
        "source_filename": "rstudio-quarto.qmd",
        "body_template": """
# Ukázka: Quarto článek publikovaný z RStudia

Tento `.qmd` článek byl napsaný v **RStudiu** s R kódem, plotly grafem a tabulkou. Publikoval ho **`astrozorpub` addin** přes `quarto render` + ZIP + POST `/publish/quarto`.

[**📥 Stáhnout zdroj** (`rstudio-quarto.qmd`)](/samples/rstudio-quarto.qmd) · [Návod „Publikování z RStudia"](/?from=docs&d=publish-rstudio)

> **Poznámka:** Tato seeded verze je **markdown stub** — popisuje, co Quarto článek obsahuje, ale neumí v iframe-u zobrazit živé `ggplotly()` grafy. Pro plnou interaktivní verzi:
>
> 1. Stáhni si zdrojový `.qmd` výše
> 2. Otevři v RStudiu
> 3. Vlož svůj API token (Settings → API tokeny)
> 4. **Addins → Publish to Astrozor**
> 5. Použij stejný slug `ukazka-quarto-z-rstudia` → tento článek se přepíše tvým interaktivním renderem

## Co Quarto z RStudia umí

- **R kódové bloky** — ggplot, dplyr, plotly, leaflet, DT, gt
- **Code-fold** — kód se dá rozbalit / sbalit klikem na šipku
- **TOC v levém panelu** — auto-generovaný obsah
- **Dark theme** — bootswatch `darkly` + slate-900 pozadí
- **MathJax** — LaTeX vzorce
- **htmlwidgets** — interaktivní R widgets

## Příklad R kódu (display only — bez execute)

```r
library(dplyr)
library(plotly)

# HR-like diagram
stars <- tibble(
  name = c("Sirius A", "Vega", "Polaris", "Betelgeuse"),
  magnitude = c(-1.46, 0.03, 1.98, 0.42),
  distance_pc = c(2.64, 7.68, 132, 168)
)

p <- ggplot(stars, aes(x = distance_pc, y = magnitude, label = name)) +
  geom_point(size = 4) +
  scale_x_log10() + scale_y_reverse()

ggplotly(p, tooltip = c("label", "magnitude"))
```

## Po publikaci přes addin

Tento `.qmd` zdroj po `quarto render` + addin publish:

- iframe v článku načte vyrenderované HTML
- ggplotly graf je **plně interaktivní** (hover, zoom, pan)
- Tabulka vykreslena `knitr::kable()` s formátováním
- Auto-resize iframe podle obsahu

## Co dál

- [Publikování z RStudia](/?from=docs&d=publish-rstudio)
- [Markdown ukázka](ukazka-markdown-z-astrozoru) pro lehčí texty
- [Jupyter ukázka](ukazka-jupyter-notebook) pro Python workflow
""",
    },
    {
        "slug": "ukazka-quarto-z-vs-code",
        "title": "Ukázka: Quarto článek publikovaný z VS Code",
        "summary": (
            "Quarto dokument bez R — Python kódové bloky, MathJax, tabulka. "
            "Publikováno přes VS Code extension."
        ),
        "engine": Article.Engine.MARKDOWN,
        "source_filename": "vscode-quarto.qmd",
        "body_template": """
# Ukázka: Quarto článek publikovaný z VS Code

Tento `.qmd` článek byl napsaný ve **VS Code** s extension **Astrozor — Publish**. Quarto se vyrenderoval lokálně přes `quarto render`, extension zabalil HTML do ZIP a nahrál.

[**📥 Stáhnout zdroj** (`vscode-quarto.qmd`)](/samples/vscode-quarto.qmd) · [Návod „Publikování z VS Code"](/?from=docs&d=publish-vscode)

> **Poznámka:** Tato seeded verze je **markdown stub**. Pro plnou interaktivní verzi:
>
> 1. Stáhni si VS Code extension `.vsix` ze `/vscode-extension/astrozor-publish-latest.vsix`
> 2. `code --install-extension <cesta>.vsix --force`
> 3. Stáhni si zdroj výše a otevři ve VS Code
> 4. `Astrozor: Publish Quarto / RMarkdown document`
> 5. Použij stejný slug `ukazka-quarto-z-vs-code` → tento článek se přepíše tvým interaktivním renderem

## Co Quarto z VS Code umí (bez R)

- **Python kódové bloky** (s execute pomocí jupyter engine)
- **Plotly express grafy** — interaktivní v iframe
- **MathJax** rovnice
- **Dark theme** — bootswatch `darkly`
- **Bez R requirements** — vhodné pro Python-only uživatele

## Příklad Python kódu

```python
import math

def magnituda(flux_ratio: float) -> float:
    return -2.5 * math.log10(flux_ratio)

print(magnituda(100))  # -5.0
```

## Co dál

- [Publikování z VS Code](/?from=docs&d=publish-vscode) (s instalačním návodem)
- [Markdown ukázka](ukazka-markdown-z-astrozoru) pro lehčí texty
- [RStudio Quarto ukázka](ukazka-quarto-z-rstudia) pro R workflow
""",
    },
    {
        "slug": "ukazka-jupyter-notebook",
        "title": "Ukázka: Jupyter notebook publikovaný přes nbconvert",
        "summary": (
            "Python notebook s matplotlib grafem a markdown texty. "
            "Vyrenderováno pomocí jupyter nbconvert."
        ),
        "engine": Article.Engine.MARKDOWN,
        "source_filename": "jupyter-notebook.ipynb",
        "body_template": """
# Ukázka: Jupyter notebook publikovaný přes nbconvert

Tento `.ipynb` notebook byl napsaný v **Jupyteru** (nebo VS Code Jupyter kernel-u) s Python kódem, matplotlib grafem a markdown texty. Po `jupyter nbconvert --to html --embed-images` byl publikován jako HTML bundle.

[**📥 Stáhnout zdroj** (`jupyter-notebook.ipynb`)](/samples/jupyter-notebook.ipynb) · [Návod „Publikování z Jupyter"](/?from=docs&d=publish-jupyter)

> **Poznámka:** Tato seeded verze je **markdown stub**. Pro plnou interaktivní verzi:
>
> 1. Stáhni si zdrojový `.ipynb` výše
> 2. Spusť všechny buňky (`Cell → Run All`)
> 3. Konvertuj: `jupyter nbconvert --to html --embed-images jupyter-notebook.ipynb`
> 4. Připrav složku: `mkdir bundle && cp jupyter-notebook.html bundle/index.html`
> 5. Pravým klikem na složku ve VS Code → `Astrozor: Publish folder`
> 6. Použij stejný slug `ukazka-jupyter-notebook` → tento článek se přepíše tvým interaktivním renderem

## Co Jupyter umí na Astrozoru

- **Python kódové bloky** s real execute output
- **Matplotlib** (PNG snapshot) i **Plotly** (interaktivní)
- **Pandas tabulky** vyrenderované jako HTML
- **Markdown buňky** s MathJax
- **Embedded images** přes `--embed-images` (jeden HTML soubor, žádné sourozenecké assety)

## Příklad Python kódu

```python
import numpy as np
import matplotlib.pyplot as plt

plt.style.use('dark_background')
fig, ax = plt.subplots(figsize=(8, 5))

# HR-like diagram
distances = [2.64, 7.68, 132, 168]
magnitudes = [-1.46, 0.03, 1.98, 0.42]
ax.scatter(distances, magnitudes, s=120, c='#818cf8')
ax.set_xscale('log')
ax.invert_yaxis()
plt.show()
```

## Pogsonův vzorec

$$
m_1 - m_2 = -2.5 \\log_{10}\\left(\\frac{F_1}{F_2}\\right)
$$

## Co dál

- [Publikování z Jupyter](/?from=docs&d=publish-jupyter) — detailní návod
- [Quarto z VS Code](ukazka-quarto-z-vs-code) — pro lepší interaktivitu (Plotly out-of-box)
- [Markdown ukázka](ukazka-markdown-z-astrozoru) pro lehčí texty
""",
    },
]


class Command(BaseCommand):
    help = "Seed 4 example articles (one per publishing path)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Re-create articles even if they already exist.",
        )
        parser.add_argument(
            "--author",
            default=None,
            help="Email of the author user (default: first staff user).",
        )

    def handle(self, *args, **opts):
        author = self._pick_author(opts.get("author"))
        replace = opts.get("replace", False)

        created = 0
        updated = 0
        skipped = 0

        for spec in EXAMPLES:
            slug = spec["slug"]
            existing = Article.objects.filter(slug=slug).first()
            if existing and not replace:
                skipped += 1
                self.stdout.write(f"  ⏭  {slug} — already exists, skip")
                continue

            body = spec["body_template"].strip()
            html = render_markdown(body)

            if existing and replace:
                existing.title = spec["title"]
                existing.summary = spec["summary"][:400]
                existing.content_md = body
                existing.content_html = html
                existing.engine = spec["engine"]
                existing.language = "cs"
                existing.status = Article.Status.PUBLISHED
                existing.author = author
                existing.published_at = existing.published_at or timezone.now()
                existing.save()
                updated += 1
                self.stdout.write(self.style.SUCCESS(f"  ↻  {slug} — replaced"))
            else:
                Article.objects.create(
                    slug=slug,
                    title=spec["title"],
                    summary=spec["summary"][:400],
                    content_md=body,
                    content_html=html,
                    engine=spec["engine"],
                    language="cs",
                    status=Article.Status.PUBLISHED,
                    author=author,
                    license="CC BY 4.0",
                    published_at=timezone.now(),
                )
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  +  {slug} — created"))

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone: {created} created, {updated} replaced, {skipped} skipped."
            )
        )

    def _pick_author(self, email: str | None):
        if email:
            try:
                return User.objects.get(email__iexact=email)
            except User.DoesNotExist as exc:
                raise SystemExit(f"No user with email {email!r}") from exc
        staff = User.objects.filter(is_staff=True).order_by("date_joined").first()
        if staff:
            return staff
        # Last resort: first user in the system.
        first = User.objects.order_by("date_joined").first()
        if first:
            return first
        raise SystemExit(
            "No users exist yet. Create one in admin or via signup, then re-run."
        )
