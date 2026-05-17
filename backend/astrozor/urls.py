"""Astrozor URL routing."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path
from django.views.static import serve as static_serve

from .api import api

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", api.urls),
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
    ]
