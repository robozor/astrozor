# Astrozor — VS Code extension

Publikuje **Markdown**, **Quarto** a **pre-rendered HTML** přímo z VS Code do
Astrozor instance. Stejný backend (`/api/v1/publish/*`) jako RStudio addin
[`astrozorpub`](../rstudio-addin) — token mineš jen jednou, používej z obou.

## Co umí

| Příkaz | Pro | Endpoint |
|---|---|---|
| **Astrozor: Publish Markdown article** | aktivní `.md` soubor | `POST /publish/articles` (server vyrenderuje markdown) |
| **Astrozor: Publish Quarto / RMarkdown** | aktivní `.qmd` | `quarto render` → ZIP → `POST /publish/quarto` |
| **Astrozor: Publish folder** | složka s `index.html` | ZIP → `POST /publish/quarto` |
| **Astrozor: Set API token** | jednorázové nastavení | ukládá do VS Code Secret Storage (šifrované) |
| **Astrozor: Set base URL** | switch prod ↔ dev | nastavení `astrozor.baseUrl` |
| **Astrozor: Check identity (whoami)** | sanity-check tokenu | `GET /publish/whoami` |

Idempotentní: stejný **slug** = update existujícího článku.

## Instalace (z monorepa, testovací)

```bash
cd vscode-extension
npm install
npm run build
npx vsce package
# → vznikne astrozor-publish-0.1.0.vsix
```

Pak ve VS Code:
- **Extensions** panel (⇧⌘X / Ctrl+Shift+X) → menu **`…`** → **Install from VSIX…** → zvol `.vsix`

## První spuštění

1. V Astrozor → **Settings → API tokeny** vytvoř token se scope `publish:articles`.
2. V Command Palette (⌘⇧P / Ctrl+Shift+P) spusť **Astrozor: Set API token**, vlož `ast_…`.
3. Pokud nepublikuješ na prod, spusť **Astrozor: Set base URL** a nastav `http://astrozor.localhost`.
4. **Astrozor: Check identity** ověří, že token funguje.

Token se ukládá do **VS Code Secret Storage** (na Windows přes DPAPI, na macOS přes Keychain, na Linuxu přes libsecret). V `settings.json` nikdy nevidíš plaintext.

## Publikování

**Z editor toolbar:** otevři `.md` nebo `.qmd` → klikni **Astrozor: Publish…** v záhlaví editoru.

**Z explorer kontextového menu:** klik pravým na `.md` / `.qmd` soubor nebo na složku s `index.html` → **Astrozor: Publish…**.

**Z Command Palette:** `Astrozor: Publish Markdown article` / `… Quarto` / `… folder`.

Před uploadem se zeptá na **title** (default: z YAML frontmatteru nebo H1), **slug** (default: ze stem souboru), **summary** a **language**. Pro one-click publish vypni `astrozor.confirmBeforePublish`.

### Markdown

```markdown
---
title: "Můj experiment"
language: cs
summary: "Krátký popis pro listing."
---

# Můj experiment

Tělo článku v markdownu. **Bold**, _italic_, `code`, listy, odkazy, vše.
```

Server (`apps.publishing.rendering.render_markdown`) projde markdown přes `markdown-it` + `bleach` sanitization. Frontmatter se před uploadem odstraní.

### Quarto

```yaml
---
title: "Analýza meteorického roje"
format: html
---
```

Extension spustí `quarto render <file.qmd>` (pomocí binárky z `astrozor.quartoExecutable`, default `quarto` z PATH). Po úspěšném renderu se vyzobne `<stem>.html` + sourozenecké asset složky (`<stem>_files/`, `libs/`, `site_libs/`, `figures/`) a vše se zabalí do ZIP s `index.html` v rootu. Server bundle rozbalí pod `/media/quarto/<user_id>/<slug>/` a stránku načítá v iframe.

> RMarkdown (`.Rmd`) se v této extension **nerenderuje** — vyrenderuj v RStudiu nebo z Rcka a pak použij **Publish folder** na výstupní složku.

### Pre-rendered složka

Pravým kliknutím na libovolnou složku obsahující `index.html` → **Astrozor: Publish folder**. Vhodné pro:
- HTML exporty z Jupyter `nbconvert`
- Hugo / Hexo / 11ty výstupy single-page článků
- Cokoli, co už máš jako static HTML

## Nastavení

| Klíč | Default | Význam |
|---|---|---|
| `astrozor.baseUrl` | `https://astrozor.cz` | URL instance (bez trailing slash) |
| `astrozor.defaultLanguage` | `cs` | Jazyk článku — `cs` / `en` |
| `astrozor.defaultLicense` | `CC BY 4.0` | Licence posílaná v manifestu |
| `astrozor.quartoExecutable` | `quarto` | Cesta k Quarto CLI |
| `astrozor.confirmBeforePublish` | `true` | Ukázat dialog s metadaty před uploadem |

Token **není** v `settings.json` — žije v Secret Storage. Vyčistit ho jde příkazem **Astrozor: Clear API token**.

## Omezení

- ZIP do 100 MB komprimované / 500 MB rozbalené (server limit)
- Bundle musí mít `index.html` v rootu (extension to vyrobí stage-směrem)
- Symlinky v ZIP server odmítá (security)
- Storage čerpá z `Profile.storage_quota_bytes` (default 5 GB)

## Když něco selže

| Chyba | Co s tím |
|---|---|
| `401 Token rejected` | Token expirován / revoked — vytvoř nový a spusť **Set API token** |
| `403 Token missing 'publish:articles' scope` | Token vytvořený bez správného scope — vytvoř nový se zaškrtnutým `publish:articles` |
| `400 Slug taken by another user` | Slug už používá jiný autor — zvol jiný |
| `507 Storage quota exceeded` | Smaž starší články nebo požádej admina o zvýšení kvóty |
| `Could not run "quarto"` | Nainstaluj [Quarto CLI](https://quarto.org/docs/get-started/) nebo nastav `astrozor.quartoExecutable` na plnou cestu |

Detaily uvidíš v **Output** panelu → channel **Astrozor**.

## Vývoj

```bash
cd vscode-extension
npm install
npm run watch        # tsc -watch
# F5 v editoru → Extension Development Host
```

Source mapy se generují, takže breakpointy v `src/*.ts` fungují.
