# astrozorpub — RStudio addin pro Astrozor

Publikuje vyrenderované **Quarto** nebo **RMarkdown** dokumenty (HTML +
assety) do Astrozor instance přímo z RStudia. Renderuje, zazipuje a
posílá přes `/api/publish/quarto`.

## Lokální instalace (testování)

```r
# 1. Z Astrozor monorepo subdirektory
remotes::install_local(
  "C:/Users/jsz/Documents/GitHub/Astrozor/rstudio-addin",
  dependencies = TRUE
)

# 2. Nasměrovat na lokální instanci místo produkční:
astrozorpub::astrozor_set_base_url("http://localhost")

# 3. Vytvořit API token v Astrozor (Settings → API tokeny), zkopírovat
#    a vložit:
astrozorpub::astrozor_set_token("ast_pat_xxxxxxxxxxxx")

# 4. Sanity check
astrozorpub::astrozor_whoami()
# → list(user_email = "...", token_name = "...", scopes = c("publish:articles"))
```

Po `astrozor_set_*()` restartuj R session (RStudio menu **Session →
Restart R**) — nové env vars se aplikují automaticky pro nové sessions.

## Použití přes addin (GUI)

1. Otevři `.qmd` nebo `.Rmd` v RStudiu
2. **Addins** menu (toolbar) → **Publish to Astrozor**
3. Zkontroluj předvyplněný title / slug / popis
4. **Publish**

Stejný slug = update existujícího článku (idempotentní).

## Použití z kódu

```r
# Render + bundle + upload v jednom kroku (default: tmavé téma)
astrozorpub::astrozor_publish(
  "report.qmd",
  title   = "Můj experiment",
  slug    = "muj-experiment",
  summary = "Krátký popis"
)

# Explicitně světlé téma
astrozorpub::astrozor_publish("report.qmd", theme = "light")

# Beze změny — použít co máš v YAML frontmatteru
astrozorpub::astrozor_publish("report.qmd", theme = "none")

# Když už mám .html z dřívějšího renderu:
astrozorpub::astrozor_publish(
  "report.qmd",
  render = FALSE  # vezme existující report.html vedle .qmd
)

# Jen vytvořit bundle bez uploadu (debug):
zip_path <- astrozorpub::astrozor_bundle("output/report.html")
# → /tmp/.../astrozor_bundle_xxxx.zip
unzip(zip_path, list = TRUE)
```

## Téma vykreslení

Astrozor je tmavá aplikace, takže přibalený renderer defaultně vsadí
**bootswatch darkly** + barevnou paletu kompatibilní se zbytkem UI
(`#0f172a` slate-900 pozadí, `#818cf8` indigo-400 odkazy). Volby:

| `theme` | Bootswatch | Pozadí | Pro koho |
|---|---|---|---|
| `"dark"` (default) | darkly | slate-900 | Astrozor články — splynou s designem |
| `"light"` | cosmo | bílé | Tisk, export, kontrastní článek |
| `"none"` | — | dle YAML | Zachová tvůj `format: html: theme:` z frontmatteru |

Override probíhá přes Quarto `--metadata-file` mechanismus — **mergeuje
se** s tvým YAML, takže ostatní nastavení (TOC, fig-cap, code-fold…)
zůstávají zachována. Pro `.Rmd` se používá `output_options = list(theme = ...)`
v `rmarkdown::render`.

## Demo dokument

V `inst/examples/demo.qmd` najdeš ukázkový soubor s plotly interaktivním
grafem, matematikou (Pogsonův vzorec) a tabulkou.

```r
demo_path <- system.file("examples/demo.qmd", package = "astrozorpub")
astrozorpub::astrozor_publish(demo_path)
```

Po publikaci otevři článek v Astrozor — graf by měl být plně interaktivní
(hover, zoom). Pokud ano, celá pipeline funguje.

## Konfigurace přes `.Renviron`

Funkce `astrozor_set_token()` / `astrozor_set_base_url()` zapisují do
`~/.Renviron`. Můžeš to editovat i ručně:

```
ASTROZOR_BASE_URL=http://localhost
ASTROZOR_TOKEN=ast_pat_xxxxxxxxxxxxxx
```

## Co addin posílá

`POST /api/publish/quarto` multipart/form-data:

| Field | Obsah |
|---|---|
| `bundle` | ZIP s `index.html` v rootu + asset adresářem (`*_files/`, `libs/`) |
| `title` | Název článku |
| `slug` | URL slug (volitelný — server odvodí z title pokud chybí) |
| `summary` | Krátký popis |
| `language` | `cs` / `en` |
| `engine` | `quarto` nebo `rmarkdown` (auto dle extension) |
| `published_via` | `rstudio` |

Auth: `Authorization: Bearer ast_pat_…`

## Omezení

- ZIP do 100 MB komprimované / 500 MB rozbalené
- Bundle musí mít `index.html` v rootu (R balíček ho tam automaticky
  stage-uje)
- Symlinky v ZIP odmítnuty (security)
- Quota čerpá z `Profile.storage_quota_bytes` (default 5 GB)

## Když něco selže

| Chyba | Řešení |
|---|---|
| `401 Token rejected` | Token expirován/revoked — vytvoř nový v Settings |
| `400 Slug taken by another user` | Slug už používá jiný autor — zvol jiný |
| `507 Storage quota exceeded` | Smaž starší články nebo požádej admina o zvýšení kvóty |
| `400 Archive must contain index.html at root` | Bug v `astrozor_bundle()` — pošli issue se strukturou tvého výstupního adresáře |

## Vývoj

```r
# Otestovat funkce bez instalace
devtools::load_all("rstudio-addin")
astrozorpub::astrozor_whoami()
```
