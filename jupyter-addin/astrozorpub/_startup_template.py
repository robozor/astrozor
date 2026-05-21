"""astrozorpub IPython startup hook.

Copied into ``~/.ipython/profile_default/startup/`` by
``astrozorpub.install_startup()``. IPython runs every ``.py`` file
in the startup directory before the first user cell, alphabetically.
This file ships as ``00-astrozorpub.py`` so it loads early.

Effect after kernel restart:
  * ``astrozorpub`` and ``publish()`` are global — no ``import`` needed.
  * After the first cell runs, a **🔭 Publish to Astrozor** button is
    rendered into that cell's output area. Click → publish form
    appears just below the button (in an Output widget container).
    Stays available until kernel restart.

We deliberately don't try ``position: fixed`` — JupyterLab 4 has
nested wrappers that defeat fixed positioning, leaving the button
half-clipped. A regular in-cell button is reliable and visible
once the user scrolls to the top of the notebook (or clicks
"View → Show Header" to keep it pinned in some Lab versions).
"""

from __future__ import annotations

# Keep references at module level so Python doesn't GC the widgets
# between display() and the browser's render — without this we get
# "Error displaying widget: model not found".
_ASTROZOR_WIDGETS_KEEPALIVE: list = []


def _astrozorpub_install_publish_button() -> None:
    """Register a one-shot post_run_cell hook that displays a
    publish button + form container into the first cell's output."""
    try:
        from IPython import get_ipython
    except ImportError:
        return

    ip = get_ipython()
    if ip is None:
        return

    state = {"shown": False}

    def _show_publish_button(_info=None):
        if state["shown"]:
            return
        state["shown"] = True
        try:
            import ipywidgets as ipw
            from IPython.display import display
            import astrozorpub

            fab = ipw.Button(
                description="🔭 Publish to Astrozor",
                tooltip="Click to open the publish form",
                button_style="primary",
                layout=ipw.Layout(width="260px", height="36px"),
            )
            # Output container that captures the form display when
            # button is clicked. Without this, display() from a
            # button handler has no cell context and falls back to
            # the log panel as plain text.
            form_out = ipw.Output()

            def _open_dialog(_btn):
                form_out.clear_output()
                with form_out:
                    astrozorpub.publish_widget()

            fab.on_click(_open_dialog)

            container = ipw.VBox(
                [fab, form_out],
                layout=ipw.Layout(
                    border="1px solid #334155",
                    padding="8px",
                    border_radius="6px",
                    background_color="#0f172a",
                    margin="6px 0",
                ),
            )
            # Pin everything at module level so nothing gets GC'd
            # before the browser renders.
            _ASTROZOR_WIDGETS_KEEPALIVE.extend([fab, form_out, container])
            display(container)
        except ImportError as exc:
            print(
                f"[astrozorpub] ipywidgets missing ({exc}) — install "
                "with: pip install ipywidgets"
            )
        except Exception as exc:
            print(f"[astrozorpub] publish button skipped: {exc}")

    ip.events.register("post_run_cell", _show_publish_button)


try:
    import astrozorpub  # noqa: F401 - re-exported into user_ns

    def publish(*args, **kwargs):  # noqa: F811 - intentional global
        """Open the Astrozor publish form. Equivalent to
        ``astrozorpub.publish_widget(...)``."""
        return astrozorpub.publish_widget(*args, **kwargs)

    _astrozorpub_install_publish_button()
except ImportError:
    pass
