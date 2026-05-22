---
title: "Publikování z RStudia"
section: "2. Publikování"
order: 40
icon: "Ⓡ"
---

# Publikování z RStudia

Pro R uživatele je Astrozor připravený **RStudio addin** ve formě CRAN-like R balíčku `astrozorpub`. Umí publikovat `.qmd` a `.Rmd` přímo z editoru — vyrenderuje, zazipuje a nahraje.

## 1) Instalace `astrozorpub`

R repository je hostnuté přímo touto instancí. Otevři R konzoli v RStudiu a spusť:

```r
install.packages("astrozorpub", repos = "<TENTO_HOST>/R")
```

(Konkrétní snippet s tvým hostem najdeš v Nastavení → R balíček.)

Po instalaci se objeví **Addins** menu v RStudio toolbar.

## 2) Vytvoření API tokenu

V Astrozoru:

1. **Nastavení → API tokeny → Vytvořit token**
2. Scope: `publish:articles`, popisek např. „RStudio"
3. Zkopíruj plaintext (`ast_pat_…`) — zobrazí se jen jednou

## 3) Nastavení v R

V R konzoli:

```r
# Pokud nepublikuješ na prod (default https://astrozor.cz):
astrozorpub::astrozor_set_base_url("http://astrozor.localhost")

# Vlož svůj token:
astrozorpub::astrozor_set_token("ast_pat_xxxxxxxxxxxx")

# Sanity check:
astrozorpub::astrozor_whoami()
# → list(user_email = "...", token_name = "...", scopes = c("publish:articles"))
```

Token + URL se uloží do `~/.Renviron` jako `ASTROZOR_TOKEN` a `ASTROZOR_BASE_URL`. Po `astrozor_set_*()` restartuj R session (**Session → Restart R**) — nové env vars chytnou nové sessions automaticky.

## 4) Publikování přes addin

1. Otevři `.qmd` nebo `.Rmd` v RStudiu
2. **Addins** menu → **Publish to Astrozor**
3. Zkontroluj předvyplněný title / slug / popis
4. Vyber téma vykreslení:
   - **Tmavé (Astrozor design)** — bootswatch `darkly` + slate-900 pozadí (splývá s Astrozorem)
   - **Světlé** — bootswatch `cosmo`
   - **Beze změny** — zachová tvůj `format: html: theme:` z YAML
5. **Publish**

Stejný slug podruhé = update existujícího článku (idempotentní).

## 5) Publikování z kódu

```r
# Render + bundle + upload v jednom kroku
astrozorpub::astrozor_publish(
  "report.qmd",
  title   = "Můj experiment",
  slug    = "muj-experiment",
  summary = "Krátký popis"
)

# Když už mám .html z dřívějšího renderu:
astrozorpub::astrozor_publish(
  "report.qmd",
  render = FALSE  # vezme existující report.html vedle .qmd
)

# Jen vytvořit bundle bez uploadu (debug):
zip_path <- astrozorpub::astrozor_bundle("output/report.html")
```

## Téma vykreslení

Astrozor je vždy tmavá aplikace. Default `theme = "dark"` vsadí na bootswatch `darkly` a force-uje:

- `backgroundcolor: "#0f172a"` (slate-900 — matches Astrozor)
- `fontcolor: "#e2e8f0"` (slate-200)
- `linkcolor: "#818cf8"` (indigo-400)

Override probíhá přes Quarto `--metadata-file` mechanismus — **mergeuje** s tvým YAML, ostatní nastavení (TOC, fig-cap, code-fold…) zůstávají zachována.

## Co se posílá na server

`POST /api/publish/quarto` multipart/form-data:

| Pole | Obsah |
|---|---|
| `bundle` | ZIP s `index.html` v rootu + asset adresářem (`*_files/`, `libs/`) |
| `title` | Název článku |
| `slug` | URL slug (volitelný — server odvodí z title pokud chybí) |
| `summary` | Krátký popis |
| `language` | `cs` / `en` |
| `engine` | `quarto` nebo `rmarkdown` (auto dle extension) |
| `published_via` | `rstudio` |

Hlavička: `Authorization: Bearer ast_pat_…`

## Omezení

- ZIP do 100 MB komprimované / 500 MB rozbalené
- Bundle musí mít `index.html` v rootu (R balíček ho tam automaticky stage-uje)
- Symlinky v ZIP odmítnuty (security)
- Quota čerpá z `Profile.storage_quota_bytes` (default 5 GB)
- **Shiny dokumenty** (`runtime: shiny`) addin **odmítne** — Astrozor publikuje pre-rendered HTML, Shiny apps potřebují běžící R server

## Diagnostika

| Chyba | Řešení |
|---|---|
| `401 Token rejected` | Token expirován/revoked — vytvoř nový a `astrozor_set_token()` |
| `400 Slug taken by another user` | Slug už používá jiný autor — zvol jiný |
| `507 Storage quota exceeded` | Smaž starší články nebo požádej admina o navýšení |
| `400 Archive must contain index.html at root` | Bug v `astrozor_bundle()` — zkontroluj strukturu výstupního adresáře |

## Vyzkoušej s ukázkou

Stáhni si testovací `.qmd` z [Ukázkové články](/samples/rstudio-quarto.qmd), otevři v RStudiu a publikuj přes addin.
