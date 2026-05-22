"""Documentation API — serves Markdown pages from apps/docs/content/{lang}/.

Each page is a .md file with YAML frontmatter:

    ---
    title: "Page title"
    section: "Getting started"     # group in sidebar
    order: 10                      # sort within section (asc)
    icon: "🚀"                     # optional, prefixes sidebar entry
    ---

    Markdown body…

The slug is the filename without extension. The same slug must exist in
both languages (cs + en) so URLs are stable across language switches.
Missing translations fall back to the English version with a banner.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ninja import Router

from apps.publishing.rendering import render_markdown

router = Router(tags=["docs"])

CONTENT_ROOT = Path(__file__).resolve().parent / "content"
SUPPORTED_LANGS = ("cs", "en")
DEFAULT_LANG = "en"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL)


@dataclass
class DocPage:
    slug: str
    lang: str
    title: str
    section: str
    order: int
    icon: str
    content_md: str
    content_html: str


def _safe_lang(lang: str | None) -> str:
    if lang in SUPPORTED_LANGS:
        return lang
    return DEFAULT_LANG


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Tiny YAML-frontmatter reader for flat scalar keys. Returns
    ``(meta, body)``. Lines indented (nested) inside the frontmatter are
    ignored; we only need a handful of top-level fields."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta: dict[str, str] = {}
    for raw in m.group("body").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        if raw.startswith((" ", "\t")):
            continue
        if ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        meta[key] = value
    return meta, text[m.end():]


def _load_page(slug: str, lang: str) -> DocPage | None:
    path = CONTENT_ROOT / lang / f"{slug}.md"
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(raw)
    try:
        order = int(meta.get("order", "100"))
    except ValueError:
        order = 100
    return DocPage(
        slug=slug,
        lang=lang,
        title=meta.get("title", slug),
        section=meta.get("section", "Other"),
        order=order,
        icon=meta.get("icon", ""),
        content_md=body,
        content_html=render_markdown(body),
    )


def _list_pages(lang: str) -> list[DocPage]:
    lang_dir = CONTENT_ROOT / lang
    if not lang_dir.exists():
        return []
    pages: list[DocPage] = []
    for path in sorted(lang_dir.glob("*.md")):
        page = _load_page(path.stem, lang)
        if page is not None:
            pages.append(page)
    pages.sort(key=lambda p: (p.section, p.order, p.title))
    return pages


@router.get("/help", response={200: dict})
def list_docs(request, lang: str | None = None):
    """Return the docs TOC for the requested language. Frontend uses
    this to build the sidebar. Falls back to English for any pages that
    only exist in one language."""
    safe = _safe_lang(lang)
    pages = _list_pages(safe)
    if safe != DEFAULT_LANG:
        # Layer in English-only pages so users on `cs` still see all
        # available docs even if some haven't been translated yet.
        seen = {p.slug for p in pages}
        for fallback in _list_pages(DEFAULT_LANG):
            if fallback.slug not in seen:
                pages.append(fallback)
        pages.sort(key=lambda p: (p.section, p.order, p.title))
    return 200, {
        "lang": safe,
        "available_langs": list(SUPPORTED_LANGS),
        "pages": [
            {
                "slug": p.slug,
                "lang": p.lang,
                "title": p.title,
                "section": p.section,
                "order": p.order,
                "icon": p.icon,
            }
            for p in pages
        ],
    }


@router.get("/help/{slug}", response={200: dict, 404: dict})
def get_doc(request, slug: str, lang: str | None = None):
    """Return a single rendered doc page. Falls back to the default
    language when the requested translation doesn't exist."""
    safe = _safe_lang(lang)
    page = _load_page(slug, safe)
    fallback_used = False
    if page is None and safe != DEFAULT_LANG:
        page = _load_page(slug, DEFAULT_LANG)
        fallback_used = True
    if page is None:
        return 404, {"detail": f"Doc page '{slug}' not found"}
    return 200, {
        "slug": page.slug,
        "lang": page.lang,
        "title": page.title,
        "section": page.section,
        "order": page.order,
        "icon": page.icon,
        "content_html": page.content_html,
        "fallback_used": fallback_used,
    }
