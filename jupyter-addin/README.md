# astrozorpub — Jupyter addin for Astrozor

Publishes rendered **Jupyter notebooks** (`.ipynb` → HTML + assets)
to an Astrozor instance. Sister package to the RStudio addin
(`rstudio-addin/`), targeting the same `/api/publish/quarto`
endpoint (which despite its name accepts `engine=jupyter`).

Four surfaces, same pipeline:

* **Python API** — `import astrozorpub; astrozorpub.publish(...)`
* **CLI** — `astrozorpub publish notebook.ipynb`
* **IPython magic** — `%astrozor_publish` inside a notebook cell
* **JupyterLab toolbar button** — 🔭 Publish, opens a publish dialog
  (see [lab-extension/](lab-extension/) for build instructions)

## Local install (testing)

```bash
# From the Astrozor monorepo root
pip install -e ./jupyter-addin

# Point at a local dev instance instead of production
astrozorpub set-base-url http://localhost

# Mint a token in Astrozor (Settings → API tokens) and store it
astrozorpub set-token ast_pat_xxxxxxxxxxxx

# Sanity check
astrozorpub whoami
# {"user_email": "...", "token_name": "...", "scopes": ["publish:articles"]}
```

The `pip install` step automatically enables the **Jupyter server
extension** (`/astrozorpub/publish` and `/status` endpoints), so the
Lab toolbar button + CLI + magic all share the same code path. The
config drop-in is shipped under `etc/jupyter/jupyter_server_config.d/`
as a data file — restart your Jupyter server after install.

For the toolbar button, additionally build the Lab extension:

```bash
cd jupyter-addin/lab-extension
jlpm install
jlpm build
jupyter labextension develop --overwrite .
# Restart JupyterLab — 🔭 Publish appears in the notebook toolbar.
```

The token is persisted to `~/.astrozor/config.json` (mode 0600
on POSIX). Override the location with `ASTROZOR_CONFIG=/path/to/cfg`.

Env vars `ASTROZOR_TOKEN` and `ASTROZOR_BASE_URL` take precedence
over the config file — handy for CI / containerised notebooks.

## CLI usage

```bash
# Default: render with dark theme, publish under derived slug
astrozorpub publish analysis.ipynb --title "Galaxy spectrum fit"

# Update the same article (same slug → in-place update)
astrozorpub publish analysis.ipynb --slug my-experiment

# Re-execute cells before exporting (slow but fresh)
astrozorpub publish analysis.ipynb --execute

# Already have analysis.html next to the notebook? Skip rendering.
astrozorpub publish analysis.ipynb --no-render

# Light theme (uses nbconvert's stock lab template)
astrozorpub publish analysis.ipynb --theme light

# Don't touch theme — keep what nbconvert produced
astrozorpub publish analysis.ipynb --theme none
```

## Python API

```python
import astrozorpub

astrozorpub.set_token("ast_pat_xxx")
astrozorpub.set_base_url("http://localhost")
astrozorpub.whoami()

# End-to-end
res = astrozorpub.publish(
    "analysis.ipynb",
    title="Galaxy spectrum fit",
    slug="galaxy-spectrum",
    summary="…",
)
print(res["url"])

# Just render and bundle (debug)
html = astrozorpub.render("analysis.ipynb", theme="dark")
zip_bytes = astrozorpub.bundle(html)
```

## IPython magic (in a notebook cell)

```python
%load_ext astrozorpub
%astrozor_publish analysis.ipynb --title "Galaxy spectrum fit"
```

Output:

```
✅ Published to Astrozor — slug=galaxy-spectrum-fit
   /articles/galaxy-spectrum-fit
```

The magic tries to auto-detect the current notebook path (works
inside VS Code's Jupyter, Cursor, and some Lab variants). When
detection fails, pass the path explicitly as the first arg.

## Themes

Astrozor is a dark UI — the bundled `dark` theme injects an extra
CSS override on top of nbconvert's `lab` template so the rendered
notebook blends into the article detail iframe (`#0f172a` slate-900
background, `#818cf8` indigo-400 links, code cells in `#020617`
slate-950 with `#1e293b` slate-800 borders).

| `theme` | What it does |
|---|---|
| `"dark"` (default) | Astrozor look — matches the surrounding article view |
| `"light"` | nbconvert lab default — bright BG, good for print export |
| `"none"` | No extra CSS — keeps whatever nbconvert produces |

## How it differs from the R addin

| RStudio addin (R) | Jupyter addin (Python) |
|---|---|
| `astrozor_publish("doc.qmd")` | `astrozorpub.publish("doc.ipynb")` |
| Quarto / `rmarkdown::render` | nbconvert + optional execute |
| `.Renviron` (RStudio convention) | `~/.astrozor/config.json` |
| RStudio Shiny gadget (mini UI) | IPython magic + CLI |
| `engine=quarto` / `rmarkdown` | `engine=jupyter` |

Both ultimately POST a ZIP containing `index.html` + assets to
`/api/publish/quarto`, so the server-side flow (DOI minting, storage
quota, idempotent slug-based updates) is identical.

## License

MIT — see `pyproject.toml`.
