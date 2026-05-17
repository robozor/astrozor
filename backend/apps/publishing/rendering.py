"""Markdown → sanitized HTML.

Bleach allowlist is more permissive than chat (we want headings, lists,
code blocks, images, tables, task lists). Inline event handlers and
`<script>` are stripped.
"""

from __future__ import annotations

import bleach
import markdown_it
from mdit_py_plugins.tasklists import tasklists_plugin

# gfm-like preset enables GFM tables, strikethrough, autolinks, etc.
# tasklists_plugin adds `- [ ]` / `- [x]` checkbox support.
_md = (
    markdown_it.MarkdownIt("gfm-like", {"linkify": True, "breaks": False, "html": True})
    .use(tasklists_plugin, enabled=True)
)

ARTICLE_ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "div", "span",
    "b", "i", "em", "strong", "u", "s", "del", "mark", "small", "sub", "sup",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    # Task-list checkboxes — rendered as <input type=checkbox disabled>
    "input",
]
ARTICLE_ALLOWED_ATTRS = {
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "td": ["align", "colspan", "rowspan"],
    "th": ["align", "colspan", "rowspan"],
    "code": ["class"],
    "pre": ["class"],
    "li": ["class"],
    # Sanitize tasklist checkboxes — strip everything except these
    "input": ["type", "checked", "disabled", "class"],
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
