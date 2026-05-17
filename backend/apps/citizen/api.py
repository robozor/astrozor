from __future__ import annotations

from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Router

from apps.projects.models import Project

from .models import Campaign, Contribution
from .schemas import (
    CampaignCreateIn,
    CampaignOut,
    CampaignPatchIn,
    ContributionIn,
    ContributionOut,
    ContributionReviewIn,
)

router = Router(tags=["citizen"])


def _require_auth(request: HttpRequest):
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


def _author_display(user) -> str:
    if hasattr(user, "profile") and user.profile.display_name:
        return user.profile.display_name
    return user.email.split("@")[0]


def _unique_slug(title: str) -> str:
    base = slugify(title)[:120] or "campaign"
    candidate = base
    i = 2
    while Campaign.objects.filter(slug=candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


def _campaign_out(c: Campaign) -> dict:
    contrib = c.contributions.all()
    return {
        "id": c.id,
        "project_slug": c.project.slug,
        "slug": c.slug,
        "title": c.title,
        "description": c.description,
        "methodology": c.methodology,
        "kind": c.kind,
        "status": c.status,
        "coordinator_email": c.coordinator.email,
        "starts_at": c.starts_at,
        "ends_at": c.ends_at,
        "contribution_schema": c.contribution_schema,
        "contribution_count": contrib.count(),
        "accepted_count": contrib.filter(status=Contribution.Status.ACCEPTED).count(),
        "created_at": c.created_at,
    }


def _contribution_out(co: Contribution) -> dict:
    return {
        "id": co.id,
        "campaign_slug": co.campaign.slug,
        "user_email": co.user.email,
        "user_display_name": _author_display(co.user),
        "title": co.title,
        "data": co.data,
        "comment": co.comment,
        "status": co.status,
        "review_comment": co.review_comment,
        "reviewed_by_email": co.reviewed_by.email if co.reviewed_by else None,
        "reviewed_at": co.reviewed_at,
        "created_at": co.created_at,
    }


# ---- Campaigns ----


@router.get("/campaigns", response={200: list[CampaignOut]})
def list_campaigns(
    request: HttpRequest,  # noqa: ARG001
    project_slug: str | None = None,
    status: str | None = None,
):
    qs = Campaign.objects.select_related("project", "coordinator").exclude(status=Campaign.Status.DRAFT)
    if project_slug:
        qs = qs.filter(project__slug=project_slug)
    if status:
        qs = qs.filter(status=status)
    return 200, [_campaign_out(c) for c in qs[:200]]


@router.get("/campaigns/{slug}", response={200: CampaignOut, 404: dict})
def get_campaign(request: HttpRequest, slug: str):
    try:
        c = Campaign.objects.select_related("project", "coordinator").get(slug=slug)
    except Campaign.DoesNotExist:
        return 404, {"detail": "Campaign not found"}
    if c.status == Campaign.Status.DRAFT and (
        not request.user.is_authenticated or (c.coordinator_id != request.user.id and not request.user.is_staff)
    ):
        return 404, {"detail": "Campaign not found"}
    return 200, _campaign_out(c)


@router.post("/campaigns", response={201: CampaignOut, 400: dict, 401: dict})
def create_campaign(request: HttpRequest, payload: CampaignCreateIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        project = Project.objects.get(slug=payload.project_slug)
    except Project.DoesNotExist:
        return 400, {"detail": "Project not found"}
    # Founder (campaign creator) decides coordinator — for MVP the
    # creator becomes the coordinator (per ADR/spec — no central validation).
    c = Campaign.objects.create(
        project=project,
        slug=_unique_slug(payload.title),
        title=payload.title,
        description=payload.description,
        methodology=payload.methodology,
        kind=payload.kind,
        coordinator=request.user,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        contribution_schema=payload.contribution_schema,
        status=Campaign.Status.OPEN,
    )
    return 201, _campaign_out(c)


@router.patch("/campaigns/{slug}", response={200: CampaignOut, 401: dict, 403: dict, 404: dict})
def update_campaign(request: HttpRequest, slug: str, payload: CampaignPatchIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        c = Campaign.objects.get(slug=slug)
    except Campaign.DoesNotExist:
        return 404, {"detail": "Campaign not found"}
    if c.coordinator_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}
    data = payload.dict(exclude_unset=True)
    prev_status = c.status
    for field, value in data.items():
        setattr(c, field, value)
    c.save()

    # Notify Discord subscribers only on actual status transitions.
    if "status" in data and data["status"] != prev_status:
        from apps.notifications.discord_dispatch import dispatch_event

        host = request.get_host()
        scheme = "https" if request.is_secure() else "http"
        dispatch_event(
            "campaign_status_changed",
            {
                "title": f"🌌 Kampaň {c.title}: {prev_status} → {c.status}",
                "description": (c.description or "")[:300],
                "url": f"{scheme}://{host}/campaigns/{c.slug}",
                "fields": [
                    {"name": "Koordinátor", "value": c.coordinator.email, "inline": True},
                    {"name": "Projekt", "value": c.project.slug, "inline": True},
                    {"name": "Nový stav", "value": c.status, "inline": True},
                ],
                "coordinator_email": c.coordinator.email,
                "campaign_slug": c.slug,
                "to_state": c.status,
                "from_state": prev_status,
                "actor_user_id": str(request.user.id),
            },
        )
    return 200, _campaign_out(c)


# ---- Contributions ----


@router.get("/campaigns/{slug}/contributions", response={200: list[ContributionOut], 404: dict})
def list_contributions(request: HttpRequest, slug: str, status: str | None = None):  # noqa: ARG001
    try:
        c = Campaign.objects.get(slug=slug)
    except Campaign.DoesNotExist:
        return 404, {"detail": "Campaign not found"}
    qs = c.contributions.select_related("user", "user__profile", "reviewed_by")
    if status:
        qs = qs.filter(status=status)
    return 200, [_contribution_out(co) for co in qs[:500]]


@router.post("/campaigns/{slug}/contributions", response={201: ContributionOut, 400: dict, 401: dict, 404: dict})
def submit_contribution(request: HttpRequest, slug: str, payload: ContributionIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        c = Campaign.objects.get(slug=slug)
    except Campaign.DoesNotExist:
        return 404, {"detail": "Campaign not found"}
    if c.status != Campaign.Status.OPEN:
        return 400, {"detail": f"Campaign not accepting contributions (status={c.status})"}

    co = Contribution.objects.create(
        campaign=c,
        user=request.user,
        title=payload.title,
        data=payload.data,
        comment=payload.comment,
    )
    return 201, _contribution_out(co)


@router.post(
    "/contributions/{contribution_id}/review",
    response={200: ContributionOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def review_contribution(
    request: HttpRequest, contribution_id: str, payload: ContributionReviewIn
):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        co = Contribution.objects.select_related("campaign").get(id=contribution_id)
    except (Contribution.DoesNotExist, ValueError):
        return 404, {"detail": "Contribution not found"}
    if co.campaign.coordinator_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Only coordinator can review"}
    if payload.status not in {"accepted", "rejected", "needs_revision"}:
        return 400, {"detail": "Invalid status"}

    co.status = payload.status
    co.review_comment = payload.review_comment
    co.reviewed_by = request.user
    co.reviewed_at = timezone.now()
    co.save()
    return 200, _contribution_out(co)
