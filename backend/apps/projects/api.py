from __future__ import annotations

from django.http import HttpRequest
from django.utils.text import slugify
from ninja import Router

from ninja import Schema

from apps.chat.schemas import MessageIn, MessageListOut, MessageOut

from .github import (
    _render_gh_markdown,
    fetch_issue_detail,
    fetch_repo_issues,
    fetch_repo_metadata,
    post_issue_comment,
    refresh_repo_commit_cache,
)
from .models import GHRepo, Membership, Project
from .schemas import (
    GHActivityOut,
    GHIssueCommentIn,
    GHIssueDetailOut,
    GHRepoIn,
    GHRepoOut,
    ProjectIn,
    ProjectMemberOut,
    ProjectOut,
    ProjectPatchIn,
)


class IssueClaimIn(Schema):
    body: str = ""

router = Router(tags=["projects"])


def _require_auth(request: HttpRequest):
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


def _project_out(p: Project, *, user=None) -> dict:
    is_member = False
    if user and user.is_authenticated:
        is_member = p.memberships.filter(user=user).exists()
    can_edit = False
    if user and user.is_authenticated:
        can_edit = bool(p.created_by_id == user.id or user.is_staff)
    return {
        "id": p.id,
        "slug": p.slug,
        "name": p.name,
        "description": p.description,
        "visibility": p.visibility,
        "status": p.status,
        "language": p.language,
        "created_by_email": p.created_by.email,
        "member_count": p.memberships.count(),
        "repo_count": p.gh_repos.count(),
        "created_at": p.created_at,
        "tags": list(p.tags.names()) if p.id else [],
        "is_member": is_member,
        "can_edit": can_edit,
    }


def _repo_out(r: GHRepo) -> dict:
    return {
        "id": r.id,
        "project_slug": r.project.slug,
        "full_name": r.full_name,
        "description": r.description,
        "stars": r.stars,
        "forks": r.forks,
        "language": r.language,
        "open_issues": r.open_issues,
        "default_branch": r.default_branch,
        "last_commit_at": r.last_commit_at,
        "html_url": r.html_url,
        "last_fetched_at": r.last_fetched_at,
        "last_status": r.last_status,
        "last_release_tag": r.last_release_tag,
        "last_release_name": r.last_release_name,
        "last_release_at": r.last_release_at,
        "last_release_url": r.last_release_url,
        "top_contributors": r.top_contributors or [],
        "topics": r.topics or [],
    }


def _can_view_project(p: Project, user) -> bool:
    """Visibility gate shared by detail, members and issue-chat
    endpoints.

    * ``public``  → open to anyone (anon included)
    * ``internal`` → any authenticated Astrozor user
    * ``private`` → only project members (Membership) + staff
    """
    if p.visibility == Project.Visibility.PUBLIC:
        return True
    if not user or not user.is_authenticated:
        return False
    if p.visibility == "internal":
        return True
    return p.memberships.filter(user=user).exists() or user.is_staff


def _can_edit_project(p: Project, user) -> bool:
    """Creator + staff. Future: maintainer role could edit too."""
    if not user or not user.is_authenticated:
        return False
    return p.created_by_id == user.id or bool(user.is_staff)


def _unique_slug(name: str) -> str:
    base = slugify(name)[:100] or "project"
    candidate = base
    i = 2
    while Project.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


# ---- Projects ----


@router.get("/projects", response={200: list[ProjectOut]})
def list_projects(request: HttpRequest, tag: list[str] | None = None):
    from django.db.models import Q

    qs = Project.objects.select_related("created_by")
    if _require_auth(request):
        qs = qs.filter(
            Q(visibility=Project.Visibility.PUBLIC) | Q(memberships__user=request.user)
        ).distinct()
    else:
        qs = qs.filter(visibility=Project.Visibility.PUBLIC)
    if tag:
        for t in tag:
            qs = qs.filter(tags__name__iexact=t)
        qs = qs.distinct()
    user = request.user if request.user.is_authenticated else None
    return 200, [_project_out(p, user=user) for p in qs[:200]]


@router.get("/projects/{slug}", response={200: ProjectOut, 403: dict, 404: dict})
def get_project(request: HttpRequest, slug: str):
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if not _can_view_project(p, request.user):
        return 403, {"detail": "Forbidden"}
    user = request.user if request.user.is_authenticated else None
    return 200, _project_out(p, user=user)


@router.post("/projects", response={201: ProjectOut, 401: dict})
def create_project(request: HttpRequest, payload: ProjectIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    project = Project.objects.create(
        slug=_unique_slug(payload.name),
        name=payload.name,
        description=payload.description,
        visibility=payload.visibility,
        language=payload.language,
        created_by=request.user,
    )
    clean_tags = [t.strip() for t in (payload.tags or []) if t.strip()]
    if clean_tags:
        project.tags.set(clean_tags)
    Membership.objects.create(project=project, user=request.user, role=Membership.Role.OWNER)

    from apps.notifications.discord_dispatch import dispatch_event

    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    dispatch_event(
        "project_lifecycle",
        {
            "title": f"🆕 Nový projekt: {project.name}",
            "description": (project.description or "")[:300],
            "url": f"{scheme}://{host}/projects/{project.slug}",
            "fields": [
                {"name": "Autor", "value": project.created_by.email, "inline": True},
                {"name": "Viditelnost", "value": project.visibility, "inline": True},
            ],
            "action": "created",
            "actor_user_id": str(request.user.id),
        },
    )
    return 201, _project_out(project, user=request.user)


@router.patch(
    "/projects/{slug}",
    response={200: ProjectOut, 401: dict, 403: dict, 404: dict},
)
def update_project(request: HttpRequest, slug: str, payload: ProjectPatchIn):
    """Owner or staff edit. Fields not present in the body are left
    unchanged; ``tags=null`` is treated as "don't touch tags" (use
    ``tags=[]`` to clear)."""
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if not _can_edit_project(p, request.user):
        return 403, {"detail": "Only the creator or staff can edit"}
    data = payload.dict(exclude_unset=True)
    tags = data.pop("tags", None)
    # Validate visibility / status against enum choices — silently
    # drop garbage rather than 400-ing on it (the editor UI never
    # sends unknown values, so this is purely a defensive guard).
    if "visibility" in data and data["visibility"] not in {
        c.value for c in Project.Visibility
    }:
        data.pop("visibility")
    if "status" in data and data["status"] not in {c.value for c in Project.Status}:
        data.pop("status")
    for field, value in data.items():
        setattr(p, field, value)
    p.save()
    if tags is not None:
        clean = [t.strip() for t in tags if t.strip()]
        if clean:
            p.tags.set(clean, clear=True)
        else:
            p.tags.clear()
    return 200, _project_out(p, user=request.user)


# ---- Members ----


def _member_out(m: Membership) -> dict:
    u = m.user
    display = ""
    avatar = ""
    if hasattr(u, "profile"):
        display = getattr(u.profile, "display_name", "") or ""
        avatar = getattr(u.profile, "avatar_url", "") or ""
    return {
        "user_email": u.email,
        "user_display_name": display or u.email.split("@")[0],
        "avatar_url": avatar,
        "role": m.role,
        "joined_at": m.created_at,
        "is_creator": m.user_id == m.project.created_by_id,
    }


@router.get(
    "/projects/{slug}/members",
    response={200: list[ProjectMemberOut], 403: dict, 404: dict},
)
def list_project_members(request: HttpRequest, slug: str):
    try:
        p = Project.objects.select_related("created_by").get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if not _can_view_project(p, request.user):
        return 403, {"detail": "Forbidden"}
    qs = p.memberships.select_related("user", "user__profile").order_by(
        "created_at"
    )
    return 200, [_member_out(m) for m in qs]


@router.post(
    "/projects/{slug}/join",
    response={200: ProjectOut, 401: dict, 403: dict, 404: dict},
)
def join_project(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if not _can_view_project(p, request.user):
        return 403, {"detail": "Forbidden"}
    Membership.objects.get_or_create(
        project=p, user=request.user, defaults={"role": Membership.Role.CONTRIBUTOR}
    )
    return 200, _project_out(p, user=request.user)


@router.post(
    "/projects/{slug}/leave",
    response={200: ProjectOut, 401: dict, 404: dict},
)
def leave_project(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    # Creator can't leave their own project — they'd lock themselves
    # out and the row gets weird. Transfer-ownership UI is a future
    # task; for now block with a clear hint.
    if p.created_by_id == request.user.id:
        return 200, _project_out(p, user=request.user)
    Membership.objects.filter(project=p, user=request.user).delete()
    return 200, _project_out(p, user=request.user)


@router.delete("/projects/{slug}", response={204: None, 401: dict, 403: dict, 404: dict})
def delete_project(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if p.created_by_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    from apps.notifications.discord_dispatch import dispatch_event

    project_name = p.name
    project_slug = p.slug
    creator_email = p.created_by.email
    p.delete()

    dispatch_event(
        "project_lifecycle",
        {
            "title": f"🗑 Projekt smazán: {project_name}",
            "description": "",
            "fields": [
                {"name": "Slug", "value": project_slug, "inline": True},
                {"name": "Původní autor", "value": creator_email, "inline": True},
            ],
            "action": "archived",
            "actor_user_id": str(request.user.id),
        },
    )
    return 204, None


# ---- GH Repos ----


@router.get("/projects/{slug}/repos", response={200: list[GHRepoOut], 404: dict})
def list_repos(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    return 200, [_repo_out(r) for r in p.gh_repos.all()]


@router.post("/projects/{slug}/repos", response={201: GHRepoOut, 400: dict, 401: dict, 404: dict})
def add_repo(request: HttpRequest, slug: str, payload: GHRepoIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if p.created_by_id != request.user.id and not request.user.is_staff:
        return 401, {"detail": "Not a project maintainer"}

    if "/" not in payload.full_name:
        return 400, {"detail": "full_name must be 'owner/repo'"}
    owner, name = payload.full_name.split("/", 1)
    repo, created = GHRepo.objects.get_or_create(
        project=p, owner_login=owner.strip(), repo_name=name.strip()
    )
    # Fetch immediately, using the user's connected GH token if they have one
    fetch_repo_metadata(repo, user=request.user)
    repo.refresh_from_db()
    return 201, _repo_out(repo)


@router.post("/repos/{repo_id}/refresh", response={200: GHRepoOut, 401: dict, 404: dict})
def refresh_repo(request: HttpRequest, repo_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    fetch_repo_metadata(r, user=request.user)
    r.refresh_from_db()
    return 200, _repo_out(r)


@router.get("/repos/{repo_id}/issues", response={200: list[dict], 404: dict})
def list_repo_issues(request: HttpRequest, repo_id: str):
    """List open GH issues for a linked repo (live from GitHub API)."""
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    user = request.user if request.user.is_authenticated else None
    return 200, fetch_repo_issues(r, user=user)


@router.get(
    "/repos/{repo_id}/issues/{issue_number}",
    response={200: GHIssueDetailOut, 403: dict, 404: dict},
)
def get_issue_detail(request: HttpRequest, repo_id: str, issue_number: int):
    """Issue body + GH comments rendered for the detail panel.

    Visibility follows the parent project (same gate as ``/issues``).
    Markdown rendering happens inside ``fetch_issue_detail`` so the
    frontend gets sanitised HTML ready for ``dangerouslySetInnerHTML``.
    """
    try:
        r = GHRepo.objects.select_related("project").get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if not _can_view_project(r.project, request.user):
        return 403, {"detail": "Forbidden"}
    user = request.user if request.user.is_authenticated else None
    data = fetch_issue_detail(r, issue_number, user=user)
    if data.get("status") == "not_found":
        return 404, {"detail": "Issue not found"}
    return 200, data


@router.post(
    "/repos/{repo_id}/issues/{issue_number}/comments",
    response={200: dict, 400: dict, 401: dict, 404: dict},
)
def post_issue_comment_endpoint(
    request: HttpRequest,
    repo_id: str,
    issue_number: int,
    payload: GHIssueCommentIn,
):
    """Post a comment on the GH issue using the caller's connected
    GitHub access_token. Unified comment flow — same surface used
    for the "claim issue" CTA and the general comment composer.

    Returns ``{"status": "ok", "html_url": "..."}`` on success or
    ``{"status": "no_token", ...}`` when the user hasn't connected
    GitHub (UI prompts to connect).
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    body = (payload.body or "").strip()
    if not body:
        return 400, {"detail": "Empty comment"}
    result = post_issue_comment(r, issue_number, body, request.user)
    return 200, result


@router.post(
    "/repos/{repo_id}/issues/{issue_number}/claim",
    response={200: dict, 401: dict, 404: dict},
)
def claim_repo_issue(
    request: HttpRequest, repo_id: str, issue_number: int, payload: IssueClaimIn
):
    """Post a 'I'd like to take this on' comment on the GH issue using the
    caller's connected GitHub access_token. Kept as a separate endpoint
    purely so the UI can offer a one-click claim flow with a default
    body — internally it does the same thing as the generic comment POST.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    body = (payload.body or "").strip() or (
        "🙋 I'd like to take this on. — via Astrozor"
    )
    result = post_issue_comment(r, issue_number, body, request.user)
    return 200, result


class MarkdownPreviewIn(Schema):
    body: str = ""


@router.post(
    "/markdown/preview",
    response={200: dict, 401: dict},
)
def preview_markdown(request: HttpRequest, payload: MarkdownPreviewIn):
    """Render markdown to sanitised HTML for the composer preview tab.

    Uses the same ``_render_gh_markdown`` pipeline the GH issue
    detail endpoint runs on incoming bodies, so the preview matches
    exactly what the comment will look like once it round-trips
    through GitHub and back. Authenticated-only so anonymous
    callers can't use us as a free markdown renderer.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    body = (payload.body or "")[:20_000]
    return 200, {"html": _render_gh_markdown(body)}


@router.get(
    "/projects/{slug}/activity",
    response={200: GHActivityOut, 403: dict, 404: dict},
)
def get_project_activity(
    request: HttpRequest, slug: str, days: int = 365
):
    """Aggregated commit-activity grid across all repos of a project.

    Reads each repo's cached ``daily_commit_counts`` (refreshed
    lazily via the synchronous ``/commits`` pagination — see
    ``refresh_repo_commit_cache``) and sums by date. Days outside
    the response are zero-filled to a fixed-length series so the
    frontend renderer stays simple.

    The per-repo cache has a 1-hour TTL: if ``commits_synced_at``
    is stale or missing, we trigger a refresh in-band before
    aggregating. Manual repo refresh (``/repos/{id}/refresh``)
    also rebuilds the cache as a side effect of
    ``fetch_repo_metadata``.
    """
    from collections import defaultdict
    from datetime import date as date_cls, timedelta
    from django.utils import timezone as dj_tz

    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    if not _can_view_project(p, request.user):
        return 403, {"detail": "Forbidden"}
    days = max(7, min(int(days or 365), 365))
    user = request.user if request.user.is_authenticated else None
    ttl = timedelta(hours=1)
    now = dj_tz.now()
    totals: dict[str, int] = defaultdict(int)
    for r in p.gh_repos.all():
        if r.last_status not in ("", "ok"):
            # Skip known-broken repos so a 404'd repo doesn't tank
            # the whole project graph.
            continue
        # Lazy refresh: cache cold or stale → rebuild from /commits
        # right now. We swallow refresh errors so a single failing
        # repo doesn't blank the whole project graph; the cached
        # counts (possibly stale or empty) are used as fallback.
        if not r.commits_synced_at or (now - r.commits_synced_at) > ttl:
            try:
                refresh_repo_commit_cache(r, user=user, days=days)
            except Exception:
                pass
        for d, c in (r.daily_commit_counts or {}).items():
            if isinstance(d, str) and isinstance(c, int):
                totals[d] += c
    today = date_cls.today()
    start = today - timedelta(days=days - 1)
    out_buckets: list[dict] = []
    cur = start
    total_commits = 0
    while cur <= today:
        iso = cur.isoformat()
        cnt = totals.get(iso, 0)
        out_buckets.append({"date": iso, "count": cnt})
        total_commits += cnt
        cur = cur + timedelta(days=1)
    return 200, {
        "days": days,
        "total_commits": total_commits,
        "buckets": out_buckets,
    }


# ---- Per-issue chat ----


@router.get(
    "/repos/{repo_id}/issues/{issue_number}/chat",
    response={200: MessageListOut, 403: dict, 404: dict},
)
def list_issue_chat(
    request: HttpRequest, repo_id: str, issue_number: int, limit: int = 200
):
    """Astrozor-side discussion attached to a specific GH issue.

    Visibility follows the parent project: public projects let
    anyone read; private projects require Membership. Posting is
    gated separately in the POST endpoint (auth required).
    """
    from apps.chat.models import Message as ChatMessage
    from apps.chat.sanitize import message_out

    try:
        r = GHRepo.objects.select_related("project").get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if not _can_view_project(r.project, request.user):
        return 403, {"detail": "Forbidden"}
    limit = max(1, min(int(limit or 200), 500))
    qs = (
        ChatMessage.objects.filter(
            gh_repo=r,
            issue_number=issue_number,
            deleted_at__isnull=True,
        )
        .select_related("user", "user__profile")
        .order_by("created_at")[:limit]
    )
    items = list(qs)
    return 200, {
        "count": len(items),
        "items": [
            message_out(m, repo_id=str(r.id), issue_number=issue_number)
            for m in items
        ],
    }


@router.post(
    "/repos/{repo_id}/issues/{issue_number}/chat",
    response={201: MessageOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def post_issue_chat(
    request: HttpRequest,
    repo_id: str,
    issue_number: int,
    payload: MessageIn,
):
    from apps.chat.models import Message as ChatMessage
    from apps.chat.sanitize import (
        auto_youtube_attachments,
        message_out,
        safe_text,
        sanitize_attachments,
    )

    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.select_related("project").get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if not _can_view_project(r.project, request.user):
        return 403, {"detail": "Forbidden"}
    text = safe_text(payload.text or "")
    attachments = sanitize_attachments(payload.attachments or [])
    # ``zoo_subject`` attachment kind is sprint-only — strip out of
    # issue chats so it doesn't pollute project discussions.
    attachments = [a for a in attachments if a["kind"] != "zoo_subject"]
    existing_yt = {a["video_id"] for a in attachments if a.get("kind") == "youtube"}
    for auto in auto_youtube_attachments(text):
        if auto["video_id"] not in existing_yt:
            attachments.append(auto)
            existing_yt.add(auto["video_id"])
    if not text and not attachments:
        return 400, {"detail": "Message must have text or at least one attachment"}

    parent = None
    if payload.parent_id:
        parent = ChatMessage.objects.filter(
            id=payload.parent_id,
            gh_repo=r,
            issue_number=issue_number,
            deleted_at__isnull=True,
        ).first()
        if parent is None:
            return 400, {"detail": "Parent message not found"}

    msg = ChatMessage.objects.create(
        gh_repo=r,
        issue_number=issue_number,
        user=request.user,
        parent=parent,
        text=text,
        attachments=attachments,
    )
    msg.user = request.user
    return 201, message_out(msg, repo_id=str(r.id), issue_number=issue_number)


@router.delete("/repos/{repo_id}", response={204: None, 401: dict, 404: dict})
def delete_repo(request: HttpRequest, repo_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if r.project.created_by_id != request.user.id and not request.user.is_staff:
        return 401, {"detail": "Not a project maintainer"}
    r.delete()
    return 204, None
