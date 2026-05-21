# astrozorpub-labextension — JupyterLab toolbar button

Adds a **🔭 Publish** toolbar button to every notebook in JupyterLab.
Clicking it opens a small dialog (title / slug / summary / theme /
re-execute), then drives the Python `astrozorpub.publish()` pipeline
through the Jupyter server extension that ships with the parent
package.

This is a UI sugar on top of the [astrozorpub](../) Python package —
the heavy work (nbconvert render, ZIP bundling, multipart upload to
Astrozor) all happens server-side.

## Install (development)

```bash
# 1. Install the Python part — gives you CLI + magic + the
#    Jupyter server extension that this UI talks to.
pip install -e "../"

# 2. Build the Lab extension and link it into JupyterLab.
jlpm install
jlpm build
jupyter labextension develop --overwrite .

# 3. Restart JupyterLab. The 🔭 Publish button should appear in
#    every notebook toolbar.
```

You also need to set the Astrozor token once (this lives on the
Jupyter host, not in the browser):

```bash
astrozorpub set-base-url http://localhost   # or https://astrozor.cz
astrozorpub set-token ast_pat_xxxxxxxxxxxx
astrozorpub whoami
```

## What the button does

1. **Saves the notebook** so the publish reflects current state.
2. **Probes `/astrozorpub/status`** to confirm a token is set and
   shows the base URL so you know where it'll publish.
3. **Opens the dialog** pre-filled with title (notebook stem) and
   slug (slugified filename). You can also enable re-execute and
   pick a theme.
4. On accept, **POSTs to `/astrozorpub/publish`**, which on the
   Python side runs `astrozorpub.publish()` (nbconvert → ZIP →
   POST `/api/publish/quarto?engine=jupyter` against the
   configured Astrozor instance).
5. Shows the result with slug + DOI + link.

## Architecture

```
┌────────────────────┐         ┌────────────────────┐         ┌────────────────┐
│  Lab toolbar (TS)  │ ──────► │ Jupyter server ext │ ──────► │   Astrozor     │
│  this extension    │  POST   │ (Python, tornado)  │ multipart│  /publish/...  │
└────────────────────┘         └────────────────────┘         └────────────────┘
       ▲                                ▲
       │ user token + auth              │ Astrozor PAT
       │ (Lab cookie)                   │ (~/.astrozor/config.json)
       │                                │
   browser                          Jupyter host
```

The Astrozor token never leaves the Jupyter host. The Lab side
only sees `has_token: bool` + the base URL.

## Build for distribution (prebuilt)

```bash
jlpm build:prod
# Produces ../astrozorpub/labextension/ — gets picked up by
# `pip install astrozorpub` once data_files in pyproject.toml lists it.
```

The prebuilt path means end users can `pip install astrozorpub` and
restart Lab — no Node toolchain on their side.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Button missing after rebuild | `jupyter labextension list` — check that astrozorpub-labextension is enabled |
| "Server extension nedostupný" | Server extension didn't load — `pip install -e ../` and restart Jupyter |
| "Chybí token" | Run `astrozorpub set-token` once on the Jupyter host |
| 500 with `Publish failed: HTTP 401` | Token expired / revoked — generate a new one in Astrozor Settings |
