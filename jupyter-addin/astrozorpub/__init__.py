"""astrozorpub — publish Jupyter notebooks to an Astrozor instance.

Mirrors the R-package addin (``rstudio-addin/``) in shape: a tiny
config layer, an nbconvert-driven HTML renderer, a bundler that
zips the rendered notebook + assets, and a publish helper that
POSTs everything to ``/api/publish/quarto`` (engine=jupyter).

Quick start::

    import astrozorpub

    astrozorpub.set_base_url("http://localhost")
    astrozorpub.set_token("ast_pat_xxx")
    astrozorpub.whoami()
    astrozorpub.publish("analysis.ipynb", title="My analysis")

Or via the CLI::

    astrozorpub set-token ast_pat_xxx
    astrozorpub publish analysis.ipynb --title "My analysis"

Inside a Jupyter notebook, the magic provides one-line publish::

    %load_ext astrozorpub
    %astrozor_publish --title "My analysis"
"""

from __future__ import annotations

from .config import (
    get_base_url,
    get_token,
    set_base_url,
    set_token,
    whoami,
)
from .install import install_startup, uninstall_startup
from .publish import bundle, publish, render

# ``publish_widget`` is a thin ipywidgets-based dialog — useful when
# the user wants a "click to publish" UX without setting up the
# full JupyterLab extension. Imported lazily so plain Python users
# don't pull in ipywidgets unnecessarily.
def publish_widget(*args, **kwargs):
    """Render the publish form in a notebook cell. See
    :mod:`astrozorpub.widget` for the full docstring.

    Lazily imports ipywidgets so plain Python use doesn't fail when
    the optional ``[widgets]`` extra isn't installed.
    """
    from .widget import publish_widget as _w

    return _w(*args, **kwargs)


__all__ = [
    "bundle",
    "get_base_url",
    "get_token",
    "install_startup",
    "publish",
    "publish_widget",
    "render",
    "set_base_url",
    "set_token",
    "uninstall_startup",
    "whoami",
]

# IPython exposes ``load_ipython_extension`` for magic registration.
# The function is imported lazily so plain Python use doesn't drag
# in IPython.
def load_ipython_extension(ipython):  # pragma: no cover - thin shim
    from .magic import AstrozorMagics

    ipython.register_magics(AstrozorMagics)


__version__ = "0.1.0"
