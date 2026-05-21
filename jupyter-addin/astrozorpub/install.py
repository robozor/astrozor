"""IPython startup script installer.

``astrozorpub.install_startup()`` (or ``astrozorpub install-startup``
from the CLI) copies the bundled startup template into the user's
IPython profile so every new kernel auto-imports astrozorpub and
shows the floating 🔭 Publish button.

Idempotent — re-running overwrites the previous copy. Returns the
destination path so callers (CLI / tests) can confirm what landed
where.
"""

from __future__ import annotations

import shutil
from pathlib import Path


def _ipython_dir() -> Path:
    """Resolve the IPython config dir, honouring ``IPYTHONDIR`` env
    var the way IPython itself does. Falls back to ``~/.ipython``
    when IPython isn't installed yet (the install command should
    work even on a fresh box where the user hasn't run a kernel)."""
    try:
        from IPython.paths import get_ipython_dir

        return Path(get_ipython_dir())
    except Exception:
        import os

        env = os.environ.get("IPYTHONDIR", "").strip()
        if env:
            return Path(env).expanduser()
        return Path.home() / ".ipython"


def install_startup(profile: str = "default") -> Path:
    """Install the IPython startup hook so every kernel auto-loads
    astrozorpub + shows the floating publish button.

    Parameters
    ----------
    profile
        Which IPython profile to install into. ``"default"`` matches
        99 % of users; pass another name to target a custom profile.

    Returns
    -------
    Path to the installed startup file.
    """
    startup_dir = _ipython_dir() / f"profile_{profile}" / "startup"
    startup_dir.mkdir(parents=True, exist_ok=True)
    src = Path(__file__).parent / "_startup_template.py"
    dst = startup_dir / "00-astrozorpub.py"
    shutil.copyfile(src, dst)
    return dst


def uninstall_startup(profile: str = "default") -> Path | None:
    """Remove the previously-installed startup file. Returns the
    path that was deleted, or ``None`` if no file was there."""
    startup_dir = _ipython_dir() / f"profile_{profile}" / "startup"
    dst = startup_dir / "00-astrozorpub.py"
    if dst.exists():
        dst.unlink()
        return dst
    return None
