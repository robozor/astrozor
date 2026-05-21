"""Jupyter server extension — exposes astrozorpub over HTTP so the
JupyterLab frontend toolbar can trigger a publish without crossing
the same-origin / CORS boundary to the Astrozor instance.

Two endpoints, both authenticated against the running Jupyter server
(via the token cookie / header that Lab already manages):

* ``GET /astrozorpub/status`` — config snapshot for the dialog
  (whether a token is set, what base URL we'll publish to).
* ``POST /astrozorpub/publish`` — body ``{"notebook_path": ..., title,
  slug, summary, language, theme, execute}``; runs the same code
  path as the Python ``publish()`` helper and returns the server's
  response (or an error).

Authentication note: we deliberately *don't* expose the user's
Astrozor token over this endpoint — the request just confirms it's
there. The token lives on the Jupyter host (``~/.astrozor/config.json``
or env vars) and only the Jupyter process uses it.
"""

from __future__ import annotations

import asyncio
import json
import traceback
from pathlib import Path

# JupyterServer ships ``ExtensionApp`` for full extensions, but we
# only need to register a handler pair — the simpler ``Handler`` +
# ``url_path_join`` flow is enough and avoids a class hierarchy that
# would otherwise dwarf the actual work.
try:
    from jupyter_server.base.handlers import APIHandler
    from jupyter_server.utils import url_path_join
    from tornado import web
except ImportError:  # pragma: no cover - server-side dep only
    APIHandler = object  # type: ignore[misc,assignment]

    def url_path_join(*parts):  # type: ignore
        return "/".join(p.strip("/") for p in parts)

    class _Web:  # type: ignore
        @staticmethod
        def authenticated(fn):
            return fn

    web = _Web()  # type: ignore


from .config import get_base_url, get_token
from .publish import publish


class StatusHandler(APIHandler):
    """``GET /astrozorpub/status`` — config snapshot for the dialog.

    Returns only public-safe fields. Never echoes the bearer token.
    """

    @web.authenticated
    def get(self) -> None:
        tok = get_token()
        self.finish(
            json.dumps(
                {
                    "base_url": get_base_url(),
                    "has_token": bool(tok),
                    # Public 12-char prefix is fine — tokens are scoped
                    # and the prefix is shown elsewhere in the UI too.
                    "token_prefix": (tok[:12] + "…") if tok else "",
                }
            )
        )


class PublishHandler(APIHandler):
    """``POST /astrozorpub/publish`` — render + bundle + upload.

    Body fields (all optional except ``notebook_path``):

      * ``notebook_path`` (str) — path to ``.ipynb`` relative to the
        Jupyter root or absolute. Must exist on disk.
      * ``title``, ``slug``, ``summary``, ``language``, ``license``,
        ``theme`` (``dark`` | ``light`` | ``none``), ``execute`` (bool),
        ``render_first`` (bool).

    Returns the Astrozor server's response on success or
    ``{"error": "..."}`` with a non-2xx status on failure.
    """

    @web.authenticated
    async def post(self) -> None:
        try:
            body = json.loads(self.request.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.set_status(400)
            self.finish(json.dumps({"error": "Invalid JSON body"}))
            return

        notebook_path = body.get("notebook_path")
        if not isinstance(notebook_path, str) or not notebook_path.strip():
            self.set_status(400)
            self.finish(
                json.dumps({"error": "notebook_path is required"})
            )
            return

        nb = Path(notebook_path).expanduser()
        # JupyterLab passes a path relative to the server root; resolve
        # against the configured root_dir when not absolute.
        if not nb.is_absolute():
            root = Path(self.settings.get("server_root_dir") or ".")
            nb = (root / nb).resolve()
        if not nb.is_file():
            self.set_status(404)
            self.finish(json.dumps({"error": f"Notebook not found: {nb}"}))
            return

        kwargs = {
            "title": body.get("title") or None,
            "slug": body.get("slug") or None,
            "summary": body.get("summary") or "",
            "language": body.get("language") or "cs",
            "license": body.get("license") or "CC BY 4.0",
            "theme": body.get("theme") or "dark",
            "execute": bool(body.get("execute", False)),
            "render_first": bool(body.get("render_first", True)),
        }

        # ``publish`` is sync (httpx call inside) — run on the default
        # executor so we don't block the Jupyter server's event loop
        # while nbconvert renders / the Astrozor server extracts the
        # bundle.
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None, lambda: publish(nb, **kwargs)
            )
        except Exception as e:
            self.set_status(500)
            self.finish(
                json.dumps(
                    {
                        "error": str(e),
                        # The trace helps the user debug a misconfigured
                        # token / bad render without diving into the
                        # Jupyter server logs.
                        "trace": traceback.format_exc()[-1500:],
                    }
                )
            )
            return

        self.finish(json.dumps(result))


def _jupyter_server_extension_points():  # noqa: N802 - Jupyter API name
    """Required Jupyter Server hook: declares this module as an
    extension. Looked up by jupyter_server when the matching JSON
    config in ``jupyter-config/jupyter_server_config.d/`` enables us."""
    return [{"module": "astrozorpub.server_extension"}]


def _load_jupyter_server_extension(server_app):  # noqa: N802
    """Wire our two handlers into the running Jupyter server's web
    app. Endpoints land at ``${base_url}astrozorpub/...``."""
    web_app = server_app.web_app
    host_pattern = ".*$"
    base = web_app.settings["base_url"]
    handlers = [
        (
            url_path_join(base, "astrozorpub", "status"),
            StatusHandler,
        ),
        (
            url_path_join(base, "astrozorpub", "publish"),
            PublishHandler,
        ),
    ]
    web_app.add_handlers(host_pattern, handlers)
    server_app.log.info("astrozorpub server extension loaded — POST %sastrozorpub/publish", base)
