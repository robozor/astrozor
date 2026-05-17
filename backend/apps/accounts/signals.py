"""Signals: auto-create Profile when User is created."""

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile, User


@receiver(post_save, sender=User)
def create_user_profile(sender, instance: User, created: bool, **kwargs) -> None:  # noqa: ARG001
    if created:
        Profile.objects.get_or_create(user=instance)
