"""Publish API endpoints — token CRUD + /publish/articles."""

from __future__ import annotations

from pathlib import Path

import bleach
from django.conf import settings
from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import File, Form, Router, UploadedFile
from ninja.security import django_auth

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
from .quarto_bundle import BundleError, extract_bundle, remove_bundle
from .schemas import (
    PublishManifest,
    PublishResult,
    QuartoPublishResult,
    TokenCreateIn,
    TokenCreatedOut,
    TokenOut,
)

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
        "url": f"/clanky/{article.slug}",
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


# ---- R package version (for UI install snippet + addin update-check) ----


def _read_r_pkg_version() -> str:
    """Parse the Version: line from rstudio-addin/DESCRIPTION.

    The DESCRIPTION file is the source of truth; the r-pkg-builder Docker
    service uses the same file to bake the .tar.gz, so they stay in sync.
    We bind-mount /app/rstudio-addin if available; falls back to a literal
    if the directory isn't present (e.g. someone running api alone).
    """
    desc = Path("/app/rstudio-addin/DESCRIPTION")
    if not desc.exists():
        return "unknown"
    try:
        for raw_line in desc.read_text(encoding="utf-8").splitlines():
            if raw_line.startswith("Version:"):
                return raw_line.split(":", 1)[1].strip()
    except OSError:
        pass
    return "unknown"


@router.get("/r-pkg/info", response={200: dict})
def r_pkg_info(request: HttpRequest):
    """Metadata about the published R package — used by the frontend to
    show the install snippet (with the right host) and by the addin to
    check whether a newer version is available."""
    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    return 200, {
        "package": "astrozorpub",
        "version": _read_r_pkg_version(),
        "repos_url": f"{scheme}://{host}/R",
        "install_command": (
            f'install.packages("astrozorpub", repos = "{scheme}://{host}/R")'
        ),
    }


# ---- VS Code extension version (for docs install snippet + update-check) ----


def _read_vscode_ext_version() -> str:
    """Parse the version: line from vscode-extension/package.json.

    Same idea as _read_r_pkg_version — the manifest is the source of
    truth, the vsce-pkg-builder service produces a .vsix with the same
    version, so they stay in sync. Falls back to "unknown" when the
    directory isn't bind-mounted (e.g. running api alone).
    """
    manifest = Path("/app/vscode-extension/package.json")
    if not manifest.exists():
        return "unknown"
    try:
        import json

        data = json.loads(manifest.read_text(encoding="utf-8"))
        return str(data.get("version") or "unknown")
    except (OSError, ValueError):
        return "unknown"


@router.get("/vscode-pkg/info", response={200: dict})
def vscode_pkg_info(request: HttpRequest):
    """Metadata about the published VS Code extension — used by the docs
    page to render the install snippet (with the right host) and by the
    extension itself to surface an update prompt if needed."""
    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    version = _read_vscode_ext_version()
    base = f"{scheme}://{host}/vscode-extension"
    return 200, {
        "name": "astrozor-publish",
        "version": version,
        "vsix_latest_url": f"{base}/astrozor-publish-latest.vsix",
        "vsix_versioned_url": f"{base}/astrozor-publish-{version}.vsix",
        "install_command": (
            f'code --install-extension {base}/astrozor-publish-latest.vsix --force'
        ),
    }


# ---- Quarto bundle publish (multipart) ----


def _quarto_asset_root(user_id, slug: str) -> str:
    """Return the relative path under MEDIA_ROOT where a quarto bundle
    lives. Stable across renames (slug is unique per article, user_id
    is immutable). The path is also persisted on the Article as
    `asset_root` so renderers don't need to recompute it."""
    return f"quarto/{user_id}/{slug}"


def _quarto_asset_url(asset_root: str) -> str:
    """Public URL the iframe will load. MEDIA_URL is "/media/" in dev."""
    return f"{settings.MEDIA_URL.rstrip('/')}/{asset_root}/index.html"


def _safe_published_via(value: str) -> str:
    if value in Article.PublishedVia.values:
        return value
    return Article.PublishedVia.API


def _safe_engine_for_quarto(value: str) -> str:
    """Quarto endpoint accepts the three pre-rendered engines. Anything
    else is coerced to QUARTO (the most common case)."""
    if value in (
        Article.Engine.QUARTO,
        Article.Engine.RMARKDOWN,
        Article.Engine.JUPYTER,
    ):
        return value
    return Article.Engine.QUARTO


@router.post(
    "/publish/quarto",
    auth=[token_auth, django_auth],
    response={201: QuartoPublishResult, 400: dict, 401: dict, 403: dict, 413: dict, 507: dict},
)
def publish_quarto(
    request: HttpRequest,
    bundle: UploadedFile = File(...),  # noqa: B008
    title: str = Form(..., min_length=2, max_length=200),
    slug: str = Form(default=""),
    summary: str = Form(default=""),
    language: str = Form(default="cs"),
    engine: str = Form(default="quarto"),
    license: str = Form(default="CC BY 4.0"),
    published_via: str = Form(default="api"),
):
    """Publish a pre-rendered Quarto/RMarkdown/Jupyter HTML bundle.

    The `bundle` field must be a ZIP containing `index.html` at root +
    optional sibling assets (figures, CSS, JS). The bundle is extracted
    under MEDIA_ROOT/quarto/<user_id>/<slug>/ and served as iframe
    content from the article detail view.

    Idempotent on (user, slug): re-posting the same slug replaces the
    previous bundle in-place. If `slug` is empty, one is derived from
    the title.

    Auth: token_auth (Authorization: Bearer …) for RStudio addin / CLI,
    OR django_auth (session cookie) so logged-in users can drag-drop a
    zip in the browser without minting a token first.
    """
    # When called via token_auth, request.api_token is set and we enforce
    # the publish scope. When called via session, the user is just a
    # logged-in person uploading their own content — no scope check.
    api_token: ApiToken | None = getattr(request, "api_token", None)
    if api_token is not None:
        if ApiToken.Scope.PUBLISH_ARTICLES not in api_token.scopes:
            return 403, {"detail": "Token missing 'publish:articles' scope"}
        user = api_token.user
    else:
        user = request.user
    profile = getattr(user, "profile", None)

    # Resolve slug — explicit takes precedence; otherwise derive from title.
    requested_slug = (slug or "").strip().lower()
    if requested_slug:
        # Normalize to valid SlugField content but keep user-chosen base.
        requested_slug = slugify(requested_slug)[:120]
    if not requested_slug:
        requested_slug = slugify(title)[:120] or "article"

    # Idempotence: if an article with this slug exists and belongs to
    # the requesting user, we update; otherwise reject (slug taken by
    # another user) or create new.
    existing = Article.objects.filter(slug=requested_slug).first()
    if existing is not None and existing.author_id != user.id:
        return 400, {"detail": f"Slug '{requested_slug}' is taken by another user"}

    # Capture the pre-update bundle size for quota delta math. Read once
    # here so later overwrites of `existing.asset_bytes` don't shadow it.
    prior_bytes = existing.asset_bytes if existing is not None else 0

    # Read bundle into memory. UploadedFile may be chunked on disk; for
    # our ≤100 MB cap loading once is fine and simplifies validation.
    zip_bytes = bundle.read()

    asset_root = _quarto_asset_root(user.id, requested_slug)
    target_dir = Path(settings.MEDIA_ROOT) / asset_root

    # Pre-flight quota check using compressed size as a lower bound.
    if profile is not None:
        projected = profile.storage_used_bytes - prior_bytes + len(zip_bytes)
        if projected > profile.storage_quota_bytes:
            return 507, {"detail": "Storage quota exceeded"}

    try:
        extracted_bytes = extract_bundle(zip_bytes, target_dir)
    except BundleError as e:
        return 400, {"detail": str(e)}

    # Post-extract quota check (uncompressed is the truth). Roll back
    # the just-extracted bundle if we'd blow the cap.
    if profile is not None:
        projected = profile.storage_used_bytes - prior_bytes + extracted_bytes
        if projected > profile.storage_quota_bytes:
            remove_bundle(target_dir)
            return 507, {"detail": "Storage quota exceeded (uncompressed)"}

    safe_engine = _safe_engine_for_quarto(engine)
    now = timezone.now()

    if existing is not None:
        # Update in-place — preserve DOI, created_at, comments.
        existing.title = title
        existing.summary = summary[:400]
        existing.engine = safe_engine
        existing.language = language[:8] or "cs"
        existing.license = license or "CC BY 4.0"
        existing.asset_root = asset_root
        existing.asset_bytes = extracted_bytes
        existing.published_via = _safe_published_via(published_via)
        existing.status = Article.Status.PUBLISHED
        if existing.published_at is None:
            existing.published_at = now
        existing.save()
        article = existing
    else:
        article = Article.objects.create(
            slug=requested_slug,
            title=title,
            summary=summary[:400],
            content_md="",
            content_html="",
            engine=safe_engine,
            language=language[:8] or "cs",
            status=Article.Status.PUBLISHED,
            author=user,
            license=license or "CC BY 4.0",
            asset_root=asset_root,
            asset_bytes=extracted_bytes,
            published_via=_safe_published_via(published_via),
            published_at=now,
        )

    # Adjust per-user storage counter: subtract whatever the previous
    # bundle weighed, add what we just wrote.
    if profile is not None:
        profile.storage_used_bytes = max(
            0, profile.storage_used_bytes - prior_bytes + extracted_bytes
        )
        profile.save(update_fields=["storage_used_bytes"])

    return 201, {
        "article_slug": article.slug,
        "article_id": article.id,
        "status": article.status,
        "url": f"/clanky/{article.slug}",
        "asset_url": _quarto_asset_url(asset_root),
    }
