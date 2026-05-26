"""Publishing API — articles + comments."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Query, Router, Schema

from .doi import mint_doi
from .models import Article, Comment
from .rendering import render_markdown
from .schemas import (
    ArticleCreateIn,
    ArticleListOut,
    ArticleOut,
    ArticlePatchIn,
    CommentIn,
    CommentListOut,
    CommentOut,
)


class PublishIn(Schema):
    # Authors must explicitly opt-in to DOI minting each time they publish.
    # Defaults to False so the publish step never accidentally burns a
    # Zenodo deposit (or hits the MOCK fallback when no token is configured).
    mint_doi: bool = False


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


def _article_tags(a: Article) -> list[str]:
    """Return tag names for an article. Wrapped in try because the
    `tags` accessor hits the DB and we want graceful behaviour during
    odd migration states (e.g. taggit tables missing in a partial deploy)."""
    try:
        return list(a.tags.names())
    except Exception:  # pragma: no cover
        return []


def _estimate_reading_minutes(text: str) -> int:
    """Rough estimate based on ~200 words/minute. Lower bound 1 min so
    the chip never says "0 min read". Falls back to 0 when no text
    (e.g. pre-rendered bundles where content_md is empty)."""
    if not text:
        return 0
    words = len(text.split())
    return max(1, round(words / 200))


def _article_out(a: Article) -> dict:
    # Pre-rendered bundles (Quarto/RMarkdown/Jupyter) live on disk and
    # the frontend loads them in a sandboxed iframe. Plain markdown
    # articles render inline from content_html.
    asset_url = ""
    if a.asset_root:
        asset_url = f"{settings.MEDIA_URL.rstrip('/')}/{a.asset_root}/index.html"
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
        "content_md": a.content_md,
        "content_html": a.content_html,
        "asset_url": asset_url,
        "published_via": a.published_via,
        "published_at": a.published_at,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
        "tags": _article_tags(a),
        "cover_image_url": a.cover_image_url,
        "visibility": a.visibility,
        "reading_minutes": a.reading_minutes,
    }


def _article_list_item(a: Article) -> dict:
    return {
        "id": a.id,
        "slug": a.slug,
        "title": a.title,
        "summary": a.summary,
        "engine": a.engine,
        "language": a.language,
        "status": a.status,
        "author_display_name": _author_display(a.author),
        # Needed by the frontend UserNameLink so clicking the author
        # opens the public-profile modal (lookup is by e-mail).
        "author_email": a.author.email,
        "doi": a.doi,
        "published_at": a.published_at,
        "created_at": a.created_at,
        "tags": _article_tags(a),
        "cover_image_url": a.cover_image_url,
        "visibility": a.visibility,
        "reading_minutes": a.reading_minutes,
    }


# ---- Articles list ----


@router.get("/articles", response={200: ArticleListOut})
def list_articles(
    request: HttpRequest,  # noqa: ARG001
    language: str | None = None,
    author: str | None = Query(default=None, description="author email or 'me' for own drafts"),
    status: str | None = None,
    tag: list[str] | None = Query(default=None, description="repeat ?tag=foo&tag=bar — AND filter"),
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

    # Anonymous visitors never see MEMBERS-only articles. Logged-in
    # users see both PUBLIC and MEMBERS in the index.
    if not request.user.is_authenticated:
        qs = qs.filter(visibility=Article.Visibility.PUBLIC)

    if language:
        qs = qs.filter(language=language)
    if status and request.user.is_staff:
        qs = qs.filter(status=status)
    if tag:
        # AND across multiple tags — every requested tag must match.
        for t in tag:
            qs = qs.filter(tags__name__iexact=t)
        qs = qs.distinct()

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
    # MEMBERS-only articles are gated for anon visitors. Authors / staff
    # always see their own.
    if a.visibility == Article.Visibility.MEMBERS and not request.user.is_authenticated:
        return 403, {"detail": "Members only"}
    return 200, _article_out(a)


# ---- Create draft ----


@router.post("/articles", response={201: ArticleOut, 401: dict})
def create_article(request: HttpRequest, payload: ArticleCreateIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if payload.engine not in Article.Engine.values:
        payload.engine = Article.Engine.MARKDOWN  # type: ignore
    html = render_markdown(payload.content_md) if payload.content_md else ""
    visibility = (
        payload.visibility
        if payload.visibility in Article.Visibility.values
        else Article.Visibility.PUBLIC
    )
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
        cover_image_url=payload.cover_image_url or "",
        visibility=visibility,
        reading_minutes=_estimate_reading_minutes(payload.content_md or ""),
    )
    clean_tags = [t.strip() for t in (payload.tags or []) if t.strip()]
    if clean_tags:
        article.tags.set(clean_tags)
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
    tags = data.pop("tags", None)  # tags are M2M — handled separately below
    # Reject unknown visibility values silently — keep existing value.
    if "visibility" in data and data["visibility"] not in Article.Visibility.values:
        data.pop("visibility")
    for field, value in data.items():
        setattr(a, field, value)
    if "content_md" in data:
        a.content_html = render_markdown(a.content_md)
        a.reading_minutes = _estimate_reading_minutes(a.content_md or "")
    a.save()
    if tags is not None:
        clean = [t.strip() for t in tags if t.strip()]
        if clean:
            a.tags.set(clean, clear=True)
        else:
            a.tags.clear()
    return 200, _article_out(a)


# ---- Publish ----


@router.post("/articles/{slug}/publish", response={200: ArticleOut, 401: dict, 403: dict, 404: dict})
def publish_article(request: HttpRequest, slug: str, payload: PublishIn = PublishIn()):
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
    # DOI minting is opt-in per publish. Re-publishing an article (e.g. to
    # restart Mastodon share flow) won't re-mint if a.doi is already set.
    if payload.mint_doi and not a.doi:
        a.doi = mint_doi(a.id, a.title, user=a.author, description=a.summary)
    if a.content_md and not a.content_html:
        a.content_html = render_markdown(a.content_md)
    a.save()

    # Mastodon share is opt-in per article via the "Sdílet na Mastodon"
    # popup in the UI (POST /api/v1/mastodon/post). No automatic cross-post
    # here so authors get to review/edit the text and pick hashtags before
    # the toot goes out.

    # Discord webhook fanout — to subscribers who opted in (optionally
    # filtered by author email).
    from apps.notifications.discord_dispatch import dispatch_event

    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    dispatch_event(
        "article_published",
        {
            "title": f"📰 Nový článek: {a.title}",
            "description": (a.summary or "")[:300],
            "url": f"{scheme}://{host}/clanky/{a.slug}",
            "fields": [
                {"name": "Autor", "value": a.author.email, "inline": True},
                {"name": "Jazyk", "value": a.language.upper(), "inline": True},
            ],
            "author_email": a.author.email,
            "actor_user_id": str(a.author.id),
        },
    )
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


def _comment_out(c: Comment) -> dict:
    return {
        "id": c.id,
        "article_slug": c.article.slug,
        "parent_id": c.parent_id,
        "user_display_name": _author_display(c.user),
        "user_email": c.user.email,
        "text": c.text,
        "attachments": c.attachments or [],
        "created_at": c.created_at,
    }


@router.get("/articles/{slug}/comments", response={200: CommentListOut, 404: dict})
def list_comments(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        a = Article.objects.get(slug=slug)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found"}
    qs = (
        Comment.objects.filter(article=a, deleted_at__isnull=True)
        .select_related("user", "user__profile", "article")
        .order_by("created_at")
    )
    items = list(qs)
    return 200, {
        "count": len(items),
        "items": [_comment_out(c) for c in items],
    }


@router.post("/articles/{slug}/comments", response={201: CommentOut, 400: dict, 401: dict, 404: dict})
def post_comment(request: HttpRequest, slug: str, payload: CommentIn):
    """Create a comment. Mirrors chat.post_message: supports threaded
    replies via parent_id, rich HTML via the shared safe-text allowlist,
    and media attachments (image/video/youtube). Length capped by the
    admin-configured MapInfra.chat_text_max_length (same as place chat)."""
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        a = Article.objects.get(slug=slug, status=Article.Status.PUBLISHED)
    except Article.DoesNotExist:
        return 404, {"detail": "Article not found or not published"}

    # Reuse chat sanitization so both surfaces share the same allowlist,
    # img-src restriction, YouTube auto-detection, and admin-configurable
    # length limit. See apps/chat/sanitize.py for the canonical definitions.
    from apps.chat.sanitize import (
        auto_youtube_attachments as _auto_youtube_attachments,
    )
    from apps.chat.sanitize import (
        safe_text as _safe_text,
    )
    from apps.chat.sanitize import (
        sanitize_attachments as _sanitize_attachments,
    )

    text = _safe_text(payload.text or "")
    attachments = _sanitize_attachments(payload.attachments or [])
    existing_yt = {att["video_id"] for att in attachments if att.get("kind") == "youtube"}
    for auto in _auto_youtube_attachments(text):
        if auto["video_id"] not in existing_yt:
            attachments.append(auto)
            existing_yt.add(auto["video_id"])

    if not text and not attachments:
        return 400, {"detail": "Comment must have text or at least one attachment"}

    parent = None
    if payload.parent_id:
        try:
            parent = Comment.objects.get(
                id=payload.parent_id, article=a, deleted_at__isnull=True
            )
        except Comment.DoesNotExist:
            return 400, {"detail": "Parent comment not found"}

    c = Comment.objects.create(
        article=a,
        user=request.user,
        parent=parent,
        text=text,
        attachments=attachments,
    )
    c.user = request.user
    c.article = a
    return 201, _comment_out(c)


@router.delete("/comments/{comment_id}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_comment(request: HttpRequest, comment_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        c = Comment.objects.get(id=comment_id, deleted_at__isnull=True)
    except (Comment.DoesNotExist, ValueError):
        return 404, {"detail": "Comment not found"}
    # Owner-only — mirrors chat policy (admins cannot delete others'
    # comments; moderation needs a separate flow with audit trail).
    if c.user_id != request.user.id:
        return 403, {"detail": "Forbidden"}
    c.deleted_at = timezone.now()
    c.save(update_fields=["deleted_at"])
    return 204, None
