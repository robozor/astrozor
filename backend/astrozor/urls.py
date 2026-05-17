"""Astrozor URL routing."""

from django.contrib import admin
from django.urls import path

from apps.core.api import api as core_api

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", core_api.urls),
]
