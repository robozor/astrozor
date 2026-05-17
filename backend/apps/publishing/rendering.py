"""Markdown → sanitized HTML.

Bleach allowlist is more permissive than chat (we want headings, lists,
code blocks, images). Inline event handlers and `<script>` are stripped.
"""

from __future__ import annotations

import bleach
import markdown_it

_md = markdown_it.MarkdownIt("commonmark", {"linkify": True, "breaks": False, "html": True})

ARTICLE_ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "b", "i", "em", "strong", "u", "s", "mark", "small",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
]
ARTICLE_ALLOWED_ATTRS = {
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "td": ["align"],
    "th": ["align"],
}

# Restrict URL schemes
ARTICLE_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def render_markdown(text: str) -> str:
    raw_html = _md.render(text)
    cleaned = bleach.clean(
        raw_html,
        tags=ARTICLE_ALLOWED_TAGS,
        attributes=ARTICLE_ALLOWED_ATTRS,
        protocols=ARTICLE_ALLOWED_PROTOCOLS,
        strip=True,
    )
    # Linkify URLs in text content
    cleaned = bleach.linkify(cleaned)
    return cleaned
