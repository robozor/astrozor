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


def callback_url(provider: str) -> str:
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

    def authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": callback_url(self.name),
            "scope": "read:user user:email",
            "state": state,
            "allow_signup": "true",
        }
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str) -> str:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                self.token_endpoint,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": callback_url(self.name),
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


def get_provider(name: str) -> GitHubProvider:
    if name == "github":
        return GitHubProvider()
    raise OAuthError(f"Unknown OAuth provider: {name}")
