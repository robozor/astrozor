"""Signals: auto-create Profile on User create + capture login origin (IP + GeoIP)."""

from __future__ import annotations

import logging

from django.contrib.auth.signals import user_logged_in
from django.db.models.signals import post_save
from django.dispatch import receiver

from .geoip import client_ip_from_request, resolve
from .models import Profile, User

log = logging.getLogger(__name__)


@receiver(post_save, sender=User)
def create_user_profile(sender, instance: User, created: bool, **kwargs) -> None:  # noqa: ARG001
    if created:
        Profile.objects.get_or_create(user=instance)


@receiver(user_logged_in)
def capture_login_origin(sender, request, user, **kwargs) -> None:  # noqa: ARG001
    """Record the IP + best-effort GeoIP location on every successful login.

    Fires for password login, magic-link login and OAuth callbacks
    (anything that calls Django's `login()`). Failures are swallowed so
    a transient GeoIP provider outage doesn't block login.
    """
    try:
        ip = client_ip_from_request(request) if request is not None else ""
        info = resolve(ip) if ip else None
        user.last_login_ip = ip or None
        user.last_login_country = info.country if info else ""
        user.last_login_country_code = info.country_code if info else ""
        user.last_login_city = info.city if info else ""
        user.save(
            update_fields=[
                "last_login_ip",
                "last_login_country",
                "last_login_country_code",
                "last_login_city",
                "updated_at",
            ]
        )
    except Exception:  # pragma: no cover
        log.exception("capture_login_origin failed")
