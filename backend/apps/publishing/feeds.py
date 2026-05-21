"""Public discoverability surfaces for the magazine:

* ``ArticlesFeed`` — Atom feed of recent public articles
* ``article_seo_view`` — server-rendered HTML page that contains
  Open Graph + Twitter Card meta tags and JSON-LD ScholarlyArticle
  schema, and then loads the SPA. This is what social-network
  crawlers (Facebook, Mastodon, Twitter, Discord, Slack) fetch when
  they unfurl a shared link.

Both surfaces serve the same data set: published articles with
visibility=PUBLIC. MEMBERS-only articles are hidden from anon crawlers
(no preview card, no feed entry) which is consistent with our
front-end gating.
"""

from __future__ import annotations

import html
import json

from django.contrib.syndication.views import Feed
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.utils.feedgenerator import Atom1Feed, Rss201rev2Feed

from .models import Article


def _public_qs():
    return (
        Article.objects.filter(
            status=Article.Status.PUBLISHED,
            visibility=Article.Visibility.PUBLIC,
        )
        .select_related("author", "author__profile")
        .order_by("-published_at")
    )


def _author_display(user) -> str:
    if hasattr(user, "profile") and user.profile.display_name:
        return user.profile.display_name
    return user.email.split("@")[0]


def _absolute_url(request: HttpRequest, slug: str) -> str:
    scheme = "https" if request.is_secure() else "http"
    return f"{scheme}://{request.get_host()}/clanky/{slug}"


class ArticlesFeed(Feed):
    """Atom 1.0 feed at /articles.atom. RSS 2.0 also exposed at
    /articles.rss for the few clients that don't speak Atom (most do).

    Includes only PUBLIC published articles — MEMBERS visibility tier
    is excluded as a feature, not a bug: members content is gated."""

    feed_type = Atom1Feed
    title = "Astrozor — Magazín"
    link = "/clanky"
    description = "Articles from the Astrozor amateur-astronomy community"
    feed_copyright = "Various authors — CC BY 4.0 unless noted"

    def items(self):
        return _public_qs()[:30]

    def item_title(self, item: Article) -> str:
        return item.title

    def item_description(self, item: Article) -> str:
        return item.summary or item.content_md[:300]

    def item_link(self, item: Article) -> str:
        return f"/clanky/{item.slug}"

    def item_pubdate(self, item: Article):
        return item.published_at

    def item_author_name(self, item: Article) -> str:
        return _author_display(item.author)

    def item_categories(self, item: Article):
        try:
            return list(item.tags.names())
        except Exception:
            return []


class ArticlesRssFeed(ArticlesFeed):
    """Same content as ArticlesFeed but in RSS 2.0 format."""

    feed_type = Rss201rev2Feed


# ---- Server-rendered SEO page ----
#
# When a user shares https://astrozor.cz/clanky/<slug> on social media,
# the crawler fetches that URL and looks for <meta property="og:*">
# tags inside the <head>. Our SPA renders client-side so the static
# index.html has no per-article metadata — the crawler sees a generic
# "Astrozor" preview, useless for shares.
#
# This view returns a minimal HTML document with the right OG / Twitter
# / JSON-LD metadata for the article, then immediately redirects to the
# SPA via meta refresh. Real users hit the redirect within ~50 ms and
# see no flicker; crawlers parse the head and never follow the refresh.


_TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title} — Astrozor</title>
<meta name="description" content="{summary}">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{summary}">
<meta property="og:url" content="{url}">
<meta property="og:site_name" content="Astrozor">
{cover_meta}
<meta property="article:author" content="{author}">
<meta property="article:published_time" content="{published_at}">
{tags_meta}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{summary}">
{cover_twitter}
<script type="application/ld+json">{jsonld}</script>
<meta http-equiv="refresh" content="0; url=/?from=articles&amp;article={slug}">
<style>body{{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}</style>
</head>
<body>
<noscript><p>Otevírám článek… <a href="/?from=articles&amp;article={slug}" style="color:#a5b4fc">Pokračovat</a></p></noscript>
</body>
</html>
"""


def article_seo_view(request: HttpRequest, slug: str) -> HttpResponse:
    try:
        a = Article.objects.select_related("author", "author__profile").get(slug=slug)
    except Article.DoesNotExist:
        return HttpResponseRedirect("/?from=articles")

    # Anonymous-gated visibility — same rules as the SPA. We still
    # render an OG card for MEMBERS articles (title + summary) so the
    # share preview gives context, but no cover image and we redirect
    # anon users to the login page.
    if a.status != Article.Status.PUBLISHED:
        return HttpResponseRedirect("/")

    is_members_only = a.visibility == Article.Visibility.MEMBERS

    title = html.escape(a.title)
    summary = html.escape((a.summary or "")[:400])
    author = html.escape(_author_display(a.author))
    url = _absolute_url(request, a.slug)

    cover_meta = ""
    cover_twitter = ""
    if a.cover_image_url and not is_members_only:
        cover_esc = html.escape(a.cover_image_url)
        cover_meta = (
            f'<meta property="og:image" content="{cover_esc}">\n'
            f'<meta property="og:image:width" content="1200">\n'
            f'<meta property="og:image:height" content="630">'
        )
        cover_twitter = f'<meta name="twitter:image" content="{cover_esc}">'

    tags_meta_lines = []
    try:
        for tag in a.tags.names():
            tags_meta_lines.append(
                f'<meta property="article:tag" content="{html.escape(tag)}">'
            )
    except Exception:
        pass
    tags_meta = "\n".join(tags_meta_lines)

    # JSON-LD ScholarlyArticle: Google Scholar + general structured-data
    # consumers. Keep this minimal — title, author, dates, DOI when
    # present, license, abstract. Avoid `articleBody` to keep payload
    # small (we'd have to embed the rendered HTML).
    jsonld_data: dict = {
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle" if a.doi else "Article",
        "headline": a.title,
        "abstract": a.summary or "",
        "url": url,
        "datePublished": a.published_at.isoformat() if a.published_at else None,
        "dateModified": a.updated_at.isoformat(),
        "inLanguage": a.language,
        "author": {
            "@type": "Person",
            "name": _author_display(a.author),
        },
        "publisher": {
            "@type": "Organization",
            "name": "Astrozor",
            "url": f"{('https' if request.is_secure() else 'http')}://{request.get_host()}/",
        },
        "license": a.license,
    }
    if a.cover_image_url and not is_members_only:
        jsonld_data["image"] = a.cover_image_url
    if a.doi:
        jsonld_data["identifier"] = f"doi:{a.doi}"
        jsonld_data["sameAs"] = f"https://doi.org/{a.doi}"
    jsonld = json.dumps(
        {k: v for k, v in jsonld_data.items() if v is not None},
        ensure_ascii=False,
    )

    body = _TEMPLATE.format(
        lang=a.language or "cs",
        title=title,
        summary=summary,
        url=html.escape(url),
        slug=html.escape(a.slug),
        author=author,
        published_at=a.published_at.isoformat() if a.published_at else "",
        cover_meta=cover_meta,
        cover_twitter=cover_twitter,
        tags_meta=tags_meta,
        jsonld=jsonld.replace("</", "<\\/"),
    )
    response = HttpResponse(body, content_type="text/html; charset=utf-8")
    # Allow social-network crawler caches to keep it for an hour. Real
    # browsers will be redirected to the SPA almost instantly so the
    # cached HTML body is rarely re-served.
    response["Cache-Control"] = "public, max-age=3600"
    return response
