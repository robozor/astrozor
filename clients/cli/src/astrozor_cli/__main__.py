"""Astrozor CLI entrypoint.

Usage:
    astrozor login        # interactive: prompt token, store
    astrozor whoami       # verify token
    astrozor publish PATH # publish article from a path

Path can be:
- a .md file (content_md is sent, server renders + sanitizes)
- a directory containing index.html or a manifest.json (html sent)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import typer
import yaml

app = typer.Typer(no_args_is_help=True)


CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "astrozor"
CONFIG_FILE = CONFIG_DIR / "credentials.json"


def _read_credentials() -> tuple[str, str] | None:
    if not CONFIG_FILE.exists():
        return None
    try:
        data = json.loads(CONFIG_FILE.read_text())
        return data.get("base_url"), data.get("token")
    except (json.JSONDecodeError, OSError):
        return None


def _write_credentials(base_url: str, token: str) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps({"base_url": base_url, "token": token}, indent=2))
    try:
        CONFIG_FILE.chmod(0o600)
    except OSError:
        pass


def _client() -> tuple[httpx.Client, str]:
    creds = _read_credentials()
    if not creds or not creds[0] or not creds[1]:
        typer.echo("Not logged in. Run `astrozor login`.", err=True)
        raise typer.Exit(1)
    base_url, token = creds
    return httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=30.0), token


@app.command()
def login(
    base_url: str = typer.Option("http://astrozor.localhost", "--url"),
    token: str = typer.Option(None, "--token", help="Bearer token (will prompt if omitted)"),
):
    """Save the base URL + bearer token locally."""
    if not token:
        token = typer.prompt("API token", hide_input=True)
    # Verify
    with httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=10.0) as c:
        r = c.get("/api/v1/publish/whoami")
        if r.status_code != 200:
            typer.echo(f"Token check failed: HTTP {r.status_code} — {r.text[:200]}", err=True)
            raise typer.Exit(1)
        who = r.json()
    _write_credentials(base_url, token)
    typer.echo(f"Logged in as {who['user_email']} (token: {who['token_name']}). Saved to {CONFIG_FILE}.")


@app.command()
def whoami():
    """Print the current user identified by the saved token."""
    client, _ = _client()
    with client:
        r = client.get("/api/v1/publish/whoami")
        if r.status_code != 200:
            typer.echo(f"Failed: HTTP {r.status_code} — {r.text[:200]}", err=True)
            raise typer.Exit(1)
        typer.echo(json.dumps(r.json(), indent=2))


def _build_manifest_from_path(path: Path) -> dict:
    if path.is_file() and path.suffix.lower() == ".md":
        text = path.read_text()
        title, content = _extract_md_title(text)
        return {"title": title or path.stem, "content_md": content, "engine": "markdown"}
    if path.is_dir():
        manifest = path / "manifest.json"
        if manifest.exists():
            base = json.loads(manifest.read_text())
        else:
            yml = path / "manifest.yaml"
            base = yaml.safe_load(yml.read_text()) if yml.exists() else {}
        # Pre-rendered HTML
        index = path / "index.html"
        if index.exists():
            base["html"] = index.read_text()
            base.setdefault("title", path.name)
            base.setdefault("engine", "quarto")
        return base
    raise typer.BadParameter(f"Unsupported path: {path}")


def _extract_md_title(text: str) -> tuple[str | None, str]:
    """Return (title, body) — strip the first '# title' line if present."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith("# "):
            return line.strip()[2:].strip(), "\n".join(lines[:i] + lines[i + 1 :])
    return None, text


@app.command()
def publish(
    path: Path = typer.Argument(..., exists=True, readable=True),
    language: str = typer.Option("cs", "--lang"),
    summary: str = typer.Option("", "--summary"),
):
    """Publish a Markdown file or a pre-rendered directory."""
    manifest = _build_manifest_from_path(path)
    if summary:
        manifest["summary"] = summary
    if language:
        manifest["language"] = language

    client, _ = _client()
    with client:
        r = client.post("/api/v1/publish/articles", json=manifest)
        if r.status_code != 201:
            typer.echo(f"Publish failed: HTTP {r.status_code} — {r.text[:400]}", err=True)
            raise typer.Exit(1)
        result = r.json()
    typer.echo(json.dumps(result, indent=2))


if __name__ == "__main__":
    app()
