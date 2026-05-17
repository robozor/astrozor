"""Notification channel dispatchers.

In-app inbox is the primary channel (the Notification row IS the inbox
entry). Additional channels deliver the same content to external services
the user has configured per their profile.

Currently implemented:
- discord (webhook URL on profile.discord_webhook_url)

Deferred (T-3, T-4):
- web-push (VAPID)
- mastodon DM (per-user OAuth token)
"""

from __future__ import annotations

import logging

import httpx

from .models import Notification

logger = logging.getLogger(__name__)


def _discord_payload(n: Notification) -> dict:
    base = "http://astrozor.localhost"
    return {
        "username": "Astrozor",
        "embeds": [
            {
                "title": n.title[:256],
                "description": (n.body or "")[:2048],
                "url": f"{base}{n.link}" if n.link else None,
                "color": 0x6366F1,
                "footer": {"text": f"Astrozor · {n.kind}"},
                "timestamp": n.created_at.isoformat(),
            }
        ],
    }


def dispatch_discord(n: Notification) -> bool:
    """Send Notification to the user's Discord webhook if configured.

    Returns True if attempted and accepted, False otherwise.
    """
    profile = getattr(n.user, "profile", None)
    if profile is None:
        return False
    url = profile.discord_webhook_url
    if not url:
        return False
    # Defensive: only allow Discord webhook URLs to avoid abuse.
    if "discord.com/api/webhooks/" not in url and "discordapp.com/api/webhooks/" not in url:
        logger.warning("notifications.discord: blocked non-Discord URL for user %s", n.user_id)
        return False

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(url, json=_discord_payload(n))
    except httpx.HTTPError as e:  # pragma: no cover
        logger.warning("notifications.discord: HTTP error for user %s: %s", n.user_id, e)
        return False

    if r.status_code in (200, 204):
        return True
    logger.warning(
        "notifications.discord: webhook returned %d for user %s: %s",
        r.status_code,
        n.user_id,
        r.text[:200],
    )
    return False


def dispatch_all(n: Notification) -> None:
    """Fan a Notification out to every channel the user has enabled."""
    dispatched = []
    if dispatch_discord(n):
        dispatched.append("discord")
    if dispatched:
        logger.info("notifications.dispatch: %s for user %s", dispatched, n.user_id)
