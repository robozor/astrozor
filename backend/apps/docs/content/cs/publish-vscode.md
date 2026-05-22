---
title: "Publikování z VS Code"
section: "2. Publikování"
order: 30
icon: "🅥"
---

# Publikování z VS Code

Astrozor má vlastní VS Code extension **Astrozor — Publish**. Umí publikovat:

- `.md` soubory (jako markdown článek)
- `.qmd` soubory (Quarto — extension je sám vyrenderuje a nahraje)
- Libovolnou složku s `index.html` (např. výstup Jupyter `nbconvert` nebo Hugo/Hexo)

Token uložený jednou v zabezpečeném Secret Storage; pak už jen klikáš.

## 1) Stažení a instalace

Stáhni si nejnovější `.vsix` z této instance Astrozoru:

- **Stable URL:** `<TENTO_HOST>/vscode-extension/astrozor-publish-latest.vsix`

Otevři terminál a spusť:

```powershell
code --install-extension "<cesta_kam_jsi_to_stáhl>\astrozor-publish-latest.vsix" --force
```

Nebo přes VS Code UI:

1. Otevři Extensions (`Ctrl+Shift+X`)
2. Klikni na **`…`** (tři tečky vpravo nahoře v panelu)
3. **Install from VSIX…** → vyber stažený soubor
4. Po instalaci spusť **`Developer: Reload Window`** z Command Palette (`Ctrl+Shift+P`)

Ověření: `Ctrl+Shift+P` → napiš **`astrozor`** → uvidíš 7 příkazů.

## 2) Vytvoření API tokenu

V Astrozoru:

1. Přihlaš se
2. **Nastavení → API tokeny → Vytvořit token**
3. Scope: `publish:articles`, popisek např. „VS Code dev"
4. **Zkopíruj** plaintext token (`ast_pat_…`) — zobrazí se jen jednou

## 3) Nastavení v Code

Command Palette (`Ctrl+Shift+P`):

1. **`Astrozor: Set base URL`** → zadej URL této instance (např. `http://astrozor.localhost` nebo `https://astrozor.cz`)
2. **`Astrozor: Set API token`** → vlož `ast_pat_…`
3. **`Astrozor: Check identity`** → notifikace s tvým emailem = vše OK

Token se ukládá do **VS Code Secret Storage** — na Windows DPAPI, na macOS Keychain, na Linuxu libsecret. Není v `settings.json`, nedá se omylem commit-nout.

## 4) Publikování

### Markdown (`.md`)

Otevři `.md` soubor. Pak buď:

- `Ctrl+Shift+P` → **`Astrozor: Publish Markdown article`**
- Nebo pravý klik na soubor v Explorer panelu

Dialog se zeptá na title (default z YAML), slug, summary, jazyk. Po Enter čtyřikrát se článek publikuje.

### Quarto (`.qmd`)

**Předpoklad:** Quarto CLI nainstalovaný (https://quarto.org/docs/get-started/). Pokud Code hlásí *Could not run "quarto"*, nastav plnou cestu v Settings → `astrozor.quartoExecutable`:

```
C:\Program Files\Quarto\bin\quarto.exe
```

(Pokud máš RStudio, najdeš bundled Quarto na `C:\Program Files\RStudio\resources\app\bin\quarto\bin\quarto.exe`.)

Pak otevři `.qmd` a spusť **`Astrozor: Publish Quarto / RMarkdown document`**.

Extension:
1. Spustí `quarto render <file.qmd>` (uvidíš stdout/stderr v Output → channel **Astrozor**)
2. Zabalí vygenerované HTML + asset složku do ZIP
3. POST na `/api/v1/publish/quarto`
4. Notifikace s URL — klikni **Open in browser**

### Pre-rendered HTML složka

Pravým klikem na složku obsahující `index.html` → **`Astrozor: Publish folder`**. Vhodné pro Jupyter `nbconvert` výstupy, Hugo single page, atd.

## 5) Idempotence

Publikuj `.qmd` se stejným slugem podruhé → server **aktualizuje** existující článek, zachová DOI a komentáře. Můžeš tak iterovat bez vzniku duplicit.

## Co se pošle na server

| Endpoint | Pole |
|---|---|
| `POST /publish/articles` | `title`, `summary`, `language`, `engine=markdown`, `license`, `content_md`, `tags[]` |
| `POST /publish/quarto` (multipart) | `bundle` (ZIP), `title`, `slug`, `summary`, `language`, `engine`, `license`, `published_via=vscode` |

Hlavička: `Authorization: Bearer ast_pat_…`

## Diagnostika

| Chyba | Řešení |
|---|---|
| `401 Token rejected` | Vytvoř nový token → **`Astrozor: Set API token`** |
| `403 Token missing 'publish:articles' scope` | Token byl vytvořený bez správného scope |
| `400 Slug taken by another user` | Slug už používá jiný autor — zvol jiný |
| `507 Storage quota exceeded` | Smaž starší články nebo požádej admina o navýšení |
| `Could not run "quarto"` | Nastav `astrozor.quartoExecutable` v Settings |

Output panel (`Ctrl+Shift+U` → channel **Astrozor**) obsahuje plnou diagnostiku včetně Quarto stdout/stderr.

## Settings

| Klíč | Default | Co dělá |
|---|---|---|
| `astrozor.baseUrl` | `https://astrozor.cz` | URL instance |
| `astrozor.defaultLanguage` | `cs` | Default language v dialogu |
| `astrozor.defaultLicense` | `CC BY 4.0` | Licence |
| `astrozor.quartoExecutable` | `quarto` | Cesta k Quarto CLI |
| `astrozor.confirmBeforePublish` | `true` | Zobrazit dialog s metadaty (vypni pro one-click publish) |

## Vyzkoušej s ukázkou

Stáhni si testovací `.qmd` z [Ukázkové články](/samples/vscode-quarto.qmd), otevři ve VS Code a publikuj — pokud uvidíš článek na Astrozoru s tabulkou a kódem, toolchain funguje.
