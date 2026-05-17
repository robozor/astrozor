from __future__ import annotations

import logging

import httpx

from .models import Identity

log = logging.getLogger(__name__)


def post_status(user, text: str, *, visibility: str = "public") -> dict | None:
    """Cross-post `text` to the user's connected Mastodon instance.

    Returns the Mastodon API response dict on success, or None if the user
    has no Mastodon identity / no access_token / the call fails. Never raises
    — cross-post failures must not block the originating action (e.g. article
    publish).
    """
    try:
        identity = Identity.objects.filter(
            user=user, provider="mastodon"
        ).exclude(access_token="").first()
    except Exception:
        return None
    if not identity or not identity.access_token or not identity.provider_instance:
        return None

    base = identity.provider_instance.rstrip("/")
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                f"{base}/api/v1/statuses",
                headers={"Authorization": f"Bearer {identity.access_token}"},
                data={"status": text, "visibility": visibility},
            )
        if r.status_code in (200, 201):
            return r.json()
        log.warning(
            "Mastodon cross-post returned %s: %s",
            r.status_code,
            r.text[:200],
        )
    except httpx.HTTPError as e:
        log.warning("Mastodon cross-post failed: %s", e)
    return None
