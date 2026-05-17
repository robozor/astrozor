"""Publishing API — articles + comments."""

from __future__ import annotations

from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Query, Router

from .doi import mint_doi
from .models import Article, Comment
from .rendering import render_markdown
from .schemas import (
    ArticleCreateIn,
    ArticleListItem,
    ArticleListOut,
    ArticleOut,
    ArticlePatchIn,
    CommentIn,
    CommentListOut,
    CommentOut,
)

router = Router(tags=["publishing"])


def _require_auth(request: HttpRequest):
    if not request.user.is_authenticated:
        return False
    return True


def _unique_slug(title: str) -> str:
    base = slugify(title)[:120] or "article"
    candidate = base
    i = 2
    while Article.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


def _author_display(user) -> str:
    if hasattr(user, "profile") and user.profile.display_name:
        return user.profile.display_name
    return user.email.split("@")[0]


def _article_out(a: Article) -> dict:
    return {
        "id": a.id,
        "slug": a.slug,
        "title": a.title,
        "summary": a.summary,
        "engine": a.engine,
        "language": a.language,
        "status": a.status,
        "author_email": a.author.email,
        "author_display_name": _author_display(a.author),
        "license": a.license,
        "doi": a.doi,
        "content_html": a.content_html,
        "published_at": a.published_at,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _article_list_item(a: Article) -> dict:
    return {
        "id": a.id,
        "slug": a.slug,
        "title": a.title,
        "summary": a.summary,
        "language": a.language,
        "status": a.status,
        "author_display_name": _author_display(a.author),
        "doi": a.doi,
        "published_at": a.published_at,
        "created_at": a.created_at,
    }


# ---- Articles list ----


@router.get("/articles", response={200: ArticleListOut})
def list_articles(
    request: HttpRequest,  # noqa: ARG001
    language: str | None = None,
    author: str | None = Query(default=None, description="author email or 'me' for own drafts"),
    status: str | None = None,
    limit: int = Query(default=50, le=200),
):
    qs = Article.objects.select_related("author", "author__profile")

    if author == "me" and request.user.is_authenticated:
        qs = qs.filter(author=request.user)
    elif author:
        qs = qs.filter(author__email__iexact=author).filter(status=Article.Status.PUBLISHED)
    else:
        # Default — only published
        qs = qs.filter(status=Article.Status.PUBLISHED)

    if language:
        qs = qs.filter(language=language)
    if status and request.user.is_staff:
        qs = qs.filter(status=status)

    qs = qs.order_by("-published_at", "-created_at")[:limit]
    items = list(qs)
    return 200, {"count": len(items), "items": [_article_list_item(a) for a in items]}


# ---- Get one ----


@router.get("/articles/{slug}", response={200: ArticleOut, 404: dict, 403: dict})
def get_article(request: HttpRequest, slug: str):
    try:
        a = Article.objects.select_related("author", "author__profile").get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    if a.status != Article.Status.PUBLISHED:
        if not request.user.is_authenticated or (
            a.author_id != request.user.id and not request.user.is_staff
        ):
            return 403, {"detail": "Forbidden"}
    return 200, _article_out(a)


# ---- Create draft ----


@router.post("/articles", response={201: ArticleOut, 401: dict})
def create_article(request: HttpRequest, payload: ArticleCreateIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if payload.engine not in Article.Engine.values:
        payload.engine = Article.Engine.MARKDOWN  # type: ignore
    html = render_markdown(payload.content_md) if payload.content_md else ""
    article = Article.objects.create(
        slug=_unique_slug(payload.title),
        title=payload.title,
        summary=payload.summary,
        content_md=payload.content_md,
        content_html=html,
        engine=payload.engine,
        language=payload.language or "cs",
        status=Article.Status.DRAFT,
        author=request.user,
    )
    return 201, _article_out(article)


# ---- Update ----


@router.patch("/articles/{slug}", response={200: ArticleOut, 401: dict, 403: dict, 404: dict})
def update_article(request: HttpRequest, slug: str, payload: ArticlePatchIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        a = Article.objects.get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    if a.author_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(a, field, value)
    if "content_md" in data:
        a.content_html = render_markdown(a.content_md)
    a.save()
    return 200, _article_out(a)


# ---- Publish ----


@router.post("/articles/{slug}/publish", response={200: ArticleOut, 401: dict, 403: dict, 404: dict})
def publish_article(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        a = Article.objects.get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    if a.author_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    a.status = Article.Status.PUBLISHED
    a.published_at = timezone.now()
    if not a.doi:
        a.doi = mint_doi(a.id, a.title)
    if a.content_md and not a.content_html:
        a.content_html = render_markdown(a.content_md)
    a.save()
    return 200, _article_out(a)


# ---- Delete ----


@router.delete("/articles/{slug}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_article(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        a = Article.objects.get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    if a.author_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    a.delete()
    return 204, None


# ---- Comments ----


@router.get("/articles/{slug}/comments", response={200: CommentListOut, 404: dict})
def list_comments(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        a = Article.objects.get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    qs = (
        Comment.objects.filter(article=a, deleted_at__isnull=True)
        .select_related("user", "user__profile")
        .order_by("created_at")
    )
    return 200, {
        "count": qs.count(),
        "items": [
            {
                "id": c.id,
                "article_slug": a.slug,
                "user_display_name": _author_display(c.user),
                "text": c.text,
                "created_at": c.created_at,
            }
            for c in qs
        ],
    }


@router.post("/articles/{slug}/comments", response={201: CommentOut, 401: dict, 404: dict})
def post_comment(request: HttpRequest, slug: str, payload: CommentIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        a = Article.objects.get(slug=slug, status=Article.Status.PUBLISHED)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found or not published"}
    import bleach

    text = bleach.clean(payload.text, tags=["b", "i", "em", "strong", "code", "br", "a"], strip=True)
    c = Comment.objects.create(article=a, user=request.user, text=text[:4000])
    return 201, {
        "id": c.id,
        "article_slug": a.slug,
        "user_display_name": _author_display(c.user),
        "text": c.text,
        "created_at": c.created_at,
    }


@router.delete("/comments/{comment_id}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_comment(request: HttpRequest, comment_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        c = Comment.objects.get(id=comment_id, deleted_at__isnull=True)
    except (Comment.DoesNotExist, ValueError):
        return 404, {"detail": "Comment not found"}
    if c.user_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    c.deleted_at = timezone.now()
    c.save(update_fields=["deleted_at"])
    return 204, None
