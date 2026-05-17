from django.contrib import admin

from .models import Place


@admin.register(Place)
class PlaceAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "status", "lat", "lon", "owner", "valid_to")
    list_filter = ("kind", "status")
    search_fields = ("name", "slug", "description", "address")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("id", "created_at", "updated_at")
