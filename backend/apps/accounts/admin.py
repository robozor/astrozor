"""Django admin for User and Profile."""

from __future__ import annotations

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import EmailToken, Profile, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("email", "email_verified", "is_staff", "is_active", "created_at")
    list_filter = ("email_verified", "is_staff", "is_active")
    search_fields = ("email",)
    ordering = ("-created_at",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Status", {"fields": ("email_verified", "is_active", "is_staff", "is_superuser")}),
        ("Permissions", {"fields": ("groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )
    readonly_fields = ("created_at", "updated_at", "last_login")


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "language", "location_visibility")
    search_fields = ("user__email", "display_name")
    list_filter = ("language", "location_visibility")


@admin.register(EmailToken)
class EmailTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "purpose", "created_at", "expires_at", "consumed_at")
    list_filter = ("purpose",)
    search_fields = ("user__email",)
    readonly_fields = ("token", "created_at", "expires_at", "consumed_at")
