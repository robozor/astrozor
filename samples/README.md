# Ukázkové publikační zdroje

Tato složka obsahuje **zdrojové soubory ukázkových článků** určené ke stažení uživateli. Astrozor je servíruje přes Caddy na `<HOST>/samples/*`.

| Soubor | Pro koho | Cesta publikace |
|---|---|---|
| `astrozor-markdown.md` | In-app editor uživatelé | `Články → + Nový článek` |
| `vscode-quarto.qmd` | VS Code uživatelé | `Astrozor: Publish Quarto / RMarkdown` |
| `rstudio-quarto.qmd` | R uživatelé | RStudio addin `astrozor_publish()` |
| `jupyter-notebook.ipynb` | Jupyter / Python uživatelé | `nbconvert` + `Astrozor: Publish folder` |

## Vlastnosti

- Každý sample je v **češtině** s `lang: cs` (Quarto) / `language: cs` (markdown)
- Demonstrují podporu **MathJax**, code blocks, tabulek, plotly (Quarto), matplotlib (Jupyter)
- Idempotentní `slug` — opětovná publikace přepíše bundle v místě

## Seed example articles

Management command `seed_example_articles` v `backend/apps/publishing/management/commands/`
vyrenderuje a publikuje tyto soubory automaticky při prvním spuštění Astrozoru. Tak nová instance dostane ukázkové články k prozkoumání.

Manuálně:

```bash
docker compose exec api python manage.py seed_example_articles
```
