"""Dispatch in-app events to Discord webhooks of subscribed users.

Each event source (presence/articles/events/projects/campaigns) calls
`dispatch_event(kind, payload)` exactly once per relevant action. The
dispatcher walks DiscordPreference rows, applies their per-row JSON
filters, builds a Discord embed, and POSTs it to the user's
configured webhook.

All HTTP is synchronous with a 5 s timeout — we accept up to a couple
of seconds of latency on the originating request rather than depending
on the worker container (which we don't want to restart mid-PMTiles
download). Failures are logged and swallowed.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .models import DiscordPreference

log = logging.getLogger(__name__)


def _build_embed(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Map our internal payload to a Discord embed object."""
    title = payload.get("title") or kind
    description = payload.get("description") or ""
    url = payload.get("url") or ""
    color = payload.get("color") or _color_for_kind(kind)
    fields = payload.get("fields") or []
    embed: dict[str, Any] = {
        "title": title[:256],
        "description": description[:4000],
        "color": color,
    }
    if url:
        embed["url"] = url
    if fields:
        embed["fields"] = [
            {
                "name": str(f.get("name", ""))[:256],
                "value": str(f.get("value", ""))[:1024],
                "inline": bool(f.get("inline", False)),
            }
            for f in fields[:10]
        ]
    if payload.get("footer"):
        embed["footer"] = {"text": str(payload["footer"])[:2048]}
    return embed


_COLOR_BY_KIND = {
    "place_followed_checkin": 0x22D3EE,    # cyan
    "place_any_checkin": 0xFBBF24,         # amber
    "article_published": 0x6366F1,         # indigo
    "event_status_changed": 0xF472B6,      # pink
    "project_lifecycle": 0x10B981,         # emerald
    "campaign_status_changed": 0xA78BFA,   # purple
}


def _color_for_kind(kind: str) -> int:
    return _COLOR_BY_KIND.get(kind, 0x94A3B8)  # slate fallback


def _send_webhook(webhook_url: str, embed: dict[str, Any]) -> bool:
    if not webhook_url:
        return False
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.post(
                webhook_url,
                json={"embeds": [embed], "username": "Astrozor"},
            )
        if r.status_code in (200, 204):
            return True
        log.warning(
            "Discord webhook returned HTTP %s: %s", r.status_code, r.text[:200]
        )
        return False
    except httpx.HTTPError as e:
        log.warning("Discord webhook send failed: %s", e)
        return False


def _matches(pref: DiscordPreference, payload: dict[str, Any]) -> bool:
    """Check that the payload satisfies all per-row filters.

    Empty filter lists = no filter (match everything).
    """
    f = pref.filters or {}

    def in_list(field_name: str, value: Any) -> bool:
        allowed = f.get(field_name) or []
        if not allowed:
            return True
        return value in allowed

    if pref.kind == DiscordPreference.Kind.ARTICLE_PUBLISHED:
        return in_list("author_emails", payload.get("author_email"))

    if pref.kind == DiscordPreference.Kind.EVENT_STATUS_CHANGED:
        return (
            in_list("organizer_emails", payload.get("organizer_email"))
            and in_list("event_slugs", payload.get("event_slug"))
            and in_list("to_states", payload.get("to_state"))
        )

    if pref.kind == DiscordPreference.Kind.PROJECT_LIFECYCLE:
        return in_list("actions", payload.get("action"))

    if pref.kind == DiscordPreference.Kind.CAMPAIGN_STATUS_CHANGED:
        return (
            in_list("coordinator_emails", payload.get("coordinator_email"))
            and in_list("campaign_slugs", payload.get("campaign_slug"))
            and in_list("to_states", payload.get("to_state"))
        )

    # PLACE_*_CHECKIN — no filters
    return True


def _user_eligible_for_place_followed(user_id, place_id) -> bool:
    """For PLACE_FOLLOWED_CHECKIN we additionally require that the
    receiver has a Subscription row for this place."""
    from .models import Subscription

    return Subscription.objects.filter(
        user_id=user_id, kind=Subscription.Kind.PLACE, target_id=str(place_id)
    ).exists()


def dispatch_event(kind: str, payload: dict[str, Any]) -> int:
    """Fan out `payload` to every Discord-subscribed user matching the kind.

    Returns the number of webhooks attempted (regardless of HTTP outcome).
    Never raises.
    """
    try:
        prefs = (
            DiscordPreference.objects.filter(kind=kind, enabled=True)
            .select_related("user", "user__profile")
        )
    except Exception:  # pragma: no cover
        log.exception("discord_dispatch: failed to query prefs")
        return 0

    sent = 0
    for pref in prefs:
        webhook = getattr(pref.user.profile, "discord_webhook_url", "") or ""
        if not webhook:
            continue
        # Don't notify the actor about their own action — common Discord etiquette
        actor_id = payload.get("actor_user_id")
        if actor_id and str(pref.user_id) == str(actor_id):
            continue
        # PLACE_FOLLOWED_CHECKIN: also require Subscription row
        if pref.kind == DiscordPreference.Kind.PLACE_FOLLOWED_CHECKIN:
            place_id = payload.get("place_id")
            if not place_id or not _user_eligible_for_place_followed(
                pref.user_id, place_id
            ):
                continue
        if not _matches(pref, payload):
            continue
        embed = _build_embed(kind, payload)
        _send_webhook(webhook, embed)
        sent += 1
    return sent
