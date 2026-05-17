from django.contrib import admin

from .models import Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("user", "place", "text_preview", "created_at", "deleted_at")
    search_fields = ("text", "user__email", "place__name")
    raw_id_fields = ("user", "place")

    def text_preview(self, obj):
        return (obj.text[:60] + "…") if len(obj.text) > 60 else obj.text
