"""Token + base URL persistence for the Jupyter addin.

Tokens live in ``~/.astrozor/config.json`` so they survive across
Python interpreters / notebooks. The R addin uses ``~/.Renviron``
because that's RStudio's convention; here we use a JSON config
file because Python has no equivalent "loaded on startup" rc file
that's discoverable across plain Python, JupyterLab, and CLI use.

Environment variables ``ASTROZOR_TOKEN`` and ``ASTROZOR_BASE_URL``
override the file values when set — handy for CI / containerised
notebooks where mounting a config file would be inconvenient.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://astrozor.cz"


def _config_path() -> Path:
    """Resolve the JSON config path. Honours ``ASTROZOR_CONFIG`` for
    callers who want a different location (per-project tokens, etc.)."""
    override = os.environ.get("ASTROZOR_CONFIG", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".astrozor" / "config.json"


def _read_config() -> dict[str, Any]:
    path = _config_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_config(cfg: dict[str, Any]) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    try:
        # Best-effort permission tighten on POSIX so the token isn't
        # group/world-readable. Silently skip on platforms where chmod
        # is meaningless (Windows).
        path.chmod(0o600)
    except OSError:
        pass


def set_token(token: str) -> None:
    """Persist an Astrozor personal access token (``ast_pat_…``).

    The token is also exported into ``os.environ`` so the current
    Python process picks it up without a restart — matching the
    R addin's "set-and-use-immediately" UX.
    """
    if not isinstance(token, str) or not token.strip():
        raise ValueError("token must be a non-empty string")
    token = token.strip()
    cfg = _read_config()
    cfg["token"] = token
    _write_config(cfg)
    os.environ["ASTROZOR_TOKEN"] = token


def get_token() -> str | None:
    """Resolve the active token. Env var wins over the config file
    so CI / Docker overrides Just Work."""
    env = os.environ.get("ASTROZOR_TOKEN", "").strip()
    if env:
        return env
    cfg = _read_config()
    tok = cfg.get("token")
    return tok if isinstance(tok, str) and tok else None


def set_base_url(url: str) -> None:
    """Persist the Astrozor instance URL (e.g. ``http://localhost``).

    Trailing slash is stripped so callers can concatenate paths
    without worrying about double slashes.
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError("url must be a non-empty string")
    url = url.strip().rstrip("/")
    cfg = _read_config()
    cfg["base_url"] = url
    _write_config(cfg)
    os.environ["ASTROZOR_BASE_URL"] = url


def get_base_url() -> str:
    env = os.environ.get("ASTROZOR_BASE_URL", "").strip().rstrip("/")
    if env:
        return env
    cfg = _read_config()
    url = cfg.get("base_url")
    if isinstance(url, str) and url:
        return url.rstrip("/")
    return DEFAULT_BASE_URL


def whoami() -> dict[str, Any]:
    """Sanity-check the configured token by hitting
    ``/api/v1/publish/whoami``. Returns the parsed response or raises
    on any non-2xx (so the user gets a clear error in a notebook cell).
    """
    token = get_token()
    if not token:
        raise RuntimeError(
            "No Astrozor token set. Call astrozorpub.set_token('ast_pat_…') first."
        )
    url = f"{get_base_url()}/api/v1/publish/whoami"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "astrozorpub-py/0.1.0",
    }
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, headers=headers)
    if r.status_code != 200:
        raise RuntimeError(
            f"whoami failed: HTTP {r.status_code} — {r.text[:240]}"
        )
    return r.json()
