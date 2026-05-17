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
    if name == "mastodon":
        if not instance_url:
            raise OAuthError("Mastodon requires an instance URL")
        return MastodonProvider(instance_url)
    raise OAuthError(f"Unknown OAuth provider: {name}")
