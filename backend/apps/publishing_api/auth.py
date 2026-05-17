"""Bearer token authentication for the publish API."""

from __future__ import annotations

from django.http import HttpRequest
from django.utils import timezone
from ninja.security import HttpBearer

from .models import ApiToken


class TokenAuth(HttpBearer):
    def authenticate(self, request: HttpRequest, token: str):
        api_token = ApiToken.find_active(token)
        if not api_token:
            return None
        # Update last_used_at non-blockingly
        ApiToken.objects.filter(pk=api_token.pk).update(last_used_at=timezone.now())
        # Attach to request for downstream
        request.api_token = api_token  # type: ignore
        request.user = api_token.user
        return api_token


token_auth = TokenAuth()
