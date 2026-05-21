"""Astrozor URL routing."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.http import HttpResponse
from django.urls import path
from django.views.static import serve as static_serve

from apps.publishing.feeds import ArticlesFeed, ArticlesRssFeed, article_seo_view
from apps.publishing.sitemaps import ArticleSitemap, StaticViewsSitemap

from .api import api


def robots_txt(request):
    """Minimal robots.txt pointing crawlers at the sitemap."""
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /admin/\n"
        f"Sitemap: {scheme}://{host}/sitemap.xml\n"
    )
    return HttpResponse(body, content_type="text/plain")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", api.urls),
    # Discoverability surfaces — Atom/RSS feed of public articles, plus
    # a server-rendered OG/JSON-LD page per article that social-network
    # crawlers fetch when a link is shared, plus sitemap + robots.txt
    # so search engines can find everything.
    path("articles.atom", ArticlesFeed(), name="articles-feed-atom"),
    path("articles.rss", ArticlesRssFeed(), name="articles-feed-rss"),
    path("clanky/<slug:slug>", article_seo_view, name="article-seo"),
    path(
        "sitemap.xml",
        sitemap,
        {"sitemaps": {"articles": ArticleSitemap, "static": StaticViewsSitemap}},
        name="sitemap",
    ),
    path("robots.txt", robots_txt, name="robots-txt"),
]

# In DEV serve user-uploaded media + self-hosted PMTiles directly through
# Django. In production these paths are served by Caddy from the volume
# mounts.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += [
        path(
            "pmtiles/<path:path>",
            static_serve,
            {"document_root": "/var/lib/astrozor/pmtiles"},
        ),
        path(
            "lp-tiles/<path:path>",
            static_serve,
            {"document_root": "/var/lib/astrozor/light_pollution"},
        ),
    ]
