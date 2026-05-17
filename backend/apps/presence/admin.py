from django.contrib import admin

from .models import Checkin


@admin.register(Checkin)
class CheckinAdmin(admin.ModelAdmin):
    list_display = ("user", "place", "anonymous", "created_at", "expires_at", "ended_at")
    list_filter = ("anonymous",)
    search_fields = ("user__email", "place__name", "comment")
    raw_id_fields = ("user", "place")
