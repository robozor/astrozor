"""Discord bot API client for the auto-generate event channel flow.

After a user installs the Astrozor Events bot into their Discord
server (via the combined OAuth in apps.accounts.oauth.DiscordProvider),
we can use the bot's static token to provision a text channel +
invite link for any of that user's events. Helpers here are thin
wrappers around Discord's REST API:

  * ``create_text_channel(guild_id, name, topic)`` →
    POST /guilds/{guild_id}/channels
  * ``create_invite(channel_id, max_age=0)`` →
    POST /channels/{channel_id}/invites

Both raise :class:`DiscordBotError` on non-2xx responses so callers
can surface the failure to the organizer (rate limit, missing perms,
guild gone, …).
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://discord.com/api/v10"


class DiscordBotError(Exception):
    """Discord REST API call failed. ``status`` mirrors HTTP code."""

    def __init__(self, status: int, detail: str):
        super().__init__(f"Discord API {status}: {detail}")
        self.status = status
        self.detail = detail


def _token() -> str:
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    if not token:
        raise DiscordBotError(0, "DISCORD_BOT_TOKEN not configured")
    return token


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bot {_token()}",
        "Content-Type": "application/json",
        # Discord asks for a user-agent so they can identify integrations.
        "User-Agent": "AstrozorEventsBot/1.0 (https://astrozor.cz)",
    }


# Discord channel names are kebab-case, lowercase, no special chars.
# Slug-style: alpha-numeric + dashes, 2-100 chars.
_NAME_SAFE = re.compile(r"[^a-z0-9\-]+")


def safe_channel_name(name: str, prefix: str = "event-") -> str:
    """Convert a free-form title into a Discord-friendly channel name.

    Examples:
        "M31 — průvodce" → "event-m31-pruvodce"
        "Astrozor #2026" → "event-astrozor-2026"
    """
    lower = name.lower()
    # Remove diacritics best-effort (Czech / German common cases).
    diacritic_map = str.maketrans(
        "áčďéěíňóřšťúůýž", "acdeeinorstuuyz"
    )
    lower = lower.translate(diacritic_map)
    cleaned = _NAME_SAFE.sub("-", lower).strip("-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    if not cleaned:
        cleaned = "event"
    full = f"{prefix}{cleaned}"
    return full[:100]


def create_text_channel(
    guild_id: str,
    name: str,
    topic: str = "",
    category_id: str | None = None,
) -> dict[str, Any]:
    """Create a text channel in the given guild. Returns the channel
    JSON from Discord (id, name, etc.). Raises DiscordBotError on
    failure (missing perms, guild not found, rate-limit, …).
    """
    payload: dict[str, Any] = {
        "name": name,
        "type": 0,  # GUILD_TEXT
        "topic": topic[:1024],  # Discord limit
    }
    if category_id:
        payload["parent_id"] = category_id
    with httpx.Client(timeout=15.0) as client:
        r = client.post(
            f"{API_BASE}/guilds/{guild_id}/channels",
            headers=_headers(),
            json=payload,
        )
    if r.status_code >= 300:
        # Discord returns {message, code} on errors. Surface that to the
        # caller; common cases: 403 missing perms, 404 guild gone, 429
        # rate-limited.
        detail = ""
        try:
            j = r.json()
            detail = j.get("message", "") or str(j)
        except Exception:
            detail = r.text[:200]
        logger.warning("Discord create_text_channel failed: %s %s", r.status_code, detail)
        raise DiscordBotError(r.status_code, detail)
    return r.json()


def create_invite(
    channel_id: str,
    max_age: int = 0,
    max_uses: int = 0,
    unique: bool = True,
) -> dict[str, Any]:
    """Create an invite for a channel. Defaults to no expiry, no use
    limit (suitable for the event link we hand out to participants).

    Returns the invite JSON including ``code`` (the 8-char invite
    code) and ``url`` (we synthesise the full URL because Discord's
    response only includes the code).
    """
    payload = {
        "max_age": max_age,    # 0 = never expires
        "max_uses": max_uses,  # 0 = no use limit
        "temporary": False,
        "unique": unique,
    }
    with httpx.Client(timeout=15.0) as client:
        r = client.post(
            f"{API_BASE}/channels/{channel_id}/invites",
            headers=_headers(),
            json=payload,
        )
    if r.status_code >= 300:
        detail = ""
        try:
            detail = r.json().get("message", "") or r.text[:200]
        except Exception:
            detail = r.text[:200]
        logger.warning("Discord create_invite failed: %s %s", r.status_code, detail)
        raise DiscordBotError(r.status_code, detail)
    data = r.json()
    code = data.get("code", "")
    data["url"] = f"https://discord.gg/{code}" if code else ""
    return data


def fetch_guild(guild_id: str) -> dict[str, Any]:
    """Look up a guild's name + icon. Used to display the bound server
    name in the user's Connected Accounts list."""
    with httpx.Client(timeout=15.0) as client:
        r = client.get(
            f"{API_BASE}/guilds/{guild_id}",
            headers=_headers(),
        )
    if r.status_code >= 300:
        detail = ""
        try:
            detail = r.json().get("message", "") or r.text[:200]
        except Exception:
            detail = r.text[:200]
        raise DiscordBotError(r.status_code, detail)
    return r.json()
