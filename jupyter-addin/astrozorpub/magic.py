"""IPython magic — ``%astrozor_publish`` for in-notebook one-line publish.

Loaded via ``%load_ext astrozorpub``. The line magic accepts the
same arguments as :func:`astrozorpub.publish` but feels closer to
the addin button in RStudio: paste it at the bottom of the notebook
and run it to push the latest version to Astrozor.

Designed to fail loudly with a helpful message — a notebook user
should never have to dig into a Python traceback to figure out
that their token isn't set.
"""

from __future__ import annotations

import shlex
from pathlib import Path

# IPython is an optional dep at install time (the user might be using
# astrozorpub from a plain Python script). We import inside the
# extension entrypoint, not at module import — see __init__.py.
try:
    from IPython.core.magic import Magics, line_magic, magics_class
except ImportError:  # pragma: no cover
    # Provide stubs so the module imports cleanly outside IPython.
    def magics_class(cls):  # type: ignore
        return cls

    def line_magic(fn):  # type: ignore
        return fn

    class Magics:  # type: ignore
        pass


from .publish import publish


def _resolve_notebook(arg: str) -> Path | None:
    """Find an .ipynb path the user passed to the magic.

    Jupyter sets the kernel CWD to the notebook's directory, so a
    common foot-gun is passing ``requirements/notebook.ipynb`` when
    the user already opened the file inside ``requirements/`` —
    that doubles to ``requirements/requirements/...`` and fails.

    We try in order:
      1. Absolute or CWD-relative as-is.
      2. Resolve against each parent up to 3 levels (handles the
         "ran jupyter lab from repo root, opened notebook in subdir"
         case where the user types the repo-rooted path).
      3. Bare filename match in any of the above.
    """
    p = Path(arg).expanduser()
    if p.is_absolute():
        return p if p.is_file() else None
    cwd = Path.cwd()
    candidates: list[Path] = [(cwd / p).resolve()]
    cur = cwd
    for _ in range(3):
        cur = cur.parent
        candidates.append((cur / p).resolve())
        # Also try just the basename in each ancestor — covers the
        # ``requirements/foo.ipynb`` typed from inside ``requirements/``.
        candidates.append((cur / p.name).resolve())
    for c in candidates:
        if c.is_file():
            return c
    # Last resort: walk the directory tree of CWD's parent for a
    # filename match. Cheap because we cap depth and notebooks have
    # a distinctive extension.
    base_name = p.name
    for depth_root in (cwd, cwd.parent):
        if not depth_root.exists():
            continue
        for found in depth_root.rglob(base_name):
            if found.is_file() and found.suffix == ".ipynb":
                return found.resolve()
    return None


def _current_notebook_path() -> Path | None:
    """Best-effort discovery of the notebook the magic is running in.

    JupyterLab doesn't expose the notebook path through ``%%``-style
    macros — we try a few well-known IPython hooks and fall back to
    None so the user gets a clear error rather than a stack trace.
    """
    try:
        from IPython import get_ipython

        ip = get_ipython()
        if ip is None:
            return None
        # The JS side of JupyterLab sets this when the user runs a
        # cell from the lab interface (since nbclassic / Lab 4).
        for key in ("__vsc_ipynb_file__", "__session__", "notebook_path"):
            p = ip.user_ns.get(key)
            if isinstance(p, str) and p.endswith(".ipynb"):
                return Path(p).expanduser().resolve()
    except Exception:
        pass
    return None


@magics_class
class AstrozorMagics(Magics):
    """``%astrozor_publish [notebook.ipynb] [--title …] [--slug …] [--summary …]``

    All flags optional. With no positional path argument, the magic
    tries to detect the current notebook via IPython hooks; if that
    fails (common in plain JupyterLab), pass the path explicitly.

    Example::

        %load_ext astrozorpub
        %astrozor_publish analysis.ipynb --title "Galaxy spectrum fit"
    """

    @line_magic
    def astrozor_publish(self, line: str = "") -> str:
        argv = shlex.split(line)
        # Trivially parse ``--key value`` flags without pulling argparse
        # — keeps the magic self-contained and forgiving (unknown
        # flags pass through to publish() as kwargs).
        positional: list[str] = []
        kwargs: dict[str, str] = {}
        bool_flags: set[str] = set()
        i = 0
        while i < len(argv):
            tok = argv[i]
            if tok.startswith("--"):
                key = tok[2:].replace("-", "_")
                if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                    kwargs[key] = argv[i + 1]
                    i += 2
                    continue
                bool_flags.add(key)
                i += 1
            else:
                positional.append(tok)
                i += 1

        if positional:
            notebook = _resolve_notebook(positional[0])
            if notebook is None:
                return (
                    f"❌ Notebook not found: {positional[0]}\n"
                    f"   Tried CWD ({Path.cwd()}) and parents up to 3 levels.\n"
                    f"   Tip: pass just the filename when running from the same dir."
                )
        else:
            notebook = _current_notebook_path()
            if notebook is None:
                return (
                    "❌ Couldn't detect the current notebook path. "
                    "Pass it explicitly: %astrozor_publish path/to/notebook.ipynb"
                )

        # Boolean-style flags become Python booleans on the call.
        py_kwargs: dict[str, object] = {**kwargs}
        if "execute" in bool_flags:
            py_kwargs["execute"] = True
        if "no_render" in bool_flags:
            py_kwargs["render_first"] = False

        try:
            res = publish(notebook, **py_kwargs)  # type: ignore[arg-type]
        except Exception as e:
            return f"❌ Publish failed: {e}"
        url = res.get("url") or ""
        slug = res.get("article_slug") or res.get("slug") or ""
        return (
            f"✅ Published to Astrozor — slug={slug}\n"
            f"   {url}"
        )
