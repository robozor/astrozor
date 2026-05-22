---
title: "Publikování — přehled"
section: "2. Publikování"
order: 10
icon: "📰"
---

# Co všechno se dá publikovat na Astrozor

Astrozor neslouží jen ke statickým textům. Můžeš sem dostat **plnohodnotný interaktivní vědecký článek** se vším, co současné formáty umí.

## Co umíme zobrazit

- **Markdown** — texty, seznamy, tabulky, kód s podbarvením syntaxe, obrázky, vzorce v LaTeXu (přes MathJax).
- **Quarto** (`.qmd`) — Markdown + R/Python kódové bloky, které se vykreslí jako **interaktivní výstupy**: tabulky s tříděním, plotly grafy, leaflet mapy, MathJax rovnice, obsahový panel (TOC).
- **RMarkdown** (`.Rmd`) — totéž z prostředí R, kompatibilní s veškerou existující R-Markdown výbavou (kable, gt, ggplot, plotly, htmlwidgets).
- **Jupyter notebook** (`.ipynb`) — vyrenderovaný do HTML (např. `jupyter nbconvert`) zachovává interaktivní widgety, plotly grafy a markdown buňky.

Pre-rendered výstupy se zobrazují v **iframe** v rámci článku — JavaScript v nich běží naplno (plotly hover, zoom, MathJax DOM mutace).

## Jak se dostane článek do Astrozoru

Čtyři ekvivalentní cesty — vyber, co máš nejblíž.

| Cesta | Vhodné pro | Co je potřeba |
|---|---|---|
| **Astrozor in-app editor** | Krátké texty, poznámky, blogy | Jen prohlížeč |
| **VS Code extension** | Markdown nebo Quarto, kdo používá VS Code | VS Code + extension (návod uvnitř) |
| **RStudio addin** | R uživatelé, Quarto/RMarkdown s R kódem | RStudio + balíček `astrozorpub` |
| **Jupyter notebook** | Python / Julia / vědecký workflow | Jupyter + `jupyter nbconvert` |

Každá cesta vede na stejný backend — **`POST /api/v1/publish/articles`** (markdown) nebo **`POST /api/v1/publish/quarto`** (pre-rendered HTML bundle).

## Idempotence

Když publikuješ s **stejným slugem** (URL-friendly název) podruhé:

- **Markdown publish**: vytvoří se nový článek se sufixem `-2`, `-3` (zatím není idempotentní)
- **Quarto/HTML bundle publish**: aktualizuje existující článek v místě — žádné duplicity, zachová DOI a komentáře

To se hodí pro postupné iterace: napiš, vyrenderuj, publikuj, oprav, publikuj znovu — vše pod jednou URL.

## DOI a citace

Každý publikovaný článek dostane **DOI** přes Zenodo (v dev módu sandbox, v produkci ostrý Zenodo). Můžeš jím článek citovat ve vědecké práci.

## Licence

Default je **CC BY 4.0** — komukoli umožňuje sdílení a úpravy s uvedením autora. Můžeš v manifestu změnit (`license: "..."` ve frontmatteru nebo v dialogu addinu).

## Vyzkoušej

V sekci **Články** najdeš 4 ukázkové články — každý publikovaný jinou cestou. Stáhni si jejich zdrojový kód, otevři ve svém oblíbeném IDE, vyrenderuj a publikuj zpět — ověříš si celou toolchain.

Detailní návody:

- [Publikování z Astrozoru (in-app editor)](publish-astrozor-editor)
- [Publikování z VS Code](publish-vscode)
- [Publikování z RStudia](publish-rstudio)
- [Publikování z Jupyter](publish-jupyter)
- [Správa API tokenů](api-tokens)
