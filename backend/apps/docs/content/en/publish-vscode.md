---
title: "Publishing from VS Code"
section: "2. Publishing"
order: 30
icon: "🅥"
---

# Publishing from VS Code

Astrozor ships a VS Code extension **Astrozor — Publish**. It can publish:

- `.md` files (as a markdown article)
- `.qmd` files (Quarto — the extension renders them locally and uploads)
- Any folder containing `index.html` (e.g. Jupyter `nbconvert` output or Hugo/Hexo build)

Set the token once into Secret Storage; after that, just click.

## 1) Download and install

Grab the latest `.vsix` from this Astrozor instance:

- **Stable URL:** `<THIS_HOST>/vscode-extension/astrozor-publish-latest.vsix`

In a terminal:

```powershell
code --install-extension "<download_path>\astrozor-publish-latest.vsix" --force
```

Or through VS Code UI:

1. Open Extensions (`Ctrl+Shift+X`)
2. Click **`…`** (three dots, top-right of the panel)
3. **Install from VSIX…** → pick the file
4. After install: Command Palette (`Ctrl+Shift+P`) → **`Developer: Reload Window`**

Verify: `Ctrl+Shift+P` → type **`astrozor`** → 7 commands appear.

## 2) Create an API token

In Astrozor:

1. Sign in
2. **Settings → API tokens → Create token**
3. Scope: `publish:articles`, label e.g. "VS Code dev"
4. **Copy** the plaintext token (`ast_pat_…`) — shown only once

## 3) Configure VS Code

Command Palette (`Ctrl+Shift+P`):

1. **`Astrozor: Set base URL`** → enter the URL of this instance (e.g. `http://astrozor.localhost` or `https://astrozor.cz`)
2. **`Astrozor: Set API token`** → paste `ast_pat_…`
3. **`Astrozor: Check identity`** → notification with your email = success

The token is stored in **VS Code Secret Storage** — DPAPI on Windows, Keychain on macOS, libsecret on Linux. Not in `settings.json`, can't be accidentally committed.

## 4) Publishing

### Markdown (`.md`)

Open the `.md` file, then either:

- `Ctrl+Shift+P` → **`Astrozor: Publish Markdown article`**
- Or right-click on the file in the Explorer panel

The dialog asks for title (defaults to YAML), slug, summary, language. Press Enter four times to publish.

### Quarto (`.qmd`)

**Requires:** Quarto CLI installed (https://quarto.org/docs/get-started/). If Code reports *Could not run "quarto"*, set the full path in Settings → `astrozor.quartoExecutable`:

```
C:\Program Files\Quarto\bin\quarto.exe
```

(If you already have RStudio, a bundled Quarto lives at `C:\Program Files\RStudio\resources\app\bin\quarto\bin\quarto.exe`.)

Then open the `.qmd` and run **`Astrozor: Publish Quarto / RMarkdown document`**.

The extension:
1. Runs `quarto render <file.qmd>` (stdout/stderr in Output → channel **Astrozor**)
2. Zips the generated HTML + asset folder
3. POSTs to `/api/v1/publish/quarto`
4. Shows a notification with the URL — click **Open in browser**

### Pre-rendered HTML folder

Right-click any folder containing `index.html` → **`Astrozor: Publish folder`**. Good for Jupyter `nbconvert` output, Hugo single-page builds, etc.

## 5) Idempotence

Publish a `.qmd` with the same slug twice → the server **updates** the existing article in place, preserving DOI and comments. Iterate freely without creating duplicates.

## What gets sent

| Endpoint | Fields |
|---|---|
| `POST /publish/articles` | `title`, `summary`, `language`, `engine=markdown`, `license`, `content_md`, `tags[]` |
| `POST /publish/quarto` (multipart) | `bundle` (ZIP), `title`, `slug`, `summary`, `language`, `engine`, `license`, `published_via=vscode` |

Header: `Authorization: Bearer ast_pat_…`

## Troubleshooting

| Error | Fix |
|---|---|
| `401 Token rejected` | Create a new token → **`Astrozor: Set API token`** |
| `403 Token missing 'publish:articles' scope` | Token created without the right scope |
| `400 Slug taken by another user` | The slug belongs to someone else — pick a different one |
| `507 Storage quota exceeded` | Delete older articles or ask an admin to raise the quota |
| `Could not run "quarto"` | Set `astrozor.quartoExecutable` in Settings |

The Output panel (`Ctrl+Shift+U` → channel **Astrozor**) shows the full diagnostic including Quarto stdout/stderr.

## Settings

| Key | Default | What it does |
|---|---|---|
| `astrozor.baseUrl` | `https://astrozor.cz` | Instance URL |
| `astrozor.defaultLanguage` | `cs` | Default language in the dialog |
| `astrozor.defaultLicense` | `CC BY 4.0` | License |
| `astrozor.quartoExecutable` | `quarto` | Path to the Quarto CLI |
| `astrozor.confirmBeforePublish` | `true` | Show the metadata dialog (disable for one-click publish) |

## Try it with a sample

Grab the test `.qmd` from [Sample articles](/samples/vscode-quarto.qmd), open it in VS Code, publish — if the article appears on Astrozor with the table and code intact, your toolchain is good to go.
