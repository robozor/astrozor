"""E-mail dispatch for auth flows (verification, magic link, password reset).

Per ADR-003: e-mail is used ONLY for auth flows, not for ongoing notifications.
"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail


def _link(path: str, token: str) -> str:
    base = getattr(settings, "PUBLIC_BASE_URL", "http://astrozor.localhost")
    return f"{base}{path}{token}/"


def send_verification_email(email: str, token: str) -> None:
    link = _link("/auth/verify/", token)
    send_mail(
        subject="Astrozor — ověření e-mailu",
        message=(
            f"Vítej v Astrozoru!\n\n"
            f"Pro ověření e-mailu klikni na následující odkaz:\n{link}\n\n"
            f"Odkaz je platný 24 hodin.\n\n"
            f"Pokud jsi se neregistroval(a), tuto zprávu ignoruj."
        ),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@astrozor.localhost"),
        recipient_list=[email],
        fail_silently=False,
    )


def send_magic_link_email(email: str, token: str) -> None:
    link = _link("/auth/magic/", token)
    send_mail(
        subject="Astrozor — přihlašovací odkaz",
        message=(
            f"Pro přihlášení do Astrozoru klikni na následující odkaz:\n{link}\n\n"
            f"Odkaz je platný 1 hodinu a lze ho použít pouze jednou.\n\n"
            f"Pokud jsi přihlášení nepožadoval(a), tuto zprávu ignoruj."
        ),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@astrozor.localhost"),
        recipient_list=[email],
        fail_silently=False,
    )
