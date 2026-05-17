"""Accounts API — signup, login, logout, magic-link, profile."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from .emails import send_magic_link_email, send_verification_email
from .models import EmailToken, User
from .schemas import (
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
        "storage_used_bytes": profile.storage_used_bytes,
        "storage_quota_bytes": profile.storage_quota_bytes,
        "onboarding_completed": profile.onboarding_completed,
    }


# ---- Signup ----


@router.post("/auth/signup", response={201: UserOut, 400: StatusOut})
def signup(request: HttpRequest, payload: SignupIn):
    if User.objects.filter(email__iexact=payload.email).exists():
        return 400, {"status": "error", "detail": "Email already registered"}

    user = User.objects.create_user(email=payload.email, password=payload.password)
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


@router.get("/auth/magic/{token}", response={200: UserOut, 400: StatusOut})
def magic_link_consume(request: HttpRequest, token: str):
    try:
        et = EmailToken.objects.select_related("user").get(
            token=token, purpose=EmailToken.Purpose.MAGIC_LINK
        )
    except EmailToken.DoesNotExist:
        return 400, {"status": "error", "detail": "Invalid token"}

    if not et.is_valid:
        return 400, {"status": "error", "detail": "Token expired or already used"}

    et.consume()
    et.user.email_verified = True
    et.user.save(update_fields=["email_verified"])
    auth_login(request, et.user)
    return 200, _user_out(et.user)


# ---- Email verification consume ----


@router.get("/auth/verify/{token}", response={200: StatusOut, 400: StatusOut})
def verify_email(request: HttpRequest, token: str):
    try:
        et = EmailToken.objects.select_related("user").get(
            token=token, purpose=EmailToken.Purpose.VERIFY
        )
    except EmailToken.DoesNotExist:
        return 400, {"status": "error", "detail": "Invalid token"}

    if not et.is_valid:
        return 400, {"status": "error", "detail": "Token expired or already used"}

    et.consume()
    et.user.email_verified = True
    et.user.save(update_fields=["email_verified"])
    return 200, {"status": "ok", "detail": "Email verified"}


# ---- Logout ----


@router.post("/auth/logout", response={200: StatusOut})
def logout(request: HttpRequest):
    auth_logout(request)
    return 200, {"status": "ok"}


# ---- Me ----


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
