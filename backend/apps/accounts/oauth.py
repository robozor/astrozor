"""OAuth providers — hand-rolled (no django-allauth).

One file per provider keeps the surface area small. Each provider
exposes `authorize_url(state)`, `exchange_code(code) → token`, and
`fetch_profile(token) → {provider_user_id, email, display_name, avatar_url}`.

All HTTP endpoints are env-configurable so E2E can hit a local fixture
instead of real GitHub.
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OAuthProfile:
    provider: str
    provider_user_id: str
    email: str
    display_name: str
    avatar_url: str = ""


class OAuthError(Exception):
    pass


def _env(key: str, default: str = "") -> str:
    """Return env var, treating empty string the same as missing."""
    value = os.environ.get(key)
    if value is None or value == "":
        return default
    return value


def callback_url(provider: str, request=None) -> str:
    """Compute the OAuth callback URL.

    Prefer the current request's Host header (so users can access the app via
    `http://localhost` to satisfy Google's redirect-URI requirements) and fall
    back to settings.PUBLIC_BASE_URL.
    """
    if request is not None:
        scheme = "https" if request.is_secure() else "http"
        host = request.get_host()
        return f"{scheme}://{host}/api/v1/auth/{provider}/callback"
    base = getattr(settings, "PUBLIC_BASE_URL", "http://astrozor.localhost").rstrip("/")
    return f"{base}/api/v1/auth/{provider}/callback"


def new_state() -> str:
    return secrets.token_urlsafe(24)


# ---- GitHub ----


class GitHubProvider:
    name = "github"

    def __init__(self) -> None:
        self.client_id = _env("GITHUB_OAUTH_CLIENT_ID")
        self.client_secret = _env("GITHUB_OAUTH_CLIENT_SECRET")
        # Configurable endpoints so E2E can point at a local fixture
        self.authorize_endpoint = _env(
            "GITHUB_OAUTH_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"
        )
        self.token_endpoint = _env(
            "GITHUB_OAUTH_TOKEN_URL", "https://github.com/login/oauth/access_token"
        )
        self.user_endpoint = _env("GITHUB_OAUTH_USER_URL", "https://api.github.com/user")
        self.emails_endpoint = _env(
            "GITHUB_OAUTH_EMAILS_URL", "https://api.github.com/user/emails"
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "scope": "read:user user:email repo",
            "state": state,
            "allow_signup": "true",
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={"Accept": "application/json"},
            )
        if r.status_code != 200:
            raise OAuthError(f"Token exchange failed: HTTP {r.status_code}")
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Token exchange returned no access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "Astrozor/0.x",
        }
        with httpx.Client(timeout=15.0) as client:
            ur = client.get(self.user_endpoint, headers=headers)
            er = client.get(self.emails_endpoint, headers=headers)

        if ur.status_code != 200:
            raise OAuthError(f"GH /user failed: HTTP {ur.status_code}")
        user = ur.json()

        email = user.get("email") or ""
        # Try /user/emails for the primary verified one if /user.email was null
        if not email and er.status_code == 200:
            for e in er.json():
                if e.get("primary") and e.get("verified") and e.get("email"):
                    email = e["email"]
                    break
            if not email:
                for e in er.json():
                    if e.get("email"):
                        email = e["email"]
                        break

        if not email:
            raise OAuthError("GitHub account has no usable email")

        return OAuthProfile(
            provider="github",
            provider_user_id=str(user.get("id") or user.get("login") or ""),
            email=email,
            display_name=user.get("name") or user.get("login") or email.split("@")[0],
            avatar_url=user.get("avatar_url") or "",
        )


# ---- Google ----


class GoogleProvider:
    name = "google"

    def __init__(self) -> None:
        self.client_id = _env("GOOGLE_OAUTH_CLIENT_ID")
        self.client_secret = _env("GOOGLE_OAUTH_CLIENT_SECRET")
        self.authorize_endpoint = _env(
            "GOOGLE_OAUTH_AUTHORIZE_URL", "https://accounts.google.com/o/oauth2/v2/auth"
        )
        self.token_endpoint = _env(
            "GOOGLE_OAUTH_TOKEN_URL", "https://oauth2.googleapis.com/token"
        )
        self.user_endpoint = _env(
            "GOOGLE_OAUTH_USER_URL", "https://www.googleapis.com/oauth2/v3/userinfo"
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "online",
            "prompt": "select_account",
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={"Accept": "application/json"},
            )
        if r.status_code != 200:
            raise OAuthError(
                f"Google token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Google token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {"Authorization": f"Bearer {access_token}"}
        with httpx.Client(timeout=15.0) as client:
            r = client.get(self.user_endpoint, headers=headers)
        if r.status_code != 200:
            raise OAuthError(f"Google /userinfo failed: HTTP {r.status_code}")
        u = r.json()
        email = u.get("email") or ""
        if not email:
            raise OAuthError("Google account has no email")
        # Google explicitly reports email_verified — if missing or False, reject
        if u.get("email_verified") is False:
            raise OAuthError("Google account email is not verified")
        return OAuthProfile(
            provider="google",
            provider_user_id=str(u.get("sub") or u.get("id") or ""),
            email=email,
            display_name=u.get("name") or email.split("@")[0],
            avatar_url=u.get("picture") or "",
        )


# ---- GitLab ----
#
# Standard OAuth 2.0 flow. Base URL is configurable so users can point
# at a self-hosted instance (e.g. https://git.company.com) — defaults
# to gitlab.com. Scope `read_user` returns email + name + avatar.
#
# Setup: https://gitlab.com/-/user_settings/applications (newer) or
#        https://gitlab.com/-/profile/applications (older instances)
#        → New application → Redirect URI:
#          https://<host>/api/v1/auth/gitlab/callback
#          (one URI per line if multiple environments)
#        → Confidential: yes
#        → Scopes: read_user
#
# Self-hosted: set GITLAB_OAUTH_BASE_URL=https://git.example.com


class GitLabProvider:
    name = "gitlab"

    def __init__(self) -> None:
        self.client_id = _env("GITLAB_OAUTH_CLIENT_ID")
        self.client_secret = _env("GITLAB_OAUTH_CLIENT_SECRET")
        base = _env("GITLAB_OAUTH_BASE_URL", "https://gitlab.com").rstrip("/")
        # Allow individual endpoint overrides for E2E fixtures, otherwise
        # derive from the base URL.
        self.authorize_endpoint = _env(
            "GITLAB_OAUTH_AUTHORIZE_URL", f"{base}/oauth/authorize"
        )
        self.token_endpoint = _env("GITLAB_OAUTH_TOKEN_URL", f"{base}/oauth/token")
        self.user_endpoint = _env("GITLAB_OAUTH_USER_URL", f"{base}/api/v4/user")

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "read_user",
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={"Accept": "application/json"},
            )
        if r.status_code != 200:
            raise OAuthError(
                f"GitLab token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"GitLab token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {"Authorization": f"Bearer {access_token}"}
        with httpx.Client(timeout=15.0) as client:
            r = client.get(self.user_endpoint, headers=headers)
        if r.status_code != 200:
            raise OAuthError(f"GitLab /user failed: HTTP {r.status_code}")
        u = r.json()
        email = u.get("email") or u.get("public_email") or ""
        if not email:
            raise OAuthError(
                "GitLab account has no public email. Enable 'public_email' "
                "in GitLab profile settings, or grant the read_user scope."
            )
        return OAuthProfile(
            provider="gitlab",
            provider_user_id=str(u.get("id") or u.get("username") or ""),
            email=email,
            display_name=u.get("name") or u.get("username") or email.split("@")[0],
            avatar_url=u.get("avatar_url") or "",
        )


# ---- LinkedIn (OpenID Connect — "Sign in with LinkedIn using OpenID Connect") ----
#
# Uses LinkedIn's modern OIDC flow, not the legacy v2 REST API. Scope
# "openid profile email" returns sub / email / name / picture from
# /v2/userinfo. The legacy r_liteprofile / r_emailaddress flow is
# deprecated for new apps.
#
# Setup: https://www.linkedin.com/developers/apps → "Sign In with
# LinkedIn using OpenID Connect" product → set Authorized redirect URL
# to https://<host>/api/v1/auth/linkedin/callback


class LinkedInProvider:
    name = "linkedin"

    def __init__(self) -> None:
        self.client_id = _env("LINKEDIN_OAUTH_CLIENT_ID")
        self.client_secret = _env("LINKEDIN_OAUTH_CLIENT_SECRET")
        self.authorize_endpoint = _env(
            "LINKEDIN_OAUTH_AUTHORIZE_URL",
            "https://www.linkedin.com/oauth/v2/authorization",
        )
        self.token_endpoint = _env(
            "LINKEDIN_OAUTH_TOKEN_URL",
            "https://www.linkedin.com/oauth/v2/accessToken",
        )
        self.user_endpoint = _env(
            "LINKEDIN_OAUTH_USER_URL",
            "https://api.linkedin.com/v2/userinfo",
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "openid profile email",
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
        if r.status_code != 200:
            raise OAuthError(
                f"LinkedIn token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"LinkedIn token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {"Authorization": f"Bearer {access_token}"}
        with httpx.Client(timeout=15.0) as client:
            r = client.get(self.user_endpoint, headers=headers)
        if r.status_code != 200:
            raise OAuthError(f"LinkedIn /userinfo failed: HTTP {r.status_code}")
        u = r.json()
        email = u.get("email") or ""
        if not email:
            raise OAuthError("LinkedIn account has no email")
        # LinkedIn's OIDC includes email_verified (boolean). Reject if
        # explicitly False — accept missing (treat as verified, mirrors
        # GitHub behaviour for legacy accounts).
        if u.get("email_verified") is False:
            raise OAuthError("LinkedIn account email is not verified")
        # OIDC `name` is "Given Family"; fall back if missing.
        display = u.get("name") or (
            f"{u.get('given_name', '')} {u.get('family_name', '')}".strip()
            or email.split("@")[0]
        )
        return OAuthProfile(
            provider="linkedin",
            provider_user_id=str(u.get("sub") or ""),
            email=email,
            display_name=display,
            avatar_url=u.get("picture") or "",
        )


# ---- Facebook (Meta) Login ----
#
# Uses Facebook Login OAuth 2.0. Scope `email,public_profile` returns
# id / name / email / picture from /me. Note that Facebook does NOT
# verify emails in the same way Google does — the email field is
# whatever the user typed at signup. Acceptable for casual login.
#
# Setup: https://developers.facebook.com/apps → Facebook Login → set
# Valid OAuth Redirect URI to https://<host>/api/v1/auth/facebook/callback


class FacebookProvider:
    name = "facebook"

    def __init__(self) -> None:
        self.client_id = _env("FACEBOOK_OAUTH_CLIENT_ID")
        self.client_secret = _env("FACEBOOK_OAUTH_CLIENT_SECRET")
        # Pin to a recent Graph API version. Bump when Meta deprecates;
        # they're roughly 2-year support windows.
        self.api_version = _env("FACEBOOK_OAUTH_API_VERSION", "v19.0")
        self.authorize_endpoint = _env(
            "FACEBOOK_OAUTH_AUTHORIZE_URL",
            f"https://www.facebook.com/{self.api_version}/dialog/oauth",
        )
        self.token_endpoint = _env(
            "FACEBOOK_OAUTH_TOKEN_URL",
            f"https://graph.facebook.com/{self.api_version}/oauth/access_token",
        )
        self.user_endpoint = _env(
            "FACEBOOK_OAUTH_USER_URL",
            f"https://graph.facebook.com/{self.api_version}/me",
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "email,public_profile",
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            # Facebook accepts the same params via GET or POST. Use GET
            # for parity with the rest of their Graph API.
            r = client.get(
                self.token_endpoint,
                params={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": callback_url(self.name, request=request),
                },
            )
        if r.status_code != 200:
            raise OAuthError(
                f"Facebook token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Facebook token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                self.user_endpoint,
                params={
                    "fields": "id,name,email,picture.type(large)",
                    "access_token": access_token,
                },
            )
        if r.status_code != 200:
            raise OAuthError(f"Facebook /me failed: HTTP {r.status_code}")
        u = r.json()
        email = u.get("email") or ""
        if not email:
            raise OAuthError(
                "Facebook account has no email. The user must grant the "
                "'email' permission or have a verified email on file."
            )
        # Picture comes as a nested {data: {url: ...}} blob when using
        # the field-expansion syntax.
        avatar = ""
        pic = u.get("picture")
        if isinstance(pic, dict):
            avatar = pic.get("data", {}).get("url", "") if isinstance(pic.get("data"), dict) else ""
        return OAuthProfile(
            provider="facebook",
            provider_user_id=str(u.get("id") or ""),
            email=email,
            display_name=u.get("name") or email.split("@")[0],
            avatar_url=avatar,
        )


# ---- Discord (identity + bot install combined) ----
#
# Discord OAuth supports requesting multiple scopes in one consent
# screen — we ask for `identify` (account linking) AND `bot` (install
# the Astrozor Events bot into the user's chosen server) in the same
# authorize URL. Users see ONE Discord page that:
#   1. Asks them to log in,
#   2. Lists the bot permissions,
#   3. Lets them pick the server to add the bot to.
#
# After the callback, Discord includes a `guild` parameter naming the
# server the user picked. We store the guild_id on Identity so the
# event-channel-generate flow knows where to create channels.
#
# Setup: https://discord.com/developers/applications → New Application
#        → OAuth2 (copy client_id + secret) → Redirects (add the
#        callback URL) → Bot (Add Bot, copy token).
# Permissions (decimal):
#   0x10  Manage Channels
#   0x01  Create Instant Invite
#   = 17


class DiscordProvider:
    name = "discord"
    # Bot permissions requested during OAuth install:
    #   VIEW_CHANNEL          (1024) — basic visibility
    #   MANAGE_CHANNELS       (  16) — create / edit / delete channels
    #   CREATE_INSTANT_INVITE (   1) — generate invite links
    # Total 1041. Send Messages / Embed Links etc. NOT requested — the
    # bot doesn't post anything, it just provisions a channel + invite.
    BOT_PERMISSIONS = 1041

    def __init__(self) -> None:
        self.client_id = _env("DISCORD_APP_CLIENT_ID")
        self.client_secret = _env("DISCORD_APP_CLIENT_SECRET")
        self.bot_token = _env("DISCORD_BOT_TOKEN")
        self.authorize_endpoint = _env(
            "DISCORD_OAUTH_AUTHORIZE_URL",
            "https://discord.com/api/oauth2/authorize",
        )
        self.token_endpoint = _env(
            "DISCORD_OAUTH_TOKEN_URL", "https://discord.com/api/oauth2/token"
        )
        self.user_endpoint = _env(
            "DISCORD_OAUTH_USER_URL", "https://discord.com/api/users/@me"
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.bot_token)

    def authorize_url(self, state: str, request=None) -> str:
        # Identity-only OAuth — `identify` + `email` scope, no bot.
        # Discord changed the rules in 2024 so combining `bot` with
        # `identify` in one consent screen fails with error 50040
        # regardless of redirect URI configuration. We split the flow:
        # identity links the Discord account; a SEPARATE bot-install
        # URL (see install_bot_url below) is offered as a second click
        # from Settings → Connected accounts.
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "identify email",
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def install_bot_url(self, state: str, request=None) -> str:
        """Build the dedicated bot-install authorize URL.

        Used by the "Install Astrozor bot" button shown after the
        Discord identity is connected. Discord shows a server-picker
        consent screen and installs the bot with the requested
        permissions. After the user picks a server, Discord redirects
        to our same callback (with `guild_id` query param). The
        callback handler distinguishes "identity-only" vs "bot install"
        callbacks by checking presence of `guild_id`.
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "bot applications.commands",
            "permissions": str(self.BOT_PERMISSIONS),
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if r.status_code != 200:
            raise OAuthError(
                f"Discord token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Discord token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {"Authorization": f"Bearer {access_token}"}
        with httpx.Client(timeout=15.0) as client:
            r = client.get(self.user_endpoint, headers=headers)
        if r.status_code != 200:
            raise OAuthError(f"Discord /users/@me failed: HTTP {r.status_code}")
        u = r.json()
        # Discord username is global; global_name is the optional
        # display alias. Fall back to username + discriminator pair if
        # both missing (legacy accounts).
        display = u.get("global_name") or u.get("username") or ""
        email = u.get("email") or ""
        if not email:
            raise OAuthError(
                "Discord didn't return an e-mail. Make sure the 'email' "
                "scope is requested in your app's settings."
            )
        avatar_hash = u.get("avatar") or ""
        avatar_url = (
            f"https://cdn.discordapp.com/avatars/{u.get('id')}/{avatar_hash}.png"
            if avatar_hash
            else ""
        )
        return OAuthProfile(
            provider="discord",
            provider_user_id=str(u.get("id") or ""),
            email=email,
            display_name=display,
            avatar_url=avatar_url,
        )


# ---- Zooniverse (Citizen Science integration) ----
#
# Standard OAuth 2.0 authorization-code flow against Panoptes.
#
# Setup: https://panoptes.zooniverse.org/oauth/applications → New application
#        Redirect URI: http://localhost/api/v1/auth/zooniverse/callback
#                      (and the production URL once we have a domain)
#        Confidential: yes
#        Scopes ticked in the form: User, Project, Group, Classification
#
# We exchange code → access_token (Bearer JWT) + refresh_token. Both
# get stored on the Identity row so Celery can keep them fresh and
# per-user ERAS queries work.
#
# Profile call uses Panoptes's `/api/me` (returns the JSON:API-style
# `users` envelope). The bearer is also reused as the user's identity
# token for the per-user ERAS endpoint.


class ZooniverseProvider:
    name = "zooniverse"

    def __init__(self) -> None:
        self.client_id = _env("ZOONIVERSE_OAUTH_CLIENT_ID")
        self.client_secret = _env("ZOONIVERSE_OAUTH_CLIENT_SECRET")
        base = _env("ZOONIVERSE_OAUTH_BASE_URL", "https://panoptes.zooniverse.org").rstrip("/")
        self.authorize_endpoint = _env(
            "ZOONIVERSE_OAUTH_AUTHORIZE_URL", f"{base}/oauth/authorize"
        )
        self.token_endpoint = _env("ZOONIVERSE_OAUTH_TOKEN_URL", f"{base}/oauth/token")
        self.me_endpoint = _env("ZOONIVERSE_OAUTH_ME_URL", f"{base}/api/me")
        # Scope literal — Panoptes accepts space-separated. `public` is the
        # default fall-through; we add the four resource scopes our
        # integration touches.
        self.scope = _env(
            "ZOONIVERSE_OAUTH_SCOPE", "public user project group classification"
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": self.scope,
            "state": state,
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    # Stashed by exchange_code for the callback handler to pick off when
    # it needs to persist refresh_token / expires_in. Awkward but keeps
    # the existing `exchange_code -> str` contract that the callback
    # depends on. Cleared on every exchange call.
    last_token_envelope: dict | None = None

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                },
                headers={"Accept": "application/json"},
            )
        if r.status_code != 200:
            raise OAuthError(
                f"Zooniverse token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Zooniverse token response missing access_token: {data}")
        # Hand the rest of the envelope to the caller out-of-band so it
        # can persist refresh_token / expires_in onto Identity (Phase 3
        # adds the fields). For now this is best-effort.
        self.last_token_envelope = data
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.api+json; version=1",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=15.0) as client:
            r = client.get(self.me_endpoint, headers=headers)
        if r.status_code != 200:
            raise OAuthError(f"Zooniverse /api/me failed: HTTP {r.status_code}")
        envelope = r.json()
        items = envelope.get("users") or []
        if not items:
            raise OAuthError("Zooniverse /api/me returned no user payload")
        u = items[0]
        email = u.get("email") or ""
        login = u.get("login") or ""
        display = u.get("display_name") or u.get("credited_name") or login or email.split("@")[0]
        return OAuthProfile(
            provider="zooniverse",
            provider_user_id=str(u.get("id") or ""),
            email=email,
            display_name=display,
            avatar_url=u.get("avatar_src") or "",
        )


# ---- Mastodon (dynamic per-instance app registration) ----


def _normalize_mastodon_url(raw: str) -> str:
    """Normalize a Mastodon instance URL.

    Accepts 'mastodon.social', 'https://mastodon.social', 'https://mastodon.social/' etc.
    Returns the canonical 'https://mastodon.social' (no trailing slash).
    """
    s = raw.strip().rstrip("/")
    if not s:
        raise OAuthError("Mastodon instance URL is required")
    if not s.startswith("http://") and not s.startswith("https://"):
        s = f"https://{s}"
    return s


def register_mastodon_app(instance_url: str, request=None):
    """Register Astrozor as an OAuth app on a Mastodon instance.

    Idempotent: returns the cached MastodonInstance row if one already exists
    for this URL. Otherwise POSTs to /api/v1/apps and saves the credentials.
    """
    from .models import MastodonInstance

    base = _normalize_mastodon_url(instance_url)
    existing = MastodonInstance.objects.filter(base_url=base).first()
    if existing:
        # If the redirect URI changed (e.g. user switched from astrozor.localhost
        # to localhost), re-register so Mastodon knows the new redirect.
        new_redirect = callback_url("mastodon", request=request)
        if existing.redirect_uri == new_redirect:
            return existing

    redirect = callback_url("mastodon", request=request)
    body = {
        "client_name": "Astrozor",
        "redirect_uris": redirect,
        "scopes": "read:accounts read:statuses write:statuses",
        "website": redirect.rsplit("/api/", 1)[0],
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(f"{base}/api/v1/apps", data=body)
    except httpx.HTTPError as e:
        raise OAuthError(f"Mastodon app registration failed: {e}") from e

    if r.status_code not in (200, 201):
        raise OAuthError(
            f"Mastodon /api/v1/apps returned HTTP {r.status_code}: {r.text[:200]}"
        )
    data = r.json()
    cid = data.get("client_id")
    csec = data.get("client_secret")
    if not cid or not csec:
        raise OAuthError(f"Mastodon response missing client credentials: {data}")

    obj, _created = MastodonInstance.objects.update_or_create(
        base_url=base,
        defaults={
            "client_id": cid,
            "client_secret": csec,
            "vapid_key": data.get("vapid_key", "") or "",
            "name": data.get("name", "") or "Astrozor",
            "redirect_uri": redirect,
        },
    )
    return obj


class MastodonProvider:
    """Provider bound to one specific Mastodon instance.

    Unlike GitHub/Google (one platform-wide app), Mastodon credentials are
    per-instance and stored in the MastodonInstance table after dynamic
    registration.
    """

    name = "mastodon"

    def __init__(self, instance_url: str) -> None:
        from .models import MastodonInstance

        base = _normalize_mastodon_url(instance_url)
        try:
            inst = MastodonInstance.objects.get(base_url=base)
        except MastodonInstance.DoesNotExist as e:
            raise OAuthError(
                f"Mastodon instance {base} not registered yet — call register first"
            ) from e
        self.instance = inst
        self.base_url = base
        self.client_id = inst.client_id
        self.client_secret = inst.client_secret

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def authorize_url(self, state: str, request=None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name, request=request),
            "response_type": "code",
            "scope": "read:accounts read:statuses write:statuses",
            "state": state,
        }
        return f"{self.base_url}/oauth/authorize?{urlencode(params)}"

    def exchange_code(self, code: str, request=None) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                f"{self.base_url}/oauth/token",
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url(self.name, request=request),
                    "scope": "read:accounts read:statuses write:statuses",
                },
            )
        if r.status_code != 200:
            raise OAuthError(
                f"Mastodon token exchange failed: HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token")
        if not token:
            raise OAuthError(f"Mastodon token response missing access_token: {data}")
        return token

    def fetch_profile(self, access_token: str) -> OAuthProfile:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                f"{self.base_url}/api/v1/accounts/verify_credentials",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if r.status_code != 200:
            raise OAuthError(f"Mastodon verify_credentials failed: HTTP {r.status_code}")
        u = r.json()
        username = u.get("acct") or u.get("username") or ""
        if "@" not in username:
            # Convert local acct ("alice") into "alice@instance.tld" for clarity
            host = self.base_url.replace("https://", "").replace("http://", "").rstrip("/")
            username = f"{username}@{host}" if username else ""
        # Mastodon doesn't return an email through the public API; use the handle
        # as a synthesized email so we have a unique identifier.
        synth_email = f"{u.get('username')}@{self.base_url.replace('https://', '').replace('http://', '')}"
        return OAuthProfile(
            provider="mastodon",
            provider_user_id=str(u.get("id") or u.get("username") or ""),
            email=synth_email,
            display_name=u.get("display_name") or username or synth_email,
            avatar_url=u.get("avatar_static") or u.get("avatar") or "",
        )


def get_provider(name: str, instance_url: str | None = None):
    if name == "github":
        return GitHubProvider()
    if name == "google":
        return GoogleProvider()
    if name == "gitlab":
        return GitLabProvider()
    if name == "facebook":
        return FacebookProvider()
    if name == "discord":
        return DiscordProvider()
    if name == "zooniverse":
        return ZooniverseProvider()
    if name == "mastodon":
        if not instance_url:
            raise OAuthError("Mastodon requires an instance URL")
        return MastodonProvider(instance_url)
    raise OAuthError(f"Unknown OAuth provider: {name}")
