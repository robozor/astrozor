"""Render + bundle + upload pipeline.

Three pure functions:

* :func:`render` runs nbconvert and returns the path to the produced
  HTML file (plus its sibling assets directory).
* :func:`bundle` zips an HTML file + its sibling assets into a
  ``index.html`` + assets layout the Astrozor endpoint expects.
* :func:`publish` is the convenience that chains the two and POSTs
  to ``/api/publish/quarto`` with ``engine=jupyter``.

Each step is independent so a user can render manually (e.g. with
``nbconvert --execute``), then call ``bundle`` and ``publish``
separately.
"""

from __future__ import annotations

import io
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import httpx

from .config import get_base_url, get_token


def _slug_from_path(p: Path) -> str:
    """Derive a stable URL-friendly slug from a notebook filename.

    Matches the heuristic used by the RStudio addin so the same
    notebook (e.g. ``Analysis 2026-05.ipynb``) produces the same
    Astrozor URL regardless of which interface uploaded it.
    """
    stem = p.stem.lower()
    stem = re.sub(r"[^a-z0-9-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip("-")
    return stem[:120] or "notebook"


def _theme_css_path(theme: str) -> Path | None:
    """Return the bundled CSS for a theme name, or None for the
    nbconvert default."""
    if theme not in ("dark", "light"):
        return None
    if theme == "light":
        return None  # nbconvert's lab template is already light
    return Path(__file__).parent / "themes" / "dark.css"


def render(
    notebook_path: str | Path,
    *,
    output_dir: str | Path | None = None,
    theme: str = "dark",
    execute: bool = False,
) -> Path:
    """Run nbconvert against ``notebook_path`` and return the path to
    the produced ``.html``.

    Parameters
    ----------
    notebook_path
        Path to an ``.ipynb`` file. Must exist.
    output_dir
        Where to write the rendered HTML and its ``*_files`` sibling.
        Defaults to the notebook's directory.
    theme
        ``"dark"`` (default — Astrozor look), ``"light"`` (stock
        nbconvert lab), or ``"none"`` (no extra CSS).
    execute
        When True, runs cells before exporting. Useful when the
        notebook was last saved without outputs. Off by default
        because re-execution can be expensive and the user may
        deliberately want a "save as it sits" publish.
    """
    # Imported lazily — keeps ``astrozorpub`` cheap to load when the
    # caller only needs the config helpers / whoami.
    from nbconvert import HTMLExporter
    from nbconvert.preprocessors import ExecutePreprocessor
    import nbformat

    nb_path = Path(notebook_path).expanduser().resolve()
    if not nb_path.is_file():
        raise FileNotFoundError(f"Notebook not found: {nb_path}")
    if nb_path.suffix.lower() != ".ipynb":
        raise ValueError(f"Expected .ipynb, got {nb_path.suffix!r}")

    out_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir
        else nb_path.parent
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    nb = nbformat.read(nb_path, as_version=4)
    if execute:
        ep = ExecutePreprocessor(timeout=600, kernel_name="python3")
        ep.preprocess(nb, {"metadata": {"path": str(nb_path.parent)}})

    exporter = HTMLExporter()
    # ``lab`` template is the modern default; falls back gracefully
    # on older nbconvert versions that still ship the legacy
    # ``classic`` one.
    try:
        exporter.template_name = "lab"
    except Exception:  # pragma: no cover
        pass
    body, resources = exporter.from_notebook_node(nb)

    # Inject our theme CSS by appending to the rendered <head>. We
    # don't replace nbconvert's stylesheet — we layer over it so the
    # baseline Jupyter look is preserved for cells we don't restyle.
    theme_css = _theme_css_path(theme)
    if theme_css is not None and theme_css.exists():
        css = theme_css.read_text(encoding="utf-8")
        injected = f"<style>\n{css}\n</style>"
        if "</head>" in body:
            body = body.replace("</head>", f"{injected}\n</head>", 1)
        else:
            body = injected + body

    html_path = out_dir / f"{nb_path.stem}.html"
    html_path.write_text(body, encoding="utf-8")

    # Write any binary outputs (images, etc.) nbconvert collected into
    # a sibling ``<stem>_files/`` directory.
    outputs = resources.get("outputs") or {}
    if outputs:
        files_dir = out_dir / f"{nb_path.stem}_files"
        files_dir.mkdir(exist_ok=True)
        for name, data in outputs.items():
            (files_dir / name).write_bytes(data)

    return html_path


def bundle(html_path: str | Path) -> bytes:
    """Build the multipart-upload bundle: ``index.html`` at root +
    any sibling ``<stem>_files/`` directory.

    Returns the raw ZIP bytes so the caller can stream them straight
    to ``httpx`` without writing a temp file (the file gets thrown
    away after one POST anyway).
    """
    html = Path(html_path).expanduser().resolve()
    if not html.is_file():
        raise FileNotFoundError(f"HTML not found: {html}")
    stem = html.stem
    files_dir = html.parent / f"{stem}_files"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # The endpoint expects ``index.html`` at zip root regardless of
        # the source file name — we rename on the fly.
        zf.writestr("index.html", html.read_text(encoding="utf-8"))
        if files_dir.is_dir():
            for path in files_dir.rglob("*"):
                if path.is_file():
                    arcname = path.relative_to(html.parent).as_posix()
                    zf.write(path, arcname=arcname)
    return buf.getvalue()


def publish(
    notebook_path: str | Path,
    *,
    title: str | None = None,
    slug: str | None = None,
    summary: str = "",
    language: str = "cs",
    license: str = "CC BY 4.0",
    theme: str = "dark",
    execute: bool = False,
    render_first: bool = True,
) -> dict[str, Any]:
    """End-to-end publish: render → bundle → POST.

    Idempotent on (user, slug): re-running with the same slug
    replaces the bundle on the Astrozor side in place. Returns the
    server response so the caller can show the article URL right
    after the cell finishes.

    Pass ``render_first=False`` when the notebook has already been
    converted to HTML elsewhere and the same-stem ``.html`` lives
    next to the ``.ipynb`` — saves a re-render cycle.
    """
    token = get_token()
    if not token:
        raise RuntimeError(
            "No Astrozor token set. Call astrozorpub.set_token('ast_pat_…') first."
        )
    nb_path = Path(notebook_path).expanduser().resolve()
    effective_title = (title or nb_path.stem).strip()
    effective_slug = (slug or _slug_from_path(nb_path)).strip()

    if render_first:
        html_path = render(nb_path, theme=theme, execute=execute)
    else:
        html_path = nb_path.with_suffix(".html")
        if not html_path.exists():
            raise FileNotFoundError(
                f"render_first=False but {html_path} does not exist"
            )

    zip_bytes = bundle(html_path)
    url = f"{get_base_url()}/api/v1/publish/quarto"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "astrozorpub-py/0.1.0",
    }
    files = {
        "bundle": (f"{effective_slug}.zip", zip_bytes, "application/zip"),
    }
    data = {
        "title": effective_title,
        "slug": effective_slug,
        "summary": summary[:400],
        "language": language[:8] or "cs",
        # The backend coerces unknown engines to "quarto" — we send
        # the explicit "jupyter" value so the article surfaces with
        # the correct provenance badge on Astrozor.
        "engine": "jupyter",
        "license": license or "CC BY 4.0",
        "published_via": "api",
    }
    # Use a longish timeout because the upload includes images and the
    # server extracts the bundle synchronously before responding.
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, headers=headers, files=files, data=data)
    if r.status_code not in (200, 201):
        raise RuntimeError(
            f"Publish failed: HTTP {r.status_code} — {r.text[:500]}"
        )
    return r.json()
