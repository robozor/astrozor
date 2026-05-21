"""astrozorpub command-line interface.

Three subcommands cover the typical workflow:

* ``astrozorpub set-token <pat>`` — store a personal access token in
  ``~/.astrozor/config.json``.
* ``astrozorpub whoami`` — verify the token by hitting the server.
* ``astrozorpub publish <notebook.ipynb>`` — render + bundle + upload.

Plus ``set-base-url`` for pointing at a local dev instance.

The CLI is deliberately argparse-only (no Click / Typer) so the
package adds zero runtime deps beyond what's strictly needed for
nbconvert + the upload itself.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .config import (
    DEFAULT_BASE_URL,
    get_base_url,
    get_token,
    set_base_url,
    set_token,
    whoami,
)
from .install import install_startup, uninstall_startup
from .publish import publish


def _cmd_set_token(args: argparse.Namespace) -> int:
    set_token(args.token)
    print(f"OK — token stored. Base URL: {get_base_url()}")
    return 0


def _cmd_set_base_url(args: argparse.Namespace) -> int:
    set_base_url(args.url)
    print(f"OK — base URL set to {get_base_url()}")
    return 0


def _cmd_whoami(_args: argparse.Namespace) -> int:
    try:
        data = whoami()
    except Exception as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def _cmd_status(_args: argparse.Namespace) -> int:
    tok = get_token()
    print(f"Base URL:  {get_base_url()}")
    print(f"Token set: {'yes' if tok else 'no'}")
    if tok:
        # Show only the public prefix — never the secret tail.
        masked = tok[:12] + "…" if len(tok) > 12 else tok
        print(f"Token id:  {masked}")
    return 0


def _cmd_install_startup(args: argparse.Namespace) -> int:
    dst = install_startup(profile=args.profile)
    print(f"✅ Installed: {dst}")
    print("\nRestart any running Jupyter kernel (Kernel → Restart) to pick it up.")
    print(
        "After restart, every notebook gets a floating 🔭 Publish button "
        "in the bottom-right corner and a global publish() function."
    )
    return 0


def _cmd_uninstall_startup(args: argparse.Namespace) -> int:
    dst = uninstall_startup(profile=args.profile)
    if dst:
        print(f"✅ Removed: {dst}")
    else:
        print("Nothing to remove — no startup file installed for this profile.")
    return 0


def _cmd_publish(args: argparse.Namespace) -> int:
    nb = Path(args.notebook).expanduser().resolve()
    if not nb.is_file():
        print(f"❌ Notebook not found: {nb}", file=sys.stderr)
        return 2
    try:
        result = publish(
            nb,
            title=args.title,
            slug=args.slug,
            summary=args.summary or "",
            language=args.language,
            license=args.license,
            theme=args.theme,
            execute=args.execute,
            render_first=not args.no_render,
        )
    except Exception as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2
    url = result.get("url") or ""
    slug = result.get("article_slug") or ""
    print(f"✅ Published — slug={slug}")
    print(f"   {get_base_url()}{url}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="astrozorpub",
        description="Publish Jupyter notebooks to an Astrozor instance.",
    )
    p.add_argument("--version", action="version", version=f"astrozorpub {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("set-token", help="Store the Astrozor personal access token.")
    st.add_argument("token", help="Token starting with 'ast_pat_'.")
    st.set_defaults(func=_cmd_set_token)

    su = sub.add_parser("set-base-url", help="Point the addin at a specific Astrozor host.")
    su.add_argument(
        "url",
        help=f"Full URL (e.g. http://localhost). Default: {DEFAULT_BASE_URL}",
    )
    su.set_defaults(func=_cmd_set_base_url)

    wh = sub.add_parser("whoami", help="Verify the token by calling the server.")
    wh.set_defaults(func=_cmd_whoami)

    stt = sub.add_parser("status", help="Show the local config without contacting the server.")
    stt.set_defaults(func=_cmd_status)

    ins = sub.add_parser(
        "install-startup",
        help="Install IPython startup hook (floating Publish button in every notebook).",
    )
    ins.add_argument(
        "--profile",
        default="default",
        help="IPython profile to install into (default: 'default').",
    )
    ins.set_defaults(func=_cmd_install_startup)

    uns = sub.add_parser(
        "uninstall-startup",
        help="Remove the IPython startup hook installed by 'install-startup'.",
    )
    uns.add_argument(
        "--profile",
        default="default",
        help="IPython profile to remove from (default: 'default').",
    )
    uns.set_defaults(func=_cmd_uninstall_startup)

    pub = sub.add_parser("publish", help="Render + bundle + upload a notebook.")
    pub.add_argument("notebook", help="Path to the .ipynb file.")
    pub.add_argument("--title", help="Article title. Default: notebook stem.")
    pub.add_argument("--slug", help="URL slug. Default: derived from filename.")
    pub.add_argument("--summary", help="Short description (≤400 chars).")
    pub.add_argument("--language", default="cs", help="Language code (default: cs).")
    pub.add_argument("--license", default="CC BY 4.0", help="License string.")
    pub.add_argument(
        "--theme",
        choices=("dark", "light", "none"),
        default="dark",
        help="HTML theme override. Default: dark (matches Astrozor).",
    )
    pub.add_argument(
        "--execute",
        action="store_true",
        help="Run all cells before exporting (slow, but fresh outputs).",
    )
    pub.add_argument(
        "--no-render",
        action="store_true",
        help="Reuse an existing <stem>.html next to the notebook.",
    )
    pub.set_defaults(func=_cmd_publish)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
