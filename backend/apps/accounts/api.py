"""Accounts API — signup, login, logout, magic-link, profile, OAuth."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.http import HttpRequest, HttpResponseRedirect
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from .emails import send_magic_link_email, send_verification_email
from .models import EmailToken, Identity, MastodonInstance, User  # noqa: F401
from .oauth import OAuthError, get_provider, new_state, register_mastodon_app
from .schemas import (
    IdentityOut,
    LoginIn,
    MagicLinkRequestIn,
    MeOut,
    ProfilePatch,
    SignupIn,
    StatusOut,
    UserOut,
)

router = Router(tags=["accounts"])


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "email_verified": user.email_verified,
        "display_name": user.display_name,
        "is_staff": user.is_staff,
        "created_at": user.created_at,
    }


def _profile_out(user: User) -> dict:
    profile = user.profile
    return {
        "display_name": profile.display_name,
        "bio": profile.bio,
        "avatar_url": profile.avatar_url,
        "club": profile.club,
        "equipment": profile.equipment,
        "language": profile.language,
        "timezone_name": profile.timezone_name,
        "location_lat": profile.location_lat,
        "location_lon": profile.location_lon,
        "location_label": profile.location_label,
        "location_visibility": profile.location_visibility,
        "discord_webhook_url": profile.discord_webhook_url,
        # Never echo the Zenodo token; UI shows only whether one is set
        "has_zenodo_token": bool(profile.zenodo_token),
        "zenodo_use_sandbox": profile.zenodo_use_sandbox,
        "mastodon_autopost_checkin": profile.mastodon_autopost_checkin,
        "storage_used_bytes": profile.storage_used_bytes,
        "storage_quota_bytes": profile.storage_quota_bytes,
        "onboarding_completed": profile.onboarding_completed,
    }


# ---- Signup ----


@router.post("/auth/signup", response={201: UserOut, 400: StatusOut})
def signup(request: HttpRequest, payload: SignupIn):
    if User.objects.filter(email__iexact=payload.email).exists():
        return 400, {"status": "error", "detail": "Email already registered"}

    # Bootstrap: the very first account on the instance is auto-promoted
    # to staff + superuser so the operator who installs Astrozor has the
    # Admin panel + Django admin available without manual `createsuperuser`.
    # Everyone after the first is a regular user by default.
    first_user = not User.objects.exists()

    user = User.objects.create_user(email=payload.email, password=payload.password)
    if first_user:
        user.is_staff = True
        user.is_superuser = True
        user.save(update_fields=["is_staff", "is_superuser"])
    if payload.display_name:
        user.profile.display_name = payload.display_name
        user.profile.save(update_fields=["display_name"])

    # Issue verification token (valid 24 hours via default)
    token = EmailToken.objects.create(user=user, purpose=EmailToken.Purpose.VERIFY)
    try:
        send_verification_email(user.email, token.token)
    except Exception:  # pragma: no cover — mail backend may fail in CI
        pass

    auth_login(request, user)
    return 201, _user_out(user)


# ---- Password login ----


@router.post("/auth/login", response={200: UserOut, 401: StatusOut})
def login(request: HttpRequest, payload: LoginIn):
    user = authenticate(request, username=payload.email, password=payload.password)
    if user is None:
        return 401, {"status": "error", "detail": "Invalid credentials"}
    auth_login(request, user)
    return 200, _user_out(user)


# ---- Magic link request ----


@router.post("/auth/magic-link", response={200: StatusOut})
def magic_link_request(request: HttpRequest, payload: MagicLinkRequestIn):
    # Always respond with same status — don't leak whether email is registered.
    try:
        user = User.objects.get(email__iexact=payload.email)
    except User.DoesNotExist:
        return 200, {"status": "ok", "detail": "If the email is registered, a link was sent"}

    token = EmailToken.objects.create(
        user=user,
        purpose=EmailToken.Purpose.MAGIC_LINK,
        expires_at=timezone.now() + timedelta(hours=1),
    )
    try:
        send_magic_link_email(user.email, token.token)
    except Exception:  # pragma: no cover
        pass
    return 200, {"status": "ok", "detail": "If the email is registered, a link was sent"}


# ---- Magic link consume ----


@router.get("/auth/magic/{token}")
def magic_link_consume(request: HttpRequest, token: str):
    """Consume a magic-link token: validate, log the user in, redirect home."""
    try:
        et = EmailToken.objects.select_related("user").get(
            token=token, purpose=EmailToken.Purpose.MAGIC_LINK
        )
    except EmailToken.DoesNotExist:
        return HttpResponseRedirect("/?magic_error=invalid")

    if not et.is_valid:
        return HttpResponseRedirect("/?magic_error=expired")

    et.consume()
    et.user.email_verified = True
    et.user.save(update_fields=["email_verified"])
    et.user.backend = "django.contrib.auth.backends.ModelBackend"
    auth_login(request, et.user)
    return HttpResponseRedirect("/?verified=1")


# ---- Email verification consume ----


@router.get("/auth/verify/{token}")
def verify_email(request: HttpRequest, token: str):
    """Consume a verification token: mark email verified, redirect home."""
    try:
        et = EmailToken.objects.select_related("user").get(
            token=token, purpose=EmailToken.Purpose.VERIFY
        )
    except EmailToken.DoesNotExist:
        return HttpResponseRedirect("/?verify_error=invalid")

    if not et.is_valid:
        return HttpResponseRedirect("/?verify_error=expired")

    et.consume()
    et.user.email_verified = True
    et.user.save(update_fields=["email_verified"])
    return HttpResponseRedirect("/?verified=1")


# ---- Logout ----


@router.post("/auth/logout", response={200: StatusOut})
def logout(request: HttpRequest):
    auth_logout(request)
    return 200, {"status": "ok"}


# ---- Me ----


@router.post("/auth/resend-verification", response={200: StatusOut, 401: StatusOut})
def resend_verification(request: HttpRequest):
    """Re-send the email-verification link to the currently logged-in user."""
    if not request.user.is_authenticated:
        return 401, {"status": "error", "detail": "Not authenticated"}
    user: User = request.user
    if user.email_verified:
        return 200, {"status": "ok", "detail": "already verified"}
    # Invalidate previous verify tokens
    EmailToken.objects.filter(user=user, purpose=EmailToken.Purpose.VERIFY, consumed_at__isnull=True).update(
        consumed_at=timezone.now()
    )
    token = EmailToken.objects.create(user=user, purpose=EmailToken.Purpose.VERIFY)
    try:
        send_verification_email(user.email, token.token)
    except Exception:  # pragma: no cover
        return 200, {"status": "error", "detail": "Could not send (check SMTP)"}
    return 200, {"status": "ok", "detail": "sent"}


@router.get("/auth/me", response={200: MeOut, 401: StatusOut})
def me(request: HttpRequest):
    if not request.user.is_authenticated:
        return 401, {"status": "error", "detail": "Not authenticated"}
    user = request.user
    return 200, {"user": _user_out(user), "profile": _profile_out(user)}


# ---- Profile update ----


@router.patch("/accounts/profile", response={200: MeOut, 401: StatusOut})
def update_profile(request: HttpRequest, payload: ProfilePatch):
    if not request.user.is_authenticated:
        return 401, {"status": "error", "detail": "Not authenticated"}
    user: User = request.user
    profile = user.profile
    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(profile, field, value)
    profile.save()
    return 200, {"user": _user_out(user), "profile": _profile_out(user)}


# ---- OAuth (GitHub, Google, Mastodon) ----


@router.get("/auth/providers")
def list_oauth_providers(request: HttpRequest):  # noqa: ARG001
    """Tell the frontend which OAuth providers this instance has usable.

    Defined BEFORE /auth/{provider}/start so the path doesn't match the
    catch-all parameter pattern.
    """
    from .oauth import GitHubProvider, GoogleProvider, OAuthError

    out: dict[str, bool] = {}
    for name, cls in (
        ("github", GitHubProvider),
        ("google", GoogleProvider),
    ):
        try:
            out[name] = cls().is_configured
        except OAuthError:
            out[name] = False
    # Mastodon is per-instance dynamic — handled separately, not at the
    # platform level.
    out["mastodon"] = False
    return out


_SAFE_FROM = {"map", "settings", "articles"}


def _safe_from(value: str | None) -> str:
    """Allowlist the ?from= page so we can't be tricked into open-redirect."""
    if value and value in _SAFE_FROM:
        return value
    return "map"


class MastodonRegisterIn(Schema):
    instance_url: str


@router.post("/auth/mastodon/register", response={200: dict, 400: dict})
def mastodon_register(request: HttpRequest, payload: MastodonRegisterIn):
    """Register Astrozor on a Mastodon instance and return where to redirect.

    Idempotent — re-registers if the redirect URI changed (e.g. host change).
    """
    try:
        inst = register_mastodon_app(payload.instance_url, request=request)
    except OAuthError as e:
        return 400, {"detail": str(e)}
    return 200, {
        "instance_url": inst.base_url,
        "name": inst.name,
        "start_url": f"/api/v1/auth/mastodon/start?instance={inst.base_url}&from=settings",
    }


@router.get("/auth/{provider}/start")
def oauth_start(request: HttpRequest, provider: str, **kwargs):
    """Initiate OAuth flow: store state + 'from' in session, redirect to provider.

    For Mastodon, also expects ?instance=<base_url> — the instance must
    already be registered (POST /auth/mastodon/register).
    """
    from_page = _safe_from(request.GET.get("from"))
    instance_url = request.GET.get("instance") or None
    try:
        p = get_provider(provider, instance_url=instance_url)
    except OAuthError as e:
        import logging

        logging.getLogger(__name__).warning("oauth_start: get_provider failed: %s", e)
        return HttpResponseRedirect(f"/?oauth_error={_slug(str(e))}&from={from_page}")
    if not p.is_configured:
        return HttpResponseRedirect(f"/?oauth_error=not_configured&from={from_page}")

    state = new_state()
    request.session[f"oauth_state_{provider}"] = state
    request.session[f"oauth_from_{provider}"] = from_page
    # Remember the host so the callback reconstructs the same redirect_uri.
    request.session[f"oauth_host_{provider}"] = request.get_host()
    if instance_url:
        request.session[f"oauth_instance_{provider}"] = instance_url
    return HttpResponseRedirect(p.authorize_url(state, request=request))


def _slug(s: str) -> str:
    """Reduce arbitrary text to a URL-safe slug for error reasons."""
    import re

    return re.sub(r"[^a-zA-Z0-9_-]", "_", s)[:60] or "error"


@router.get("/auth/{provider}/callback")
def oauth_callback(
    request: HttpRequest,
    provider: str,
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    """Provider redirects here with `code` and `state` (or `error`)."""
    from_page = _safe_from(request.session.pop(f"oauth_from_{provider}", None))
    instance_url = request.session.pop(f"oauth_instance_{provider}", None)

    # Provider returned an error (e.g. user denied, or instance refused).
    if error:
        detail = _slug(error_description or error)
        return HttpResponseRedirect(f"/?oauth_error={detail}&from={from_page}")

    try:
        p = get_provider(provider, instance_url=instance_url)
    except OAuthError as e:
        import logging

        logging.getLogger(__name__).warning("oauth_callback: get_provider failed: %s", e)
        return HttpResponseRedirect(f"/?oauth_error={_slug(str(e))}&from={from_page}")

    expected = request.session.pop(f"oauth_state_{provider}", None)
    if not state or expected != state:
        return HttpResponseRedirect(f"/?oauth_error=bad_state&from={from_page}")
    if not code:
        return HttpResponseRedirect(f"/?oauth_error=no_code&from={from_page}")

    try:
        token = p.exchange_code(code, request=request)
        profile = p.fetch_profile(token)
    except OAuthError as e:
        return HttpResponseRedirect(
            f"/?oauth_error={e.__class__.__name__}&from={from_page}"
        )

    # If the user is ALREADY logged in, treat this as "connect provider to my
    # existing account" rather than a fresh login.
    current_user = request.user if request.user.is_authenticated else None

    # Mastodon identity is keyed by (provider, provider_user_id, instance)
    # because user-id 42 on mastodon.social ≠ user-id 42 on fosstodon.org.
    identity = Identity.objects.filter(
        provider=profile.provider,
        provider_user_id=profile.provider_user_id,
        provider_instance=(instance_url or ""),
    ).select_related("user").first()

    if identity:
        # Existing identity — if logged in as a different user, prevent hijack
        if current_user and identity.user_id != current_user.id:
            return HttpResponseRedirect(
                f"/?oauth_error=identity_owned_by_another_user&from={from_page}"
            )
        user = identity.user
    elif current_user:
        # Logged-in user is connecting a NEW provider to their account
        identity = Identity.objects.create(
            user=current_user,
            provider=profile.provider,
            provider_user_id=profile.provider_user_id,
            provider_username=profile.display_name,
            provider_instance=instance_url or "",
            email=profile.email,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
        )
        user = current_user
    else:
        # Anonymous OAuth login — match by email or create new account.
        # Mastodon doesn't expose real e-mail so the synthesized handle
        # acts as a unique identifier instead.
        user = User.objects.filter(email__iexact=profile.email).first()
        if user is None:
            user = User.objects.create_user(email=profile.email)
            user.email_verified = True
            user.save(update_fields=["email_verified"])
            if profile.display_name:
                user.profile.display_name = profile.display_name
            if profile.avatar_url:
                user.profile.avatar_url = profile.avatar_url
            user.profile.save()
        elif not user.email_verified:
            user.email_verified = True
            user.save(update_fields=["email_verified"])
        identity = Identity.objects.create(
            user=user,
            provider=profile.provider,
            provider_user_id=profile.provider_user_id,
            provider_username=profile.display_name,
            provider_instance=instance_url or "",
            email=profile.email,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
        )

    # Store the access token so we can call the provider's API on this user's
    # behalf (option C — per-user token, higher rate limits, personal data).
    identity.access_token = token
    identity.last_login_at = timezone.now()
    identity.save(update_fields=["access_token", "last_login_at"])

    # Authenticate the session (Django backend not needed because we already
    # validated via OAuth; specify the backend explicitly).
    user.backend = "django.contrib.auth.backends.ModelBackend"
    auth_login(request, user)

    return HttpResponseRedirect(f"/?oauth_ok=1&provider={provider}&from={from_page}")


# ---- Identity management (in account settings) ----


def _identity_out(i: Identity) -> dict:
    return {
        "id": i.id,
        "provider": i.provider,
        "provider_user_id": i.provider_user_id,
        "provider_username": i.provider_username,
        "email": i.email,
        "display_name": i.display_name,
        "avatar_url": i.avatar_url,
        "has_token": bool(i.access_token),
        "last_login_at": i.last_login_at,
        "created_at": i.created_at,
    }


@router.get("/accounts/identities", response={200: list[IdentityOut], 401: StatusOut})
def list_identities(request: HttpRequest):
    if not request.user.is_authenticated:
        return 401, {"status": "error", "detail": "Not authenticated"}
    qs = Identity.objects.filter(user=request.user).order_by("-created_at")
    return 200, [_identity_out(i) for i in qs]


@router.delete("/accounts/identities/{identity_id}", response={204: None, 401: StatusOut, 404: StatusOut})
def disconnect_identity(request: HttpRequest, identity_id: str):
    if not request.user.is_authenticated:
        return 401, {"status": "error", "detail": "Not authenticated"}
    try:
        i = Identity.objects.get(id=identity_id, user=request.user)
    except (Identity.DoesNotExist, ValueError):
        return 404, {"status": "error", "detail": "Identity not found"}
    # Don't lock the user out: refuse to delete the LAST identity if user has
    # no usable password.
    if not request.user.has_usable_password() and request.user.identities.count() == 1:
        return 401, {"status": "error", "detail": "Cannot disconnect last identity without a password"}
    i.delete()
    return 204, None
