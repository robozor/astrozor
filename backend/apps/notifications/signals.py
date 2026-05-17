"""Signal handlers — create Notifications when events happen."""

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Notification, Subscription


@receiver(post_save)
def fanout_chat_message(sender, instance, created, **kwargs):  # noqa: ARG001
    """Chat Message → Notification for every subscriber of that place
    (excluding the author).
    """
    # Lazy import to avoid circular
    from apps.chat.models import Message

    if sender is not Message or not created:
        return

    place = instance.place
    subscriptions = Subscription.objects.filter(
        kind=Subscription.Kind.PLACE, target_id=place.slug
    ).exclude(user_id=instance.user_id)

    sender_name = (
        instance.user.profile.display_name or instance.user.email.split("@")[0]
        if hasattr(instance.user, "profile")
        else instance.user.email
    )
    title = f"{sender_name} → {place.name}"
    body = instance.text[:140]
    link = f"/places/{place.slug}"

    Notification.objects.bulk_create(
        [
            Notification(
                user_id=sub.user_id,
                kind=Notification.Kind.CHAT_MESSAGE,
                source_kind="place",
                source_id=place.slug,
                title=title,
                body=body,
                link=link,
            )
            for sub in subscriptions
        ]
    )


@receiver(post_save)
def fanout_checkin(sender, instance, created, **kwargs):  # noqa: ARG001
    from apps.presence.models import Checkin

    if sender is not Checkin or not created:
        return

    place = instance.place
    subscriptions = Subscription.objects.filter(
        kind=Subscription.Kind.PLACE, target_id=place.slug
    ).exclude(user_id=instance.user_id)

    sender_name = (
        "someone"
        if instance.anonymous
        else (instance.user.profile.display_name or instance.user.email.split("@")[0])
    )

    Notification.objects.bulk_create(
        [
            Notification(
                user_id=sub.user_id,
                kind=Notification.Kind.CHECKIN,
                source_kind="place",
                source_id=place.slug,
                title=f"{sender_name} → {place.name}",
                body=instance.comment[:140] if instance.comment else "Check-in",
                link=f"/places/{place.slug}",
            )
            for sub in subscriptions
        ]
    )
