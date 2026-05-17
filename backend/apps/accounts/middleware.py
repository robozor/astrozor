"""Middleware: set request language from authenticated user's profile."""

from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse
from django.utils import translation


class ProfileLanguageMiddleware:
    """Override request language with profile.language for authenticated users.

    Runs after AuthenticationMiddleware so request.user is populated.
    Stores the activated language so LocaleMiddleware response phase
    sets the right Content-Language header.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            profile = getattr(user, "profile", None)
            if profile is not None and profile.language:
                translation.activate(profile.language)
                request.LANGUAGE_CODE = profile.language
        return self.get_response(request)
