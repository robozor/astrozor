from __future__ import annotations

from django.http import HttpRequest
from django.utils.text import slugify
from ninja import Router

from .github import fetch_repo_metadata
from .models import GHRepo, Membership, Project
from .schemas import GHRepoIn, GHRepoOut, ProjectIn, ProjectOut

router = Router(tags=["projects"])


def _require_auth(request: HttpRequest):
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


def _project_out(p: Project) -> dict:
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
    }


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
def list_projects(request: HttpRequest):
    from django.db.models import Q

    qs = Project.objects.select_related("created_by")
    if _require_auth(request):
        qs = qs.filter(
            Q(visibility=Project.Visibility.PUBLIC) | Q(memberships__user=request.user)
        ).distinct()
    else:
        qs = qs.filter(visibility=Project.Visibility.PUBLIC)
    return 200, [_project_out(p) for p in qs[:200]]


@router.get("/projects/{slug}", response={200: ProjectOut, 404: dict})
def get_project(request: HttpRequest, slug: str):  # noqa: ARG001
    try:
        p = Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        return 404, {"detail": "Project not found"}
    return 200, _project_out(p)


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
    Membership.objects.create(project=project, user=request.user, role=Membership.Role.OWNER)
    return 201, _project_out(project)


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
    p.delete()
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
    # Fetch immediately
    fetch_repo_metadata(repo)
    repo.refresh_from_db()
    status = 201 if created else 201  # always 201 for simplicity
    return status, _repo_out(repo)


@router.post("/repos/{repo_id}/refresh", response={200: GHRepoOut, 401: dict, 404: dict})
def refresh_repo(request: HttpRequest, repo_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        r = GHRepo.objects.get(id=repo_id)
    except (GHRepo.DoesNotExist, ValueError):
        return 404, {"detail": "Repo not found"}
    fetch_repo_metadata(r)
    r.refresh_from_db()
    return 200, _repo_out(r)


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
