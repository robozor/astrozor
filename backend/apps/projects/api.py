from __future__ import annotations

from django.http import HttpRequest
from django.utils.text import slugify
from ninja import Router

from ninja import Schema

from apps.chat.schemas import MessageIn, MessageListOut, MessageOut

from .github import (
    _render_gh_markdown,
    assign_issue_to_self,
    create_issue,
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
    GHIssueCreateIn,
    GHIssueDetailOut,
    GHRepoIn,
    GHRepoOut,
    IssueLeaderboardEntry,
    ProjectIn,
    ProjectMemberOut,
    ProjectOut,
    ProjectPatchIn,
)


# Issue-type → GitHub labels mapping. We use the GH default labels
# (``bug``, ``enhancement``) so they're already present on most repos
# created from a template; ``task`` falls back to ``documentation``-ish
# but really we just emit no special label for plain tasks. The
# composer always tacks on the marker ``astrozor`` label so issues
# raised from our UI are searchable on GH.
ISSUE_LABELS: dict[str, list[str]] = {
    "bug": ["bug", "astrozor"],
    "feature": ["enhancement", "astrozor"],
    "task": ["astrozor"],
}


# Repo metadata cache TTL — if ``last_fetched_at`` is older than this
# when ``list_repos`` runs, we refresh in-band before returning. Same
# 1-hour window as the project-activity commit cache, sized so it
# absorbs project-page renders without burning a /repos call on every
# tab switch but still lets releases / contributors land within an
# hour of being published.
REPO_METADATA_TTL_SECONDS = 60 * 60


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
def list_repos(request: HttpRequest, slug: str):
    """List linked repos for a project.

    Lazy-refresh: if a repo's cached metadata is older than
    ``REPO_METADATA_TTL_SECONDS`` (or has never been fetched), we
    re-fetch from GitHub inline using the caller's token. That way a
    repo added before its first release was published still picks up
    the release info on the next project-page render — without the
    user having to hit the per-repo refresh button manually.

    Only authenticated users with a connected GitHub identity drive
    the refresh: anonymous callers (or users without a GH token)
    would hit the public 60 req/h budget and, worse, would burn the
    private-repo cache to ``not_found`` because they can't see it.
    Refresh failures are swallowed so a single bad repo doesn't
    blank the list; the stale cache is returned as fallback.
    """
    from datetime import timedelta
    from django.utils import timezone as dj_tz

    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    user = request.user if request.user.is_authenticated else None
    can_refresh = user is not None and bool(
        getattr(user, "is_authenticated", False)
    )
    if can_refresh:
        from .github import _resolve_user_token  # local import: avoid cycle

        can_refresh = _resolve_user_token(user) is not None
    if can_refresh:
        ttl = timedelta(seconds=REPO_METADATA_TTL_SECONDS)
        now = dj_tz.now()
        for r in p.gh_repos.all():
            if r.last_fetched_at is None or (now - r.last_fetched_at) > ttl:
                try:
                    fetch_repo_metadata(r, user=user)
                except Exception:
                    # Stale cache better than an empty list; the per-repo
                    # refresh button stays available for manual recovery.
                    pass
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


@router.post(
    "/repos/{repo_id}/issues",
    response={200: dict, 400: dict, 401: dict, 403: dict, 404: dict},
)
def create_repo_issue(
    request: HttpRequest, repo_id: str, payload: GHIssueCreateIn
):
    """Create a new GH issue (bug / feature / task) using the caller's
    connected GitHub access_token.

    Visibility: caller must be authenticated and pass the parent
    project's view gate (public + auth users for internal, members
    for private). The actual write permission is enforced by GitHub
    — if the user can post on the repo, the issue is created; if not,
    GH returns 403/404 and we surface the status code so the UI can
    show a "you don't have write access" hint.

    Returns ``{"status": "ok", "number": N, "html_url": "..."}`` on
    success or ``{"status": "no_token" | "http_NNN", ...}`` so the
    UI can prompt the user to connect / re-auth GitHub.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.select_related("project").get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if not _can_view_project(r.project, request.user):
        return 403, {"detail": "Forbidden"}
    title = (payload.title or "").strip()
    if not title:
        return 400, {"detail": "Title is required"}
    body = (payload.body or "").strip()
    type_key = (payload.type or "task").lower()
    labels = ISSUE_LABELS.get(type_key, ISSUE_LABELS["task"])
    result = create_issue(
        r,
        title=title,
        body=body,
        labels=labels,
        user=request.user,
    )
    # Optimistic counter bump + TTL bust so the cached counters used
    # by the project page (``🐛 Otevřené issues`` metric and the
    # ``Issues · N`` toggle) update immediately. The bump is atomic
    # via ``F()`` to survive concurrent creates from multiple users.
    # Setting ``last_fetched_at=None`` forces the next
    # ``list_repos`` call to call ``fetch_repo_metadata`` again,
    # which pulls the authoritative ``open_issues_count`` from GitHub
    # — that reconciles any issues that were created/closed outside
    # of Astrozor since the previous fetch (the bump alone can't see
    # them).
    if result.get("status") == "ok":
        from django.db.models import F

        try:
            GHRepo.objects.filter(pk=r.pk).update(
                open_issues=F("open_issues") + 1,
                last_fetched_at=None,
            )
        except Exception:
            pass
    return 200, result


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


@router.post(
    "/repos/{repo_id}/issues/{issue_number}/assign",
    response={200: dict, 401: dict, 403: dict, 404: dict},
)
def assign_repo_issue_to_caller(
    request: HttpRequest, repo_id: str, issue_number: int
):
    """Add the caller as an assignee on the GH issue.

    GitHub requires the assignee to be a collaborator on the repo
    with at least read+triage permissions. Random users self-assigning
    will get a 200 with ``status="not_collaborator"`` — the UI shows
    that as a "ask the owner to add you as a collaborator" hint.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.select_related("project").get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    if not _can_view_project(r.project, request.user):
        return 403, {"detail": "Forbidden"}
    result = assign_issue_to_self(r, issue_number, request.user)
    return 200, result


@router.get(
    "/issues/leaderboard",
    response={200: list[IssueLeaderboardEntry]},
)
def issue_leaderboard(request: HttpRequest, limit: int = 20):
    """Top GitHub users by number of open issues they're assigned to.

    Aggregates across every linked repo the caller can see. Joins
    against ``apps.accounts.Identity`` so users with a connected
    Astrozor account get their display name attached — others show
    as GH-only. The list is sorted by count desc (ties broken by
    GH login asc for stable order).

    Cost: one ``/issues`` GH call per linked repo (cached by the
    backend caller's token). React Query on the client adds another
    layer of caching with a generous ``staleTime``.
    """
    from collections import defaultdict

    from apps.accounts.models import Identity

    counts: dict[str, int] = defaultdict(int)
    avatars: dict[str, str] = {}
    html_urls: dict[str, str] = {}
    user = request.user if request.user.is_authenticated else None
    repos_qs = GHRepo.objects.filter(last_status="ok").select_related("project")
    for r in repos_qs:
        if not _can_view_project(r.project, request.user):
            continue
        try:
            issues = fetch_repo_issues(r, user=user, limit=100)
        except Exception:
            continue
        for it in issues:
            for a in it.get("assignees") or []:
                login = (a.get("login") or "").strip()
                if not login:
                    continue
                counts[login] += 1
                if login not in avatars:
                    avatars[login] = a.get("avatar_url") or ""
                    html_urls[login] = a.get("html_url") or ""

    # Join with Identity to attach Astrozor display names. The match
    # is case-insensitive on ``provider_username`` because GH login
    # capitalization differs between the OAuth callback (preserves
    # user case, e.g. "Robozor") and the issue assignee field
    # (lowercased, e.g. "robozor"). We fetch all GH identities once
    # and bucket them by lowercase login in Python — cheaper than
    # ``Q(iexact=...) | Q(iexact=...)`` per login.
    login_lowers = {l.lower() for l in counts.keys()}
    identities = Identity.objects.filter(provider="github").select_related(
        "user", "user__profile"
    )
    by_login: dict[str, tuple[str, str]] = {}
    for ident in identities:
        login_key = (ident.provider_username or "").lower()
        if not login_key or login_key not in login_lowers:
            continue
        u = ident.user
        display = ""
        if hasattr(u, "profile"):
            display = getattr(u.profile, "display_name", "") or ""
        if not display and u.email:
            display = u.email.split("@")[0]
        by_login[login_key] = (display, u.email)

    rows: list[dict] = []
    for login, count in sorted(
        counts.items(), key=lambda x: (-x[1], x[0].lower())
    ):
        astro_name, astro_email = by_login.get(login.lower(), ("", ""))
        rows.append(
            {
                "gh_login": login,
                "gh_avatar": avatars.get(login, ""),
                "gh_html_url": html_urls.get(login, ""),
                "astrozor_display_name": astro_name,
                "astrozor_email": astro_email,
                "open_issue_count": count,
            }
        )
    return 200, rows[: max(1, min(int(limit or 20), 100))]


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
