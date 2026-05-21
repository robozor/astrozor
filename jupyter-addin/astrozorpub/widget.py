"""ipywidgets-based publish dialog.

Drop ``astrozorpub.publish_widget()`` into a notebook cell — renders
a small form (title / slug / summary / theme / re-execute) plus a
🔭 Publish button. The form re-renders inside the cell output, so
"Run All Cells" does NOT trigger a publish — it just re-builds the
form. The publish happens only when the user clicks the button.

This is the no-JupyterLab-extension way to get a GUI experience
close to what the R / RStudio gadget provides. For users who do
build the Lab extension, this is also a useful fallback that works
in classic Jupyter Notebook, VS Code Jupyter, Cursor, and Binder.
"""

from __future__ import annotations

import re
import threading
import traceback
from pathlib import Path

from .config import get_base_url, get_token


def _slug_from_filename(name: str) -> str:
    stem = re.sub(r"\.ipynb$", "", name, flags=re.IGNORECASE).lower()
    stem = re.sub(r"[^a-z0-9-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip("-")
    return stem[:120] or "notebook"


def _guess_current_notebook() -> Path | None:
    """Best-effort current-notebook discovery — mirrors the magic's
    helper but kept private here so widget.py works without IPython
    when run outside a kernel (e.g. in tests)."""
    try:
        from IPython import get_ipython  # noqa: WPS433 - lazy import
    except ImportError:
        return None
    ip = get_ipython()
    if ip is None:
        return None
    for key in (
        "__vsc_ipynb_file__",
        "__session__",
        "notebook_path",
    ):
        p = ip.user_ns.get(key)
        if isinstance(p, str) and p.endswith(".ipynb"):
            return Path(p).expanduser().resolve()
    return None


def publish_widget(
    notebook_path: str | Path | None = None,
    *,
    default_title: str | None = None,
    default_summary: str = "",
    default_theme: str = "dark",
):
    """Render the publish form. Call this from a notebook cell.

    Parameters
    ----------
    notebook_path
        If given, the form is locked to this path (read-only display).
        Otherwise the user types it in — pre-filled from the
        auto-detected current notebook when possible.
    default_title, default_summary, default_theme
        Pre-fill values for the form fields.
    """
    try:
        import ipywidgets as ipw
        from IPython.display import display
    except ImportError as e:
        raise RuntimeError(
            "publish_widget() requires ipywidgets. Install it with:\n"
            "    pip install ipywidgets\n"
            "or install the addin with the extras: pip install -e ./jupyter-addin[widgets]"
        ) from e

    # Resolve path defaults — explicit > auto-detected > blank.
    resolved = (
        Path(notebook_path).expanduser().resolve()
        if notebook_path
        else _guess_current_notebook()
    )
    path_value = str(resolved) if resolved else ""
    base_name = resolved.name if resolved else ""

    base_url = get_base_url()
    has_token = bool(get_token())

    # --- Header strip ---------------------------------------------
    header_html = (
        f"<div style='padding:6px 0 4px 0;font-size:12px;color:#94a3b8'>"
        f"Cíl: <strong style='color:#e2e8f0'>{_escape(base_url)}</strong>"
    )
    if not has_token:
        header_html += (
            " · <span style='color:#f87171'>⚠ chybí token — "
            "spusť <code>astrozorpub set-token …</code> v terminálu</span>"
        )
    header_html += "</div>"

    # --- Form fields ----------------------------------------------
    nb_input = ipw.Text(
        value=path_value,
        description="Notebook:",
        placeholder="cesta/k/notebooku.ipynb",
        disabled=bool(notebook_path),  # locked when explicit
        layout=ipw.Layout(width="100%"),
        style={"description_width": "80px"},
    )
    title_input = ipw.Text(
        value=default_title or (Path(base_name).stem if base_name else ""),
        description="Název:",
        placeholder="Název článku",
        layout=ipw.Layout(width="100%"),
        style={"description_width": "80px"},
    )
    slug_input = ipw.Text(
        value=_slug_from_filename(base_name) if base_name else "",
        description="Slug:",
        placeholder="muj-experiment",
        layout=ipw.Layout(width="100%"),
        style={"description_width": "80px"},
    )
    summary_input = ipw.Textarea(
        value=default_summary,
        description="Popis:",
        placeholder="Krátký popis (volitelně, max 400 znaků)",
        rows=2,
        layout=ipw.Layout(width="100%"),
        style={"description_width": "80px"},
    )
    theme_input = ipw.Dropdown(
        options=[
            ("Dark (Astrozor)", "dark"),
            ("Light (nbconvert default)", "light"),
            ("Beze změny", "none"),
        ],
        value=default_theme,
        description="Téma:",
        style={"description_width": "80px"},
    )
    execute_input = ipw.Checkbox(
        value=False,
        description="Před exportem znovu spustit všechny buňky",
        indent=False,
    )

    publish_btn = ipw.Button(
        description="🔭 Publish",
        button_style="primary",
        tooltip="Render + bundle + upload na Astrozor",
        layout=ipw.Layout(width="160px"),
        disabled=not has_token,
    )
    status_html = ipw.HTML(
        value="<div style='color:#64748b;font-size:11px;padding-top:4px'>"
        "Připraven. Klikni Publish.</div>"
    )

    # --- Click handler --------------------------------------------
    def _set_status(html: str) -> None:
        status_html.value = html

    def _publish_in_background() -> None:
        # Imported lazily — keeps widget import cheap when the user
        # just wants to display the form.
        from .publish import publish

        title = title_input.value.strip()
        if not title:
            _set_status(
                "<div style='color:#f87171;font-size:12px'>❌ Název je povinný.</div>"
            )
            publish_btn.disabled = False
            return
        nb_path = nb_input.value.strip()
        if not nb_path:
            _set_status(
                "<div style='color:#f87171;font-size:12px'>"
                "❌ Cesta k notebooku je prázdná.</div>"
            )
            publish_btn.disabled = False
            return
        _set_status(
            "<div style='color:#fcd34d;font-size:12px'>⏳ Publikuji… "
            "(render → bundle → upload)</div>"
        )
        try:
            res = publish(
                nb_path,
                title=title,
                slug=slug_input.value.strip() or None,
                summary=summary_input.value or "",
                theme=theme_input.value,
                execute=execute_input.value,
            )
        except Exception as e:
            _set_status(
                f"<div style='color:#f87171;font-size:12px'>"
                f"❌ <strong>{_escape(type(e).__name__)}</strong>: "
                f"{_escape(str(e))}<br>"
                f"<pre style='font-size:10px;color:#94a3b8;"
                f"max-height:120px;overflow:auto;background:#0f172a;"
                f"padding:6px;border-radius:4px;margin-top:6px'>"
                f"{_escape(traceback.format_exc()[-1200:])}</pre></div>"
            )
            publish_btn.disabled = False
            return
        slug = res.get("article_slug") or "?"
        url = (base_url or "") + (res.get("url") or "")
        doi = res.get("doi") or ""
        _set_status(
            f"<div style='color:#34d399;font-size:12px;line-height:1.5'>"
            f"✅ <strong>Publikováno</strong> — slug "
            f"<code style='color:#e2e8f0'>{_escape(slug)}</code>"
            + (f"<br>DOI: <code>{_escape(doi)}</code>" if doi else "")
            + f"<br><a href='{_escape(url)}' target='_blank' "
            f"style='color:#818cf8'>{_escape(url)} ↗</a></div>"
        )
        publish_btn.disabled = False

    def _on_click(_btn) -> None:
        publish_btn.disabled = True
        # Run in a daemon thread so the publish (which can take ~30 s
        # for big notebooks with --execute) doesn't freeze the UI
        # event loop. Status updates fire from the worker via
        # widget value assignment, which IS thread-safe in ipywidgets.
        threading.Thread(target=_publish_in_background, daemon=True).start()

    publish_btn.on_click(_on_click)

    # --- Layout ---------------------------------------------------
    form = ipw.VBox(
        [
            ipw.HTML(header_html),
            nb_input,
            title_input,
            slug_input,
            summary_input,
            ipw.HBox([theme_input, execute_input]),
            ipw.HBox([publish_btn, status_html]),
        ],
        layout=ipw.Layout(
            padding="10px",
            border="1px solid #1e293b",
            border_radius="6px",
            width="100%",
            max_width="640px",
        ),
    )
    display(form)
    # Intentionally return None — returning ``form`` would make
    # Jupyter auto-repr the last expression and render the widget
    # twice (once from our display(), once from the cell auto-display).
    # Callers needing the widget object can use the lower-level
    # ``astrozorpub.widget._build_widget(...)`` API instead.
    return None


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )
