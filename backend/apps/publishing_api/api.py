"""Publish API endpoints — token CRUD + /publish/articles."""

from __future__ import annotations

import bleach
from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Router

from apps.publishing.doi import mint_doi
from apps.publishing.models import Article
from apps.publishing.rendering import (
    ARTICLE_ALLOWED_ATTRS,
    ARTICLE_ALLOWED_PROTOCOLS,
    ARTICLE_ALLOWED_TAGS,
    render_markdown,
)

from .auth import token_auth
from .models import ApiToken
from .schemas import PublishManifest, PublishResult, TokenCreateIn, TokenCreatedOut, TokenOut

router = Router(tags=["publishing-api"])


# ---- Token CRUD (session-authenticated; not token-authenticated to avoid loop) ----


@router.get("/accounts/tokens", response={200: list[TokenOut], 401: dict})
def list_tokens(request: HttpRequest):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    qs = ApiToken.objects.filter(user=request.user).order_by("-created_at")
    return 200, [
        {
            "id": t.id,
            "name": t.name,
            "prefix": t.prefix,
            "scopes": t.scopes,
            "expires_at": t.expires_at,
            "last_used_at": t.last_used_at,
            "revoked_at": t.revoked_at,
            "created_at": t.created_at,
        }
        for t in qs
    ]


@router.post("/accounts/tokens", response={201: TokenCreatedOut, 401: dict})
def create_token(request: HttpRequest, payload: TokenCreateIn):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    token, plaintext = ApiToken.create_for_user(
        user=request.user, name=payload.name, scopes=payload.scopes
    )
    return 201, {
        "id": token.id,
        "name": token.name,
        "prefix": token.prefix,
        "token": plaintext,
        "scopes": token.scopes,
        "created_at": token.created_at,
    }


@router.delete("/accounts/tokens/{token_id}", response={204: None, 401: dict, 404: dict})
def revoke_token(request: HttpRequest, token_id: str):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    try:
        t = ApiToken.objects.get(id=token_id, user=request.user)
    except (ApiToken.DoesNotExist, ValueError):
        return 404, {"detail": "Token not found"}
    if t.revoked_at is None:
        t.revoked_at = timezone.now()
        t.save(update_fields=["revoked_at"])
    return 204, None


# ---- Publish endpoint (token-authenticated) ----


def _unique_slug(title: str) -> str:
    base = slugify(title)[:120] or "article"
    candidate = base
    i = 2
    while Article.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


@router.post("/publish/articles", auth=token_auth, response={201: PublishResult, 400: dict, 401: dict, 403: dict})
def publish_article(request: HttpRequest, payload: PublishManifest):
    api_token: ApiToken = request.api_token  # type: ignore[attr-defined]
    if ApiToken.Scope.PUBLISH_ARTICLES not in api_token.scopes:
        return 403, {"detail": "Token missing 'publish:articles' scope"}

    if not payload.html and not payload.content_md:
        return 400, {"detail": "Either html or content_md is required"}

    # Sanitize submitted HTML strictly
    if payload.html:
        html = bleach.clean(
            payload.html,
            tags=ARTICLE_ALLOWED_TAGS,
            attributes=ARTICLE_ALLOWED_ATTRS,
            protocols=ARTICLE_ALLOWED_PROTOCOLS,
            strip=True,
        )
    else:
        html = render_markdown(payload.content_md or "")

    article = Article.objects.create(
        slug=_unique_slug(payload.title),
        title=payload.title,
        summary=payload.summary,
        content_md=payload.content_md or "",
        content_html=html,
        engine=payload.engine if payload.engine in Article.Engine.values else Article.Engine.MARKDOWN,
        language=payload.language or "cs",
        status=Article.Status.PUBLISHED,
        author=api_token.user,
        license=payload.license or "CC BY 4.0",
        published_at=timezone.now(),
    )
    article.doi = mint_doi(article.id, article.title, user=api_token.user, description=article.summary)
    article.save(update_fields=["doi"])

    return 201, {
        "article_slug": article.slug,
        "article_id": article.id,
        "doi": article.doi,
        "status": article.status,
        "url": f"/articles/{article.slug}",
    }


# Sanity endpoint for the CLI to check tokens
@router.get("/publish/whoami", auth=token_auth, response={200: dict})
def whoami(request: HttpRequest):
    api_token: ApiToken = request.api_token  # type: ignore[attr-defined]
    return 200, {
        "user_email": api_token.user.email,
        "token_name": api_token.name,
        "scopes": api_token.scopes,
    }
