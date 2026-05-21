"""Sitemap definitions for SEO.

Published articles each get their own /clanky/<slug> URL exposed via
the server-rendered SEO view (with OG meta). Plus a single index entry
for the magazine landing page.

Only PUBLIC articles are included — MEMBERS-only articles are
deliberately excluded so crawlers don't try to fetch them.
"""

from __future__ import annotations

from django.contrib.sitemaps import Sitemap

from .models import Article


class ArticleSitemap(Sitemap):
    changefreq = "weekly"
    priority = 0.7
    protocol = "https"

    def items(self):
        return Article.objects.filter(
            status=Article.Status.PUBLISHED,
            visibility=Article.Visibility.PUBLIC,
        ).order_by("-published_at")

    def location(self, obj: Article) -> str:
        return f"/clanky/{obj.slug}"

    def lastmod(self, obj: Article):
        return obj.updated_at


class StaticViewsSitemap(Sitemap):
    """Single hard-coded index entry for the magazine landing page."""

    changefreq = "daily"
    priority = 0.9
    protocol = "https"

    def items(self):
        return ["index"]

    def location(self, item: str) -> str:
        return "/?from=articles"
