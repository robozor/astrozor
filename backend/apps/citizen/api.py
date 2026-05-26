from __future__ import annotations

import os
import re

from django.http import HttpRequest
from django.utils import timezone
from django.utils.text import slugify
from ninja import Router

from apps.chat.schemas import MessageIn, MessageListOut, MessageOut
from apps.projects.models import Project

from .models import (
    Campaign,
    Contribution,
    SprintParticipant,
    ZooniverseGroup,
    ZooniverseProject,
    ZooniverseStatsSnapshot,
)
from .schemas import (
    CampaignCreateIn,
    CampaignOut,
    CampaignPatchIn,
    ContributionIn,
    ContributionOut,
    ContributionReviewIn,
    SprintCreateIn,
    SprintOut,
    SprintPatchIn,
    SprintStatsOut,
    ZooniverseCollectionListOut,
    ZooniverseGroupDashboardOut,
    ZooniverseMembershipOut,
    ZooniverseProjectAddIn,
    ZooniverseProjectDisconnectPreviewOut,
    ZooniverseProjectDisconnectResultOut,
    ZooniverseProjectOut,
    ZooniverseProjectPatchIn,
    ZooniverseProjectPreviewOut,
    ZooniverseProjectSearchResult,
    ZooniverseProjectSeriesOut,
    ZooniverseSubjectListOut,
    ZooniverseSubjectResolvedOut,
    ZooniverseTalkBoardsOut,
    ZooniverseTalkDiscussionDetailOut,
    ZooniverseTalkDiscussionListOut,
    ZooniverseTalkSubjectViewOut,
    ZooniverseWorkflowActivityOut,
)
from .zooniverse import (
    Panoptes,
    Token,
    ZooniverseError,
    service_token,
    talk_get_discussion,
    talk_list_boards,
    talk_list_comments,
    talk_list_discussions,
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
    # Resolve Zooniverse linkage fields without an N+1 — assume the
    # caller .select_related("zooniverse_project") if listing many.
    zp = c.zooniverse_project
    zp_workflow_name = ""
    if zp and c.zooniverse_workflow_id:
        for w in zp.workflows or []:
            if int(w.get("id") or 0) == c.zooniverse_workflow_id:
                zp_workflow_name = w.get("display_name") or ""
                break
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
        "tags": list(c.tags.names()) if c.id else [],
        "zooniverse_project_zid": zp.zooniverse_id if zp else None,
        "zooniverse_project_title": zp.title if zp else "",
        "zooniverse_project_slug": zp.slug if zp else "",
        "zooniverse_project_avatar_url": zp.avatar_url if zp else "",
        "zooniverse_workflow_id": c.zooniverse_workflow_id,
        "zooniverse_workflow_name": zp_workflow_name,
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
    tag: list[str] | None = None,
):
    qs = (
        Campaign.objects.select_related("project", "coordinator", "zooniverse_project")
        .exclude(status=Campaign.Status.DRAFT)
        # Zoo-linked campaigns ("sprints") have their own surface on the
        # Zooniverse project detail page. Excluding them from the
        # generic list keeps the two agendas distinct — the user shouldn't
        # see sprints when browsing internal Astrozor campaigns.
        .filter(zooniverse_project__isnull=True)
    )
    if project_slug:
        qs = qs.filter(project__slug=project_slug)
    if status:
        qs = qs.filter(status=status)
    if tag:
        for t in tag:
            qs = qs.filter(tags__name__iexact=t)
        qs = qs.distinct()
    return 200, [_campaign_out(c) for c in qs[:200]]


@router.get("/campaigns/{slug}", response={200: CampaignOut, 404: dict})
def get_campaign(request: HttpRequest, slug: str):
    try:
        c = Campaign.objects.select_related(
            "project", "coordinator", "zooniverse_project"
        ).get(slug=slug)
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
    # Resolve optional Zooniverse linkage. Skip silently if the zid
    # doesn't match anything we have catalogued — admin can re-link
    # later via PATCH. We don't want a typo to block campaign creation.
    zp = None
    if payload.zooniverse_project_zid:
        zp = ZooniverseProject.objects.filter(
            zooniverse_id=payload.zooniverse_project_zid
        ).first()
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
        zooniverse_project=zp,
        zooniverse_workflow_id=payload.zooniverse_workflow_id if zp else None,
    )
    clean_tags = [t.strip() for t in (payload.tags or []) if t.strip()]
    if clean_tags:
        c.tags.set(clean_tags)
    # Re-select with the related so _campaign_out sees zooniverse_project.
    c = Campaign.objects.select_related(
        "project", "coordinator", "zooniverse_project"
    ).get(pk=c.pk)
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
    tags = data.pop("tags", None)
    prev_status = c.status
    # Map zooniverse_project_zid (the wire format) to the FK on the
    # model. ``None`` clears the linkage; an unknown zid is treated as
    # a no-op so admin doesn't trip into a 400 on typos.
    if "zooniverse_project_zid" in data:
        zid = data.pop("zooniverse_project_zid")
        if zid is None:
            c.zooniverse_project = None
            c.zooniverse_workflow_id = None
        else:
            zp = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
            if zp is not None:
                c.zooniverse_project = zp
    if "zooniverse_workflow_id" in data:
        c.zooniverse_workflow_id = data.pop("zooniverse_workflow_id")
    for field, value in data.items():
        setattr(c, field, value)
    c.save()
    if tags is not None:
        clean = [t.strip() for t in tags if t.strip()]
        if clean:
            c.tags.set(clean, clear=True)
        else:
            c.tags.clear()

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


# ---- Zooniverse ----


def _zooniverse_project_out(p: ZooniverseProject) -> dict:
    snap = (
        ZooniverseStatsSnapshot.objects.filter(
            subject_type="group",
            subject_id=int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0),
            period="total",
        )
        .order_by("-fetched_at")
        .first()
    )
    # Build deep classify URLs. The canonical SPA route is the
    # path-based form ``/classify/workflow/<id>`` — the older
    # ``?workflow=<id>`` query-string form lands on the workflow
    # picker, defeating the whole point of per-workflow buttons.
    # See zooniverse/Front-End-Client routes for the spec.
    workflows_out = []
    base = (
        f"https://www.zooniverse.org/projects/{p.slug}"
        if p.slug
        else f"https://www.zooniverse.org/projects/{p.zooniverse_id}"
    )
    for w in (p.workflows or []):
        if not w.get("active"):
            continue
        wid = w.get("id")
        if not wid:
            continue
        workflows_out.append(
            {
                "id": int(wid),
                "display_name": w.get("display_name") or f"Workflow #{wid}",
                "active": True,
                "completeness": float(w.get("completeness") or 0.0),
                "classify_url": f"{base}/classify/workflow/{wid}",
                "description": (w.get("description") or "")[:160],
            }
        )
    # "Zombie": never launch-approved AND every active workflow is
    # near-empty (completeness <= 0.001 means the subject set has
    # essentially no subjects to classify). These projects load a
    # blank /classify page — we surface the warning to the user
    # instead of letting them click into nothing.
    zombie = (not p.launch_approved) and all(
        float(w.get("completeness") or 0.0) <= 0.001 for w in workflows_out
    )
    # The group total isn't per-project; in MVP we surface only the
    # group-wide aggregate. A future task can store
    # (subject_type="group_project", subject_id=project_zid) for
    # per-project group contributions.
    return {
        "id": p.id,
        "zooniverse_id": p.zooniverse_id,
        "slug": p.slug,
        "title": p.title,
        "owner_login": p.owner_login,
        "description": p.description,
        "introduction": p.introduction,
        "avatar_url": p.avatar_url,
        "background_url": p.background_url,
        "primary_language": p.primary_language,
        "state": p.state,
        "classifications_count": p.classifications_count,
        "is_featured": p.is_featured,
        "tags": list(p.tags.names()) if p.id else [],
        "zooniverse_url": p.zooniverse_url,
        "last_synced_at": p.last_synced_at,
        "group_contribution_count": snap.count if snap else None,
        "workflows": workflows_out,
        "launch_approved": p.launch_approved,
        "beta_approved": p.beta_approved,
        "subjects_count": p.subjects_count,
        "zombie": zombie,
    }


@router.get("/zooniverse/projects", response={200: list[ZooniverseProjectOut]})
def list_zooniverse_projects(request: HttpRequest, featured_only: bool = True):  # noqa: ARG001
    qs = ZooniverseProject.objects.all().prefetch_related("tags")
    if featured_only:
        qs = qs.filter(is_featured=True)
    return 200, [_zooniverse_project_out(p) for p in qs]


@router.get(
    "/zooniverse/projects/zid/{zid}",
    response={200: ZooniverseProjectOut, 404: dict},
)
def get_zooniverse_project(request: HttpRequest, zid: int):  # noqa: ARG001
    """Keyed by numeric zooniverse_id (slugs contain slashes, no go in path params)."""
    p = ZooniverseProject.objects.prefetch_related("tags").filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not found"}
    return 200, _zooniverse_project_out(p)


@router.get("/zooniverse/membership", response={200: ZooniverseMembershipOut})
def get_zooniverse_membership(request: HttpRequest):
    """Return the connect / join / member state for ``request.user``.

    Anonymous users get ``linked=false, in_group=false`` plus the group
    metadata so the unauth Citizen Science page can still render a
    "Sign in to join" CTA.
    """
    from apps.accounts.models import Identity

    group = ZooniverseGroup.objects.first()
    member_count = group.member_count if group else 0
    join_url = group.join_url if group else ""
    public_url = group.public_url if group else ""
    synced_at = group.last_synced_at if group else None
    if not request.user.is_authenticated:
        return 200, {
            "linked": False,
            "in_group": False,
            "zooniverse_user_id": None,
            "zooniverse_login": "",
            "join_url": join_url,
            "group_public_url": public_url,
            "member_count": member_count,
            "last_synced_at": synced_at,
        }
    ident = Identity.objects.filter(
        user=request.user, provider="zooniverse"
    ).first()
    if ident is None:
        return 200, {
            "linked": False,
            "in_group": False,
            "zooniverse_user_id": None,
            "zooniverse_login": "",
            "join_url": join_url,
            "group_public_url": public_url,
            "member_count": member_count,
            "last_synced_at": synced_at,
        }
    try:
        zid = int(ident.provider_user_id or 0)
    except ValueError:
        zid = None
    return 200, {
        "linked": True,
        "in_group": bool(ident.zooniverse_in_group),
        "zooniverse_user_id": zid,
        "zooniverse_login": ident.provider_username or "",
        "join_url": join_url,
        "group_public_url": public_url,
        "member_count": member_count,
        "last_synced_at": ident.zooniverse_membership_synced_at or synced_at,
    }


@router.get("/zooniverse/dashboard", response={200: ZooniverseGroupDashboardOut})
def get_zooniverse_dashboard(request: HttpRequest):  # noqa: ARG001
    """Aggregate stats for the Citizen Science page hero strip.

    Pulls cached group counts + a fresh top-contributors call to ERAS
    (cheap, no auth needed for our public_show_all group). Top contributor
    Zooniverse user_ids are matched against our Identity table so the
    frontend can deep-link to Astrozor profiles where applicable; unmatched
    IDs get a Panoptes profile lookup so handle + avatar appear too.
    """
    from apps.accounts.models import Identity

    from .zooniverse import Eras, Panoptes

    group = ZooniverseGroup.objects.first()
    gid = group.zooniverse_group_id if group else int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0)
    name = group.name if group else "Astrozor"
    member_count = group.member_count if group else 0
    synced_at = group.last_synced_at if group else None

    total = 0
    time_spent = None
    active = 0
    contributors_raw: list[dict] = []
    if gid:
        try:
            r = Eras(token=None).group_total(gid, top_contributors=10)
            total = int(r.get("total_count") or 0)
            time_spent = _to_int_seconds(r.get("time_spent"))
            active = int(r.get("active_users") or 0)
            contributors_raw = r.get("top_contributors") or []
        except ZooniverseError:
            # Fall back to cached snapshot if ERAS is down.
            from .models import ZooniverseStatsSnapshot

            snap = (
                ZooniverseStatsSnapshot.objects.filter(
                    subject_type="group", subject_id=gid, period="total"
                )
                .order_by("-fetched_at")
                .first()
            )
            if snap:
                total = snap.count
                time_spent = snap.time_spent_s

    # Resolve contributor handles. Two sources: our own Identity rows
    # (cheap, in-process lookup) and Panoptes /users/{id} for unmatched
    # IDs (one HTTP call per stranger, capped at 10 by the top_contributors
    # limit above).
    contributors: list[dict] = []
    p = Panoptes(token=None)
    for c in contributors_raw[:10]:
        zid = int(c.get("user_id") or 0)
        cnt = int(c.get("count") or 0)
        if not zid:
            continue
        row = {
            "zooniverse_user_id": zid,
            "login": "",
            "display_name": "",
            "avatar_url": "",
            "count": cnt,
            "time_spent_s": _to_int_seconds(c.get("session_time") or c.get("time_spent")),
            "astrozor_email": None,
        }
        ident = (
            Identity.objects.filter(provider="zooniverse", provider_user_id=str(zid))
            .select_related("user")
            .first()
        )
        if ident:
            row["login"] = ident.provider_username or ""
            row["display_name"] = ident.display_name or ident.provider_username or ""
            row["avatar_url"] = ident.avatar_url or ""
            row["astrozor_email"] = ident.user.email if ident.user else None
        else:
            try:
                u = p.get_user(zid)
                row["login"] = u.get("login") or ""
                row["display_name"] = u.get("display_name") or u.get("credited_name") or row["login"]
                row["avatar_url"] = u.get("avatar_src") or ""
            except ZooniverseError:
                pass
        contributors.append(row)

    return 200, {
        "group_id": gid,
        "name": name,
        "member_count": member_count,
        "total_classifications": total,
        "time_spent_s": time_spent,
        "active_users": active,
        "top_contributors": contributors,
        "last_synced_at": synced_at,
    }


@router.get(
    "/zooniverse/projects/zid/{zid}/series",
    response={200: ZooniverseProjectSeriesOut, 404: dict},
)
def get_zooniverse_project_series(
    request: HttpRequest,  # noqa: ARG001
    zid: int,
    days: int = 30,
):
    """Daily classifications time-series for the chart on the project detail.

    Keyed by numeric zooniverse_id rather than slug to dodge the
    Ninja-router constraint that path params can't contain slashes
    (Zooniverse slugs are of the form "owner/short").

    Fresh fetch from ERAS rather than from snapshots — snapshots cache
    only the most recent 7 days, but the detail view wants a longer
    baseline. ERAS is cheap; client caches via React Query.
    """
    from datetime import date, timedelta

    from .zooniverse import Eras

    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not found"}
    days = max(7, min(days, 365))
    end = date.today()
    start = end - timedelta(days=days)
    try:
        r = Eras(token=None).project_total(
            p.zooniverse_id,
            period="day",
            start_date=start.isoformat(),
            end_date=end.isoformat(),
        )
    except ZooniverseError:
        return 200, {"zooniverse_id": p.zooniverse_id, "period": "day", "data": []}
    data = []
    for bucket in r.get("data") or []:
        raw = bucket.get("period") or ""
        day = raw[:10] if isinstance(raw, str) else ""
        data.append({"date": day, "count": int(bucket.get("count") or 0)})
    return 200, {"zooniverse_id": p.zooniverse_id, "period": "day", "data": data}


@router.get(
    "/zooniverse/projects/zid/{zid}/campaigns",
    response={200: list[CampaignOut]},
)
def list_campaigns_for_zooniverse_project(
    request: HttpRequest,  # noqa: ARG001
    zid: int,
    active_only: bool = False,
):
    """Internal Astrozor campaigns time-boxed around this Zooniverse project.

    Rendered on the project detail beneath the workflow buttons so
    visitors see "what is the community currently focused on for this
    project". ``active_only=true`` filters out drafts and archived.
    """
    qs = (
        Campaign.objects.select_related("project", "coordinator", "zooniverse_project")
        .filter(zooniverse_project__zooniverse_id=zid)
        .exclude(status=Campaign.Status.DRAFT)
    )
    if active_only:
        qs = qs.filter(status=Campaign.Status.OPEN)
    return 200, [_campaign_out(c) for c in qs[:200]]


# ---- Sprints (Zooniverse-linked campaigns) -----------------------------------


SPRINT_UMBRELLA_PROJECT_SLUG = "citizen-science"


def _sprint_can_manage(c: Campaign, user) -> bool:
    """Coordinator or any staff member can edit/close/delete a sprint."""
    if not user or not user.is_authenticated:
        return False
    return c.coordinator_id == user.id or bool(user.is_staff)


def _sprint_out(c: Campaign, *, user=None) -> dict:
    """Marshal a Campaign row into the slim sprint envelope.

    ``user`` (optional) lets the response carry ``is_joined`` and
    ``can_manage`` so the frontend can render the right action buttons
    without a second request.
    """
    # Workflow lookup: scan the cached project workflows for the
    # matching ID. Falls back to a placeholder name if the workflow
    # has since been retired.
    zp = c.zooniverse_project
    wid = c.zooniverse_workflow_id
    workflow_name = ""
    classify_url = ""
    if zp:
        base = (
            f"https://www.zooniverse.org/projects/{zp.slug}"
            if zp.slug
            else f"https://www.zooniverse.org/projects/{zp.zooniverse_id}"
        )
        if wid:
            for w in zp.workflows or []:
                if int(w.get("id") or 0) == wid:
                    workflow_name = w.get("display_name") or ""
                    break
            classify_url = f"{base}/classify/workflow/{wid}"
        else:
            classify_url = f"{base}/classify"
    # Participant count only includes still-active opt-ins (left_at IS NULL).
    participant_count = c.sprint_participants.filter(left_at__isnull=True).count()
    is_joined = False
    if user and user.is_authenticated:
        is_joined = c.sprint_participants.filter(
            user=user, left_at__isnull=True
        ).exists()
    # "closed_at" is just ``ends_at`` when status is closed/completed —
    # we don't store a separate column but surfacing it explicitly keeps
    # the UI semantics clearer.
    closed_at = c.ends_at if c.status in {Campaign.Status.CLOSED, Campaign.Status.COMPLETED} else None
    coord = c.coordinator
    coord_display = ""
    if coord:
        if hasattr(coord, "profile") and getattr(coord.profile, "display_name", ""):
            coord_display = coord.profile.display_name
        elif coord.email:
            coord_display = coord.email.split("@")[0]
    return {
        "id": c.id,
        "slug": c.slug,
        "title": c.title,
        "description": c.description,
        "status": c.status,
        "coordinator_email": coord.email if coord else "",
        "coordinator_display_name": coord_display,
        "starts_at": c.starts_at,
        "ends_at": c.ends_at,
        "closed_at": closed_at,
        "workflow_id": wid,
        "workflow_name": workflow_name,
        "workflow_classify_url": classify_url,
        "participant_count": participant_count,
        "is_joined": is_joined,
        "can_manage": _sprint_can_manage(c, user),
        "created_at": c.created_at,
        "zooniverse_project_zid": zp.zooniverse_id if zp else None,
    }


def _unique_sprint_slug(zid: int, title: str) -> str:
    base = slugify(title)[:90] or "sprint"
    candidate = f"zoo-{zid}-{base}"[:160]
    i = 2
    while Campaign.objects.filter(slug=candidate).exists():
        candidate = f"zoo-{zid}-{base}-{i}"[:160]
        i += 1
    return candidate


@router.get(
    "/zooniverse/projects/zid/{zid}/sprints",
    response={200: list[SprintOut], 404: dict},
)
def list_sprints(request: HttpRequest, zid: int):
    """Sprints (Zooniverse-linked campaigns) for a given project."""
    if not ZooniverseProject.objects.filter(zooniverse_id=zid).exists():
        return 404, {"detail": "Project not in catalogue"}
    qs = (
        Campaign.objects.select_related("coordinator", "zooniverse_project", "coordinator__profile")
        .filter(zooniverse_project__zooniverse_id=zid)
        .exclude(status=Campaign.Status.ARCHIVED)
        .order_by("-starts_at")
    )
    user = request.user if request.user.is_authenticated else None
    return 200, [_sprint_out(c, user=user) for c in qs[:200]]


@router.post(
    "/zooniverse/projects/zid/{zid}/sprints",
    response={201: SprintOut, 400: dict, 401: dict, 404: dict},
)
def create_sprint(request: HttpRequest, zid: int, payload: SprintCreateIn):
    """Open a new sprint on a Zooniverse project. Any authenticated
    Astrozor user can organise a sprint — they become the coordinator
    and can close/edit/delete it later.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    zp = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if zp is None:
        return 404, {"detail": "Project not in catalogue"}
    # Sprints attach to the canonical "Citizen Science" umbrella
    # Astrozor project so they don't pollute unrelated projects'
    # campaign lists.
    parent = Project.objects.filter(slug=SPRINT_UMBRELLA_PROJECT_SLUG).first()
    if parent is None:
        parent = Project.objects.create(
            slug=SPRINT_UMBRELLA_PROJECT_SLUG,
            name="Citizen Science",
            description="Astrozor sprinty navázané na Zooniverse projekty.",
            visibility="public",
            created_by=request.user,
        )
    # Validate workflow_id (must belong to the project) — silently drop
    # invalid IDs to keep create resilient.
    wid = payload.workflow_id
    if wid:
        valid = any(int(w.get("id") or 0) == wid for w in (zp.workflows or []))
        if not valid:
            wid = None

    starts_at = payload.starts_at or timezone.now()
    c = Campaign.objects.create(
        project=parent,
        slug=_unique_sprint_slug(zid, payload.title),
        title=payload.title,
        description=payload.description,
        kind=Campaign.Kind.OTHER,
        status=Campaign.Status.OPEN,
        coordinator=request.user,
        starts_at=starts_at,
        ends_at=payload.ends_at,
        zooniverse_project=zp,
        zooniverse_workflow_id=wid,
    )
    # Coordinator auto-joins their own sprint.
    SprintParticipant.objects.get_or_create(sprint=c, user=request.user)
    c = Campaign.objects.select_related(
        "coordinator", "zooniverse_project", "coordinator__profile"
    ).get(pk=c.pk)
    return 201, _sprint_out(c, user=request.user)


@router.patch(
    "/zooniverse/sprints/{slug}",
    response={200: SprintOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def patch_sprint(request: HttpRequest, slug: str, payload: SprintPatchIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    c = (
        Campaign.objects.select_related("coordinator", "zooniverse_project")
        .filter(slug=slug, zooniverse_project__isnull=False)
        .first()
    )
    if c is None:
        return 404, {"detail": "Sprint not found"}
    if not _sprint_can_manage(c, request.user):
        return 403, {"detail": "Only coordinator can edit"}
    data = payload.dict(exclude_unset=True)
    if "workflow_id" in data:
        wid = data.pop("workflow_id")
        if wid:
            zp = c.zooniverse_project
            valid = any(
                int(w.get("id") or 0) == wid for w in (zp.workflows or [])
            ) if zp else False
            c.zooniverse_workflow_id = wid if valid else None
        else:
            c.zooniverse_workflow_id = None
    for field, value in data.items():
        setattr(c, field, value)
    c.save()
    return 200, _sprint_out(c, user=request.user)


@router.post(
    "/zooniverse/sprints/{slug}/close",
    response={200: SprintOut, 401: dict, 403: dict, 404: dict},
)
def close_sprint(request: HttpRequest, slug: str):
    """Manually close a sprint — stamps ``ends_at = now()`` and flips
    status to ``closed``. Used for open-ended sprints (no fixed end
    date set at creation) or for early termination of dated sprints.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    c = (
        Campaign.objects.select_related("coordinator", "zooniverse_project")
        .filter(slug=slug, zooniverse_project__isnull=False)
        .first()
    )
    if c is None:
        return 404, {"detail": "Sprint not found"}
    if not _sprint_can_manage(c, request.user):
        return 403, {"detail": "Only coordinator can close"}
    now = timezone.now()
    c.ends_at = now
    c.status = Campaign.Status.CLOSED
    c.save(update_fields=["ends_at", "status", "updated_at"])
    return 200, _sprint_out(c, user=request.user)


@router.delete(
    "/zooniverse/sprints/{slug}",
    response={204: dict, 401: dict, 403: dict, 404: dict},
)
def delete_sprint(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    c = Campaign.objects.filter(slug=slug, zooniverse_project__isnull=False).first()
    if c is None:
        return 404, {"detail": "Sprint not found"}
    if not _sprint_can_manage(c, request.user):
        return 403, {"detail": "Only coordinator can delete"}
    c.delete()
    return 204, {"detail": "Deleted"}


@router.post(
    "/zooniverse/sprints/{slug}/join",
    response={200: SprintOut, 401: dict, 404: dict},
)
def join_sprint(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    c = (
        Campaign.objects.select_related("coordinator", "zooniverse_project")
        .filter(slug=slug, zooniverse_project__isnull=False)
        .first()
    )
    if c is None:
        return 404, {"detail": "Sprint not found"}
    sp, created = SprintParticipant.objects.get_or_create(
        sprint=c, user=request.user
    )
    # Re-joining after a previous leave: clear left_at so the row counts.
    if not created and sp.left_at is not None:
        sp.left_at = None
        sp.save(update_fields=["left_at"])
    return 200, _sprint_out(c, user=request.user)


@router.post(
    "/zooniverse/sprints/{slug}/leave",
    response={200: SprintOut, 401: dict, 404: dict},
)
def leave_sprint(request: HttpRequest, slug: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    c = (
        Campaign.objects.select_related("coordinator", "zooniverse_project")
        .filter(slug=slug, zooniverse_project__isnull=False)
        .first()
    )
    if c is None:
        return 404, {"detail": "Sprint not found"}
    # Soft delete via left_at so historical joins stay queryable.
    SprintParticipant.objects.filter(sprint=c, user=request.user).update(
        left_at=timezone.now()
    )
    return 200, _sprint_out(c, user=request.user)


@router.get(
    "/zooniverse/sprints/{slug}/stats",
    response={200: SprintStatsOut, 404: dict},
)
def get_sprint_stats(request: HttpRequest, slug: str):  # noqa: ARG001
    """Per-sprint stats from ERAS: total classifications + top contributors
    scoped to the sprint window AND the linked Zooniverse project.

    Open sprints use ``today`` as the implicit end date so stats are
    "what happened so far". Closed sprints use their committed ends_at.
    """
    from datetime import date as date_cls

    from .zooniverse import Eras

    c = (
        Campaign.objects.select_related("zooniverse_project")
        .filter(slug=slug, zooniverse_project__isnull=False)
        .first()
    )
    if c is None:
        return 404, {"detail": "Sprint not found"}
    zp = c.zooniverse_project
    gid = int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0)
    starts_at = c.starts_at
    ends_at = c.ends_at
    is_open = c.status == Campaign.Status.OPEN
    # ERAS expects yyyy-mm-dd. Default window:
    #   * Closed sprint  → starts..ends (exact committed window)
    #   * Open w/ end    → starts..min(ends, today) — show progress so far
    #   * Open-ended     → starts..today
    # Missing starts_at → unscoped (whole-life classifications).
    start_iso = starts_at.date().isoformat() if starts_at else None
    today = date_cls.today()
    if ends_at:
        # For open sprints, never look into the future — clamp to today
        # so the displayed numbers match reality.
        eff_end = min(ends_at.date(), today) if is_open else ends_at.date()
        end_iso = eff_end.isoformat()
    else:
        end_iso = today.isoformat()
    total = 0
    time_spent = None
    active = 0
    contributors_raw: list[dict] = []
    if gid and zp:
        try:
            r = Eras(token=None).group_total(
                gid,
                start_date=start_iso,
                end_date=end_iso,
                project_id=zp.zooniverse_id,
                top_contributors=10,
            )
            total = int(r.get("total_count") or 0)
            time_spent = _to_int_seconds(r.get("time_spent"))
            active = int(r.get("active_users") or 0)
            contributors_raw = r.get("top_contributors") or []
        except ZooniverseError:
            pass

    # Resolve contributor handles (same approach as dashboard).
    from apps.accounts.models import Identity

    contributors: list[dict] = []
    p_client = Panoptes(token=None)
    for row in contributors_raw[:10]:
        uid = int(row.get("user_id") or 0)
        if not uid:
            continue
        contrib = {
            "zooniverse_user_id": uid,
            "login": "",
            "display_name": "",
            "avatar_url": "",
            "count": int(row.get("count") or 0),
            "time_spent_s": _to_int_seconds(
                row.get("session_time") or row.get("time_spent")
            ),
            "astrozor_email": None,
        }
        ident = (
            Identity.objects.filter(provider="zooniverse", provider_user_id=str(uid))
            .select_related("user")
            .first()
        )
        if ident:
            contrib["login"] = ident.provider_username or ""
            contrib["display_name"] = ident.display_name or ident.provider_username or ""
            contrib["avatar_url"] = ident.avatar_url or ""
            contrib["astrozor_email"] = ident.user.email if ident.user else None
        else:
            try:
                u = p_client.get_user(uid)
                contrib["login"] = u.get("login") or ""
                contrib["display_name"] = (
                    u.get("display_name") or u.get("credited_name") or contrib["login"]
                )
                contrib["avatar_url"] = u.get("avatar_src") or ""
            except ZooniverseError:
                pass
        contributors.append(contrib)

    participants = c.sprint_participants.filter(left_at__isnull=True).count()
    return 200, {
        "sprint_slug": c.slug,
        "starts_at": c.starts_at,
        "ends_at": c.ends_at,
        "is_open": is_open,
        "total_classifications": total,
        "active_users": active,
        "time_spent_s": time_spent,
        "top_contributors": contributors,
        "participants": participants,
        "fetched_at": timezone.now(),
    }


def _to_int_seconds(v):
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


@router.post(
    "/zooniverse/membership/refresh",
    response={200: ZooniverseMembershipOut, 401: dict},
)
def refresh_zooniverse_membership(request: HttpRequest):
    """Force a Panoptes round-trip to check membership for this user.

    Used right after the user clicks the join-link and comes back to
    Astrozor — instead of waiting for the 6 h beat, we poke Panoptes
    and flip the flag immediately.
    """
    from apps.accounts.models import Identity

    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    ident = Identity.objects.filter(
        user=request.user, provider="zooniverse"
    ).first()
    if ident is None:
        return get_zooniverse_membership(request)
    gid = int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0)
    if gid:
        try:
            zid = int(ident.provider_user_id or 0)
            members = set(Panoptes(token=service_token()).list_group_member_ids(gid))
            ident.zooniverse_in_group = zid in members
            ident.zooniverse_membership_synced_at = timezone.now()
            ident.save(
                update_fields=[
                    "zooniverse_in_group",
                    "zooniverse_membership_synced_at",
                ]
            )
        except (ZooniverseError, ValueError):
            pass
    return get_zooniverse_membership(request)


# ---- Read-only Talk widget (Zooniverse community discussion) ----


@router.get(
    "/zooniverse/projects/zid/{zid}/talk/boards",
    response={200: ZooniverseTalkBoardsOut, 404: dict},
)
def get_zooniverse_talk_boards(request: HttpRequest, zid: int):  # noqa: ARG001
    """Proxy the public Talk boards endpoint for a Zooniverse project.

    Renders as the "Zooniverse Talk" widget on the project detail page
    — pure read-through, no caching beyond the client's React Query
    layer. Posting on Talk requires Zooniverse OAuth which Astrozor
    doesn't relay; the widget's CTA opens the official Talk URL in a
    new tab so the user can chat after signing in upstream.
    """
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not in catalogue"}
    base_talk_url = (
        f"https://www.zooniverse.org/projects/{p.slug}/talk"
        if p.slug
        else f"https://www.zooniverse.org/projects/{zid}/talk"
    )
    boards_out: list[dict] = []
    try:
        rows = talk_list_boards(zid)
    except ZooniverseError:
        rows = []
    for b in rows:
        try:
            bid = int(b.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if not bid:
            continue
        boards_out.append(
            {
                "id": bid,
                "title": (b.get("title") or "")[:120],
                "description": (b.get("description") or "")[:240],
                "discussions_count": int(b.get("discussions_count") or 0),
                "comments_count": int(b.get("comments_count") or 0),
                "subject_default": bool(b.get("subject_default", False)),
                # Deep-link into the board on the official Talk UI.
                "talk_url": f"{base_talk_url}/{bid}",
            }
        )
    return 200, {
        "project_zid": zid,
        "talk_url": base_talk_url,
        "boards": boards_out,
    }


# ---- Subject picker: favorites + collections ----


def _subject_to_resolved(
    subj: dict, *, project_slug_cache: dict[int, str] | None = None
) -> dict:
    """Build a ``ZooniverseSubjectResolvedOut`` envelope from a raw
    Panoptes subject dict.

    Centralised here because the same shape is built three ways:
    via the single-subject resolver, via the favorites listing, and
    via the per-collection subject listing. The slug cache lets
    callers amortise the catalogue lookup over many subjects.
    """
    try:
        sid = int(subj.get("id") or 0)
    except (TypeError, ValueError):
        sid = 0
    links = subj.get("links") or {}
    try:
        project_zid = int(links.get("project") or 0)
    except (TypeError, ValueError):
        project_zid = 0
    # Re-derive location_media if not already populated (raw Panoptes
    # listing endpoints leave ``locations`` as the original dict shape).
    media = subj.get("location_media")
    if not media:
        media = []
        for loc in subj.get("locations") or []:
            if isinstance(loc, dict):
                for mime, url in loc.items():
                    if isinstance(url, str) and url.startswith("http"):
                        media.append({"url": url, "mime": str(mime)[:80]})
            elif isinstance(loc, str) and loc.startswith("http"):
                media.append({"url": loc, "mime": ""})
    locations = [m["url"] for m in media]
    if project_slug_cache is None:
        project_slug_cache = {}
    slug = project_slug_cache.get(project_zid, None)
    if slug is None:
        slug = _project_slug_for_zid(project_zid) if project_zid else ""
        project_slug_cache[project_zid] = slug
    project_base = (
        f"https://www.zooniverse.org/projects/{slug}"
        if slug
        else (
            f"https://www.zooniverse.org/projects/{project_zid}"
            if project_zid
            else "https://www.zooniverse.org"
        )
    )
    title_meta = ""
    meta = subj.get("metadata") or {}
    for key in ("title", "name", "#filename", "filename"):
        if isinstance(meta.get(key), str) and meta[key].strip():
            title_meta = meta[key][:200]
            break
    return {
        "subject_id": str(sid),
        "project_zid": project_zid,
        "media": media[:8],
        "locations": locations[:8],
        "classify_url": f"{project_base}/classify",
        "talk_url": f"https://www.zooniverse.org/talk/subjects/{sid}",
        "title": title_meta,
    }


def _favorites_collection_id(
    panoptes: Panoptes, owner_login: str
) -> int | None:
    """Resolve the implicit favorites collection ID for a user.

    Each Zooniverse user has at most one ``favorite=true`` collection.
    We look it up once per request and cache the ID in the caller's
    closure if needed.
    """
    if not owner_login:
        return None
    try:
        data = panoptes.list_collections(
            owner=owner_login, favorite=True, page_size=5
        )
    except ZooniverseError:
        return None
    items = data.get("collections") or []
    for c in items:
        try:
            return int(c.get("id") or 0)
        except (TypeError, ValueError):
            continue
    return None


@router.get(
    "/zooniverse/my-favorites",
    response={200: ZooniverseSubjectListOut, 401: dict, 404: dict},
)
def list_my_favorites(
    request: HttpRequest,
    page: int = 1,
    page_size: int = 24,
    project_zid: int | None = None,
):
    """Subjects in the current user's "Favorites" collection.

    Requires a linked Zooniverse identity (the favorites collection
    is private — needs the user's bearer). ``project_zid`` filters
    client-side after fetching (Panoptes doesn't take a project
    filter on subject listings by collection, but most users have
    few favorites so we tolerate the over-fetch).
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    ident, needs_reconnect = _zoo_identity_state(request.user)
    if ident is None or not (ident.provider_username or ident.provider_user_id):
        return 200, {
            "items": [],
            "page": page,
            "page_size": page_size,
            "total": 0,
            "needs_reconnect": False,
        }
    token = _user_panoptes_token(request.user)
    if token is None:
        return 200, {
            "items": [],
            "page": page,
            "page_size": page_size,
            "total": 0,
            "needs_reconnect": needs_reconnect,
        }
    panoptes = Panoptes(token=token)
    coll_id = _favorites_collection_id(panoptes, ident.provider_username or "")
    if not coll_id:
        return 200, {"items": [], "page": page, "page_size": page_size, "total": 0}
    try:
        data = panoptes.list_subjects_in_collection(
            coll_id, page=page, page_size=page_size
        )
    except ZooniverseError:
        return 200, {"items": [], "page": page, "page_size": page_size, "total": 0}
    rows = data.get("subjects") or []
    meta = (data.get("meta") or {}).get("subjects") or {}
    slug_cache: dict[int, str] = {}
    items = [_subject_to_resolved(s, project_slug_cache=slug_cache) for s in rows]
    if project_zid:
        items = [it for it in items if it["project_zid"] == project_zid]
    return 200, {
        "items": items,
        "page": int(meta.get("page") or page),
        "page_size": int(meta.get("page_size") or page_size),
        "total": int(meta.get("count") or 0),
    }


@router.get(
    "/zooniverse/my-collections",
    response={200: ZooniverseCollectionListOut, 401: dict},
)
def list_my_collections(
    request: HttpRequest,
    page: int = 1,
    page_size: int = 20,
    project_zid: int | None = None,
):
    """List the current user's owned collections (excludes the
    auto-favorites one — that has its own endpoint).

    Returns a thumbnail URL when the first subject's media is fetchable
    without an extra round-trip; otherwise an empty string and the
    frontend falls back to a 📁 icon.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    ident, needs_reconnect = _zoo_identity_state(request.user)
    if ident is None or not ident.provider_username:
        return 200, {"items": [], "needs_reconnect": False}
    token = _user_panoptes_token(request.user)
    if token is None:
        return 200, {"items": [], "needs_reconnect": needs_reconnect}
    panoptes = Panoptes(token=token)
    try:
        data = panoptes.list_collections(
            owner=ident.provider_username,
            favorite=False,
            page=page,
            page_size=page_size,
            project_id=project_zid,
        )
    except ZooniverseError:
        return 200, {"items": [], "needs_reconnect": False}
    rows = data.get("collections") or []
    out: list[dict] = []
    for c in rows:
        try:
            cid = int(c.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if not cid:
            continue
        links = c.get("links") or {}
        sids = links.get("subjects") or []
        out.append(
            {
                "id": cid,
                "display_name": (c.get("display_name") or "")[:200],
                "favorite": bool(c.get("favorite", False)),
                "private": bool(c.get("private", False)),
                "subjects_count": len(sids) if isinstance(sids, list) else 0,
                # Preview URL needs a separate fetch for the first subject;
                # skipped here to keep the listing cheap. Frontend will
                # render a generic 📁 placeholder.
                "preview_url": "",
            }
        )
    return 200, {"items": out, "needs_reconnect": False}


@router.get(
    "/zooniverse/my-recent-classifications",
    response={200: ZooniverseSubjectListOut, 401: dict},
)
def list_my_recent_classifications(
    request: HttpRequest,
    project_zid: int | None = None,
    limit: int = 24,
):
    """Subjects the current user has most recently classified.

    Two-step fetch:

    1. ``GET /classifications?user_id=<X>&project_id=<P>&page_size=N``
       returns the user's recent classification events. Each event
       has ``links.subjects: [id]`` pointing at the classified subject.
    2. ``GET /subjects?id=1,2,3...`` batch-resolves the subject media
       so the picker can render thumbnails.

    Dedupes by subject_id (a user often classifies the same subject
    multiple times — once is enough in the picker), preserving the
    order of first occurrence so the most recently-touched subjects
    bubble to the top.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    ident, needs_reconnect = _zoo_identity_state(request.user)
    if ident is None:
        return 200, {
            "items": [],
            "page": 1,
            "page_size": limit,
            "total": 0,
            "needs_reconnect": False,
        }
    try:
        user_zid = int(ident.provider_user_id or 0)
    except (TypeError, ValueError):
        user_zid = 0
    token = _user_panoptes_token(request.user)
    if not user_zid or token is None:
        return 200, {
            "items": [],
            "page": 1,
            "page_size": limit,
            "total": 0,
            "needs_reconnect": needs_reconnect,
        }

    panoptes = Panoptes(token=token)
    limit = max(1, min(int(limit or 24), 50))
    # Over-fetch a little because dedup may collapse rows: the user
    # might have classified the same subject 3× consecutively.
    page_size = min(limit * 2, 50)
    params: dict[str, object] = {
        "user_id": user_zid,
        "page_size": page_size,
        "sort": "-created_at",
    }
    if project_zid:
        params["project_id"] = project_zid
    try:
        data = panoptes._request("GET", "/classifications", params=params)
    except ZooniverseError:
        return 200, {"items": [], "page": 1, "page_size": limit, "total": 0}
    rows = data.get("classifications") or []
    seen: set[int] = set()
    ordered_ids: list[int] = []
    for c in rows:
        for raw in ((c.get("links") or {}).get("subjects") or []):
            try:
                sid = int(raw)
            except (TypeError, ValueError):
                continue
            if sid in seen:
                continue
            seen.add(sid)
            ordered_ids.append(sid)
            if len(ordered_ids) >= limit:
                break
        if len(ordered_ids) >= limit:
            break
    if not ordered_ids:
        return 200, {"items": [], "page": 1, "page_size": limit, "total": 0}
    try:
        subjects = panoptes.list_subjects_by_ids(ordered_ids)
    except ZooniverseError:
        return 200, {"items": [], "page": 1, "page_size": limit, "total": 0}
    # Panoptes returns the batch in its own order; restore the
    # classification-recency order so the most-recent is first.
    by_id: dict[int, dict] = {}
    for s in subjects:
        try:
            by_id[int(s.get("id") or 0)] = s
        except (TypeError, ValueError):
            continue
    slug_cache: dict[int, str] = {}
    items = [
        _subject_to_resolved(by_id[sid], project_slug_cache=slug_cache)
        for sid in ordered_ids
        if sid in by_id
    ]
    return 200, {
        "items": items,
        "page": 1,
        "page_size": limit,
        "total": len(items),
    }


@router.get(
    "/zooniverse/collections/{collection_id}/subjects",
    response={200: ZooniverseSubjectListOut, 401: dict, 404: dict},
)
def list_collection_subjects(
    request: HttpRequest,
    collection_id: int,
    page: int = 1,
    page_size: int = 24,
):
    """Subjects inside a specific collection. Same shape as
    ``/my-favorites`` so the picker can render either tab with the
    same component."""
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    token = _user_panoptes_token(request.user)
    if token is None:
        return 200, {"items": [], "page": page, "page_size": page_size, "total": 0}
    panoptes = Panoptes(token=token)
    try:
        data = panoptes.list_subjects_in_collection(
            collection_id, page=page, page_size=page_size
        )
    except ZooniverseError as e:
        if e.status == 404:
            return 404, {"detail": "Collection not found"}
        return 200, {"items": [], "page": page, "page_size": page_size, "total": 0}
    rows = data.get("subjects") or []
    meta = (data.get("meta") or {}).get("subjects") or {}
    slug_cache: dict[int, str] = {}
    items = [_subject_to_resolved(s, project_slug_cache=slug_cache) for s in rows]
    return 200, {
        "items": items,
        "page": int(meta.get("page") or page),
        "page_size": int(meta.get("page_size") or page_size),
        "total": int(meta.get("count") or 0),
    }


# ---- Talk browse (boards → discussions → comments) ----


def _talk_discussion_out(d: dict, *, project_slug: str = "", board_id: int = 0) -> dict:
    """Marshal a raw Talk discussion envelope into the wire shape."""
    try:
        d_id = int(d.get("id") or 0)
    except (TypeError, ValueError):
        d_id = 0
    bid = board_id or int(d.get("board_id") or 0)
    project_zid_raw = d.get("project_id") or "0"
    talk_base = (
        f"https://www.zooniverse.org/projects/{project_slug}/talk"
        if project_slug
        else f"https://www.zooniverse.org/projects/{project_zid_raw}/talk"
    )
    latest = d.get("latest_comment") or {}
    excerpt = (latest.get("body") or "")[:240]
    focus_type = d.get("focus_type") or ""
    try:
        focus_id = int(d.get("focus_id") or 0)
    except (TypeError, ValueError):
        focus_id = 0
    # Subject-bound discussions get the cleaner /talk/subjects/<id>
    # URL; the rest land on /talk/<board>/<discussion>.
    if focus_type == "Subject" and focus_id:
        talk_url = f"{talk_base}/subjects/{focus_id}"
    elif bid and d_id:
        talk_url = f"{talk_base}/{bid}/{d_id}"
    else:
        talk_url = talk_base
    try:
        user_id = int(d.get("user_id") or 0)
    except (TypeError, ValueError):
        user_id = 0
    return {
        "id": d_id,
        "title": (d.get("title") or "")[:200],
        "board_id": bid,
        "user_id": user_id,
        "user_login": (d.get("user_login") or "")[:80],
        "comments_count": int(d.get("comments_count") or 0),
        "users_count": int(d.get("users_count") or 0),
        "last_comment_created_at": d.get("last_comment_created_at") or "",
        "created_at": d.get("created_at") or "",
        "sticky": bool(d.get("sticky", False)),
        "locked": bool(d.get("locked", False)),
        "focus_id": focus_id,
        "focus_type": focus_type,
        "talk_url": talk_url,
        "latest_comment_excerpt": excerpt,
    }


# Allowed tags for Talk comment rendering. Talk uses markdown which
# we render server-side to HTML via markdown lib, then scrub through
# the same allowlist as place chat (slightly different — supports
# images from panoptes-uploads + zooniverse media because Talk users
# embed subject thumbnails inline).
_TALK_ALLOWED_TAGS = [
    "b", "strong", "i", "em", "u", "s", "del",
    "code", "pre",
    "p", "br", "hr",
    "ul", "ol", "li",
    "blockquote",
    "a", "img",
    "h1", "h2", "h3", "h4", "h5", "h6",
]
_TALK_ALLOWED_ATTRS = {
    "a": ["href", "title"],
    "img": ["src", "alt", "title"],
}
_TALK_IMG_HOSTS = {
    "panoptes-uploads.zooniverse.org",
    "static.zooniverse.org",
    "www.zooniverse.org",
    "zooniverse.org",
}


def _talk_render_body(body: str) -> str:
    """Render Talk's markdown body to safe HTML.

    Talk stores raw markdown (``body``); the public Zooniverse client
    renders it. We re-do that server-side so the Astrozor browser
    gets just sanitised HTML — no markdown lib needed on the client.
    """
    import bleach
    from markdown_it import MarkdownIt

    if not body:
        return ""

    def img_filter(tag: str, name: str, value: str) -> bool:
        if tag != "img":
            return name in _TALK_ALLOWED_ATTRS.get(tag, [])
        if name == "src":
            try:
                from urllib.parse import urlparse

                host = (urlparse(value).hostname or "").lower()
            except Exception:
                return False
            return host in _TALK_IMG_HOSTS
        return name in ("alt", "title")

    # ``commonmark`` preset + breaks (Talk renders newlines as <br>)
    # + linkify (bare URLs become <a>). No HTML passthrough — anything
    # the user typed as raw HTML stays as text.
    html = (
        MarkdownIt("commonmark", {"linkify": True, "breaks": True})
        .enable("linkify")
        .render(body)
    )
    attrs = {**_TALK_ALLOWED_ATTRS, "img": img_filter}
    return bleach.clean(
        html,
        tags=_TALK_ALLOWED_TAGS,
        attributes=attrs,
        protocols=["http", "https", "mailto"],
        strip=True,
    )


def _talk_comment_out(c: dict) -> dict:
    try:
        cid = int(c.get("id") or 0)
        user_id = int(c.get("user_id") or 0)
    except (TypeError, ValueError):
        cid = 0
        user_id = 0
    try:
        reply_id = int(c.get("reply_id") or 0)
    except (TypeError, ValueError):
        reply_id = 0
    return {
        "id": cid,
        "body_html": _talk_render_body(c.get("body") or ""),
        "user_id": user_id,
        "user_login": (c.get("user_login") or "")[:80],
        "user_display_name": (c.get("user_display_name") or "")[:120],
        "created_at": c.get("created_at") or "",
        "upvotes": int(c.get("upvotes") or 0),
        "is_deleted": bool(c.get("is_deleted", False)),
        "reply_id": reply_id,
    }


def _project_slug_for_zid(zid: int) -> str:
    """Best-effort lookup of the project slug from our catalogue.
    Falls back to numeric zid in URLs when not catalogued."""
    if not zid:
        return ""
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).only("slug").first()
    return p.slug if p else ""


@router.get(
    "/zooniverse/talk/boards/{board_id}/discussions",
    response={200: ZooniverseTalkDiscussionListOut},
)
def list_talk_discussions(
    request: HttpRequest,  # noqa: ARG001
    board_id: int,
    page: int = 1,
    page_size: int = 20,
):
    """Paged discussion list inside a Talk board."""
    try:
        data = talk_list_discussions(
            board_id=board_id, page=page, page_size=page_size
        )
    except ZooniverseError:
        return 200, {
            "items": [],
            "page": page,
            "page_size": page_size,
            "page_count": 0,
            "total": 0,
        }
    rows = data.get("discussions") or []
    # Resolve project slug from the first discussion (all rows share
    # the same project under one board).
    project_zid = 0
    if rows:
        try:
            project_zid = int(rows[0].get("project_id") or 0)
        except (TypeError, ValueError):
            project_zid = 0
    slug = _project_slug_for_zid(project_zid)
    items = [_talk_discussion_out(d, project_slug=slug, board_id=board_id) for d in rows]
    meta = (data.get("meta") or {}).get("discussions") or {}
    return 200, {
        "items": items,
        "page": int(meta.get("page") or page),
        "page_size": int(meta.get("page_size") or page_size),
        "page_count": int(meta.get("page_count") or 0),
        "total": int(meta.get("count") or 0),
    }


@router.get(
    "/zooniverse/talk/discussions/{discussion_id}",
    response={200: ZooniverseTalkDiscussionDetailOut, 404: dict},
)
def get_talk_discussion(
    request: HttpRequest,  # noqa: ARG001
    discussion_id: int,
    page: int = 1,
    page_size: int = 30,
):
    """One discussion + a page of comments. ``page`` selects the
    comment page — discussions can have hundreds of comments, so we
    don't render the whole thread at once."""
    try:
        d = talk_get_discussion(discussion_id)
    except ZooniverseError as e:
        if e.status == 404:
            return 404, {"detail": "Discussion not found"}
        return 404, {"detail": str(e)}
    try:
        cdata = talk_list_comments(discussion_id, page=page, page_size=page_size)
    except ZooniverseError:
        cdata = {"comments": [], "meta": {}}
    rows = cdata.get("comments") or []
    cmeta = (cdata.get("meta") or {}).get("comments") or {}
    try:
        project_zid = int(d.get("project_id") or 0)
    except (TypeError, ValueError):
        project_zid = 0
    slug = _project_slug_for_zid(project_zid)
    talk_base = (
        f"https://www.zooniverse.org/projects/{slug}/talk"
        if slug
        else f"https://www.zooniverse.org/projects/{project_zid}/talk"
    )
    try:
        focus_id = int(d.get("focus_id") or 0)
    except (TypeError, ValueError):
        focus_id = 0
    focus_type = d.get("focus_type") or ""
    if focus_type == "Subject" and focus_id:
        talk_url = f"{talk_base}/subjects/{focus_id}"
    else:
        bid = int(d.get("board_id") or 0)
        talk_url = (
            f"{talk_base}/{bid}/{discussion_id}" if bid else talk_base
        )
    # Board title comes via the comment envelope (it carries
    # ``board_title``); if we have no comments, ride without it.
    board_title = ""
    if rows:
        board_title = (rows[0].get("board_title") or "")[:200]
    return 200, {
        "id": discussion_id,
        "title": (d.get("title") or "")[:200],
        "board_id": int(d.get("board_id") or 0),
        "board_title": board_title,
        "focus_id": focus_id,
        "focus_type": focus_type,
        "locked": bool(d.get("locked", False)),
        "sticky": bool(d.get("sticky", False)),
        "user_login": (d.get("user_login") or "")[:80],
        "created_at": d.get("created_at") or "",
        "talk_url": talk_url,
        "comments": [_talk_comment_out(c) for c in rows],
        "comments_page": int(cmeta.get("page") or page),
        "comments_page_size": int(cmeta.get("page_size") or page_size),
        "comments_page_count": int(cmeta.get("page_count") or 0),
        "comments_total": int(cmeta.get("count") or 0),
    }


@router.get(
    "/zooniverse/talk/subjects/{subject_id}",
    response={200: ZooniverseTalkSubjectViewOut, 400: dict, 404: dict},
)
def get_talk_subject_view(request: HttpRequest, subject_id: int):  # noqa: ARG001
    """Bundled view of a Zooniverse subject: the subject media plus
    every Talk discussion focused on it.

    Mirrors what ``/projects/<slug>/talk/subjects/<id>`` shows on
    Zooniverse itself — the subject card on top, then the threads
    underneath. Read-only.
    """
    try:
        subj = Panoptes(token=None).get_subject(subject_id)
    except ZooniverseError as e:
        if e.status == 404:
            return 404, {"detail": "Subject not found"}
        return 400, {"detail": str(e)}
    try:
        project_zid = int((subj.get("links") or {}).get("project") or 0)
    except (TypeError, ValueError):
        project_zid = 0
    slug = _project_slug_for_zid(project_zid)
    if slug:
        project_base = f"https://www.zooniverse.org/projects/{slug}"
    else:
        project_base = f"https://www.zooniverse.org/projects/{project_zid or ''}".rstrip(
            "/"
        )
    classify_url = f"{project_base}/classify" if project_base else ""
    talk_url = f"https://www.zooniverse.org/talk/subjects/{subject_id}"
    title_meta = ""
    meta = subj.get("metadata") or {}
    for key in ("title", "name", "#filename", "filename"):
        if isinstance(meta.get(key), str) and meta[key].strip():
            title_meta = meta[key][:200]
            break
    subject_out = {
        "subject_id": str(subject_id),
        "project_zid": project_zid,
        "media": [
            {"url": m.get("url") or "", "mime": m.get("mime") or ""}
            for m in (subj.get("location_media") or [])[:8]
            if m.get("url")
        ],
        "locations": (subj.get("location_urls") or [])[:8],
        "classify_url": classify_url,
        "talk_url": talk_url,
        "title": title_meta,
    }
    discussions: list[dict] = []
    total = 0
    try:
        data = talk_list_discussions(
            focus_id=subject_id, focus_type="Subject", page=1, page_size=20
        )
        rows = data.get("discussions") or []
        total = int(((data.get("meta") or {}).get("discussions") or {}).get("count") or 0)
        discussions = [
            _talk_discussion_out(d, project_slug=slug) for d in rows
        ]
    except ZooniverseError:
        pass
    return 200, {
        "subject": subject_out,
        "discussions": discussions,
        "discussions_total": total,
    }


# ---- Sprint chat (Zooniverse sprint discussion) ----


def _sprint_chat_can_view(c: Campaign, user) -> bool:
    """Sprint chat is members-only: an active SprintParticipant row
    (``left_at IS NULL``) is required to read or write. Coordinator
    and staff bypass via :func:`_sprint_can_manage`.
    """
    if _sprint_can_manage(c, user):
        return True
    if not user or not user.is_authenticated:
        return False
    return SprintParticipant.objects.filter(
        sprint=c, user=user, left_at__isnull=True
    ).exists()


@router.get(
    "/zooniverse/sprints/{slug}/chat",
    response={200: MessageListOut, 401: dict, 403: dict, 404: dict},
)
def list_sprint_chat(request: HttpRequest, slug: str, limit: int = 200):
    from apps.chat.models import Message as ChatMessage
    from apps.chat.sanitize import message_out

    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    c = Campaign.objects.filter(
        slug=slug, zooniverse_project__isnull=False
    ).first()
    if c is None:
        return 404, {"detail": "Sprint not found"}
    if not _sprint_chat_can_view(c, request.user):
        return 403, {"detail": "Join the sprint to read its chat"}
    limit = max(1, min(int(limit or 200), 500))
    qs = (
        ChatMessage.objects.filter(sprint=c, deleted_at__isnull=True)
        .select_related("user", "user__profile")
        .order_by("created_at")[:limit]
    )
    items = list(qs)
    return 200, {
        "count": len(items),
        "items": [message_out(m, sprint_slug=c.slug) for m in items],
    }


@router.post(
    "/zooniverse/sprints/{slug}/chat",
    response={201: MessageOut, 400: dict, 401: dict, 403: dict, 404: dict},
)
def post_sprint_chat(request: HttpRequest, slug: str, payload: MessageIn):
    """Post a new message into a sprint discussion.

    Accepts the same :class:`apps.chat.schemas.MessageIn` payload as
    place chat — text, attachments, optional parent_id (for threaded
    replies). Sprint chat additionally accepts ``zoo_subject``
    attachments produced by the subject resolver.
    """
    from apps.chat.models import Message as ChatMessage
    from apps.chat.sanitize import (
        auto_youtube_attachments,
        message_out,
        safe_text,
        sanitize_attachments,
    )

    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required"}
    c = Campaign.objects.filter(
        slug=slug, zooniverse_project__isnull=False
    ).first()
    if c is None:
        return 404, {"detail": "Sprint not found"}
    if not _sprint_chat_can_view(c, request.user):
        return 403, {"detail": "Join the sprint to post in its chat"}

    text = safe_text(payload.text or "")
    attachments = sanitize_attachments(payload.attachments or [])
    existing_yt = {a["video_id"] for a in attachments if a.get("kind") == "youtube"}
    for auto in auto_youtube_attachments(text):
        if auto["video_id"] not in existing_yt:
            attachments.append(auto)
            existing_yt.add(auto["video_id"])

    if not text and not attachments:
        return 400, {"detail": "Message must have text or at least one attachment"}

    parent = None
    if payload.parent_id:
        parent = (
            ChatMessage.objects.filter(
                id=payload.parent_id, sprint=c, deleted_at__isnull=True
            ).first()
        )
        if parent is None:
            return 400, {"detail": "Parent message not found"}

    msg = ChatMessage.objects.create(
        sprint=c,
        user=request.user,
        parent=parent,
        text=text,
        attachments=attachments,
    )
    msg.user = request.user
    return 201, message_out(msg, sprint_slug=c.slug)


# ---- Subject resolver (sprint chat attachment picker) ----


_SUBJECT_ID_RE = re.compile(r"/subjects?/(?P<id>\d+)")
_SUBJECT_ID_QS = re.compile(r"[?&]subject_id=(?P<id>\d+)")


def _parse_subject_id(raw: str) -> int | None:
    """Accept a bare integer, a Talk URL, or a classifier URL.

    Examples::

        "12345678"
        "https://www.zooniverse.org/talk/subjects/12345678"
        "https://www.zooniverse.org/projects/zookeeper/galaxy-zoo/talk/2112/12345678"
        "https://www.zooniverse.org/projects/.../classify/workflow/.../subject/12345678"
    """
    s = (raw or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    m = _SUBJECT_ID_RE.search(s)
    if m:
        return int(m.group("id"))
    m = _SUBJECT_ID_QS.search(s)
    if m:
        return int(m.group("id"))
    # Last digit cluster fallback — handles paths we don't explicitly
    # recognize but that end in /<id> (still tightly scoped to
    # zooniverse.org by the frontend before calling).
    tail = re.search(r"(\d{4,})/?$", s)
    if tail:
        return int(tail.group(1))
    return None


@router.get(
    "/zooniverse/subjects/resolve",
    response={200: ZooniverseSubjectResolvedOut, 400: dict, 401: dict, 404: dict},
)
def resolve_zooniverse_subject(request: HttpRequest, q: str):
    """Look up a Zooniverse subject by ID / URL and return a sprint-chat
    attachment envelope.

    Gated behind authentication so the endpoint can't be abused as a
    free Panoptes proxy. Anonymous reads on Panoptes are public, but
    we still don't want to expose the lookup unauthenticated — sprint
    chat is the only legitimate caller.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    sid = _parse_subject_id(q)
    if not sid:
        return 400, {
            "detail": "Pass a numeric subject ID or a Zooniverse subject/talk URL."
        }
    try:
        subj = Panoptes(token=None).get_subject(sid)
    except ZooniverseError as e:
        if e.status == 404:
            return 404, {"detail": f"Subject {sid} not found on Zooniverse"}
        return 400, {"detail": f"Panoptes lookup failed: {e}"}

    links = subj.get("links") or {}
    project_zid = 0
    try:
        project_zid = int(links.get("project") or 0)
    except (TypeError, ValueError):
        project_zid = 0
    media = subj.get("location_media") or []
    locations = subj.get("location_urls") or []
    # Resolve the project slug (and a workflow link for the classifier
    # deep-link). Falls back to the numeric ID in the URL if we don't
    # have the project catalogued — keeps the link functional even for
    # subjects belonging to projects we haven't added.
    zp = (
        ZooniverseProject.objects.filter(zooniverse_id=project_zid).first()
        if project_zid
        else None
    )
    if zp and zp.slug:
        project_base = f"https://www.zooniverse.org/projects/{zp.slug}"
    elif project_zid:
        project_base = f"https://www.zooniverse.org/projects/{project_zid}"
    else:
        project_base = "https://www.zooniverse.org"
    # ``/talk/subjects/<id>`` is the canonical per-subject Talk URL —
    # opens the Notes board discussion for that subject (works even
    # without auth, read-only).
    talk_url = f"https://www.zooniverse.org/talk/subjects/{sid}"
    # The classifier doesn't deep-link to a specific subject in the
    # public SPA — best we can do is the project classifier landing.
    classify_url = f"{project_base}/classify"

    title_meta = ""
    meta = subj.get("metadata") or {}
    for key in ("title", "name", "#filename", "filename"):
        if isinstance(meta.get(key), str) and meta[key].strip():
            title_meta = meta[key][:200]
            break

    return 200, {
        "subject_id": str(sid),
        "project_zid": project_zid,
        # Multi-frame subjects (e.g. Gravity Spy's 4-up spectrograms)
        # need every frame visible — cap at 8 to keep payload sane
        # without truncating common cases.
        "media": [
            {"url": m.get("url") or "", "mime": m.get("mime") or ""}
            for m in media[:8]
            if m.get("url")
        ],
        "locations": locations[:8],
        "classify_url": classify_url,
        "talk_url": talk_url,
        "title": title_meta,
    }


# ---- Per-user workflow activity ---------------------------------------------


def _zoo_identity_state(user) -> tuple[object, bool]:
    """Resolve the user's Zoo identity row plus a flag indicating
    whether it needs a re-OAuth.

    ``needs_reconnect`` is true when an Identity row exists but holds
    no usable credentials — happens to legacy rows from before the
    refresh-token columns were added (accounts.0010/0011). Surfacing
    this lets the UI prompt the user to fix it instead of silently
    returning empty lists.
    """
    from apps.accounts.models import Identity

    ident = Identity.objects.filter(user=user, provider="zooniverse").first()
    if ident is None:
        return None, False
    needs_reconnect = not (ident.access_token or ident.refresh_token)
    return ident, needs_reconnect


def _user_panoptes_token(user) -> Token | None:
    """Return a fresh Panoptes bearer for the given Astrozor user, or
    ``None`` if they haven't linked their Zooniverse account (or the
    refresh dance fails).

    Uses the cached ``access_token`` until it's within 30 s of expiry,
    then refreshes via ``exchange_refresh_token``. Saves the new tokens
    back onto the Identity row so subsequent calls are warm.
    """
    from datetime import timedelta

    from apps.accounts.models import Identity

    from .zooniverse import exchange_refresh_token

    ident = Identity.objects.filter(user=user, provider="zooniverse").first()
    if ident is None or not (ident.access_token or ident.refresh_token):
        return None
    now = timezone.now()
    skew = timedelta(seconds=30)
    is_expired = (
        ident.token_expires_at is not None and ident.token_expires_at - skew <= now
    )
    if ident.access_token and not is_expired:
        return Token(access_token=ident.access_token)
    if not ident.refresh_token:
        return Token(access_token=ident.access_token) if ident.access_token else None
    try:
        fresh = exchange_refresh_token(ident.refresh_token)
    except ZooniverseError:
        return Token(access_token=ident.access_token) if ident.access_token else None
    new_access = fresh.get("access_token") or ""
    new_refresh = fresh.get("refresh_token") or ident.refresh_token
    expires_in = int(fresh.get("expires_in") or 0)
    if new_access:
        ident.access_token = new_access
        ident.refresh_token = new_refresh
        if expires_in:
            ident.token_expires_at = timezone.now() + timedelta(seconds=expires_in)
        ident.save(
            update_fields=["access_token", "refresh_token", "token_expires_at"]
        )
        return Token(access_token=new_access)
    return Token(access_token=ident.access_token) if ident.access_token else None


@router.get(
    "/zooniverse/projects/zid/{zid}/my-workflow-activity",
    response={200: ZooniverseWorkflowActivityOut, 404: dict},
)
def get_my_workflow_activity(request: HttpRequest, zid: int):
    """Per-workflow classification count for the current user.

    Drives the "Aktivní" badge on workflow CTA cards in the Zooniverse
    project detail. Unlinked / anonymous users get ``linked=false`` —
    the frontend then renders cards without badges.

    Network cost: one Panoptes call per active workflow. Acceptable
    because:
      * Most projects have ≤3 active workflows
      * Results are cached client-side via React Query
      * Failure on any workflow degrades gracefully (count=0)
    """
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not in catalogue"}
    if not request.user.is_authenticated:
        return 200, {"linked": False, "workflows": []}

    from apps.accounts.models import Identity

    ident = Identity.objects.filter(
        user=request.user, provider="zooniverse"
    ).first()
    if ident is None:
        return 200, {"linked": False, "workflows": []}
    try:
        user_zid = int(ident.provider_user_id or 0)
    except (TypeError, ValueError):
        user_zid = 0
    token = _user_panoptes_token(request.user)
    if not user_zid or token is None:
        return 200, {"linked": True, "workflows": []}

    panoptes = Panoptes(token=token)
    rows: list[dict] = []
    for w in p.workflows or []:
        if not w.get("active"):
            continue
        try:
            wid = int(w.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if not wid:
            continue
        count = 0
        try:
            data = panoptes._request(
                "GET",
                "/classifications",
                params={
                    "user_id": user_zid,
                    "workflow_id": wid,
                    "page_size": 1,
                },
            )
            # Panoptes wraps pagination metadata under ``meta.classifications``.
            meta = (data.get("meta") or {}).get("classifications") or {}
            count = int(meta.get("count") or 0)
        except ZooniverseError:
            # Single-workflow lookup may fail for retired workflows or
            # restricted ones — keep count at 0 and move on.
            count = 0
        rows.append({"workflow_id": wid, "classified_count": count})
    return 200, {"linked": True, "workflows": rows}


# ---- Admin curation ----


_ZID_FROM_URL = re.compile(r"/projects/(?:[^/]+/)?(?P<zid>\d+)")


def _parse_zooniverse_id(raw: str) -> int | None:
    """Accept a bare integer, a project URL, or a project slug.

    Examples:
        "5733"
        "https://www.zooniverse.org/projects/zookeeper/galaxy-zoo"
            → Panoptes resolves "zookeeper/galaxy-zoo" to numeric ID
              separately, see below
        "https://www.zooniverse.org/projects/5733"
    """
    s = (raw or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    m = _ZID_FROM_URL.search(s)
    if m and m.group("zid").isdigit():
        return int(m.group("zid"))
    return None


@router.get(
    "/zooniverse/admin/projects/search",
    response={200: list[ZooniverseProjectSearchResult], 401: dict, 403: dict},
)
def admin_search_zooniverse_projects(
    request: HttpRequest,
    q: str = "",
    tags: str = "astronomy",
    state: str = "live",
    page: int = 1,
):
    """Proxy Panoptes search for the admin add-project dropdown.

    Default filter ``tags=astronomy`` because Astrozor's audience is
    amateur astronomy — admin can override with ``?tags=`` (empty
    string disables) or different tags (e.g. ``physics,space``).

    Sets ``already_in_catalogue`` on each row so the UI can dim rows
    we've already added.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    try:
        rows = Panoptes(token=None).search_projects(
            search=q.strip(),
            tags=tags.strip(),
            state=state.strip() or "live",
            page=max(1, page),
            page_size=20,
        )
    except ZooniverseError:
        return 200, []
    existing = set(
        ZooniverseProject.objects.values_list("zooniverse_id", flat=True)
    )
    out = []
    for r in rows:
        try:
            zid = int(r.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if not zid:
            continue
        out.append(
            {
                "zooniverse_id": zid,
                "slug": r.get("slug") or "",
                "title": r.get("display_name") or "",
                "description": (r.get("description") or "")[:240],
                "avatar_url": r.get("avatar_src") or "",
                "classifications_count": int(r.get("classifications_count") or 0),
                "state": r.get("state") or "",
                "primary_language": r.get("primary_language") or "",
                "already_in_catalogue": zid in existing,
                # Flag so the admin can spot zombie projects (state=live
                # but never launch-approved) before adding them.
                "launch_approved": bool(r.get("launch_approved", True)),
            }
        )
    return 200, out


@router.get(
    "/zooniverse/admin/projects/preview",
    response={200: ZooniverseProjectPreviewOut, 400: dict, 401: dict, 403: dict},
)
def admin_preview_zooniverse_project(
    request: HttpRequest, zooniverse_id_or_url: str
):
    """Dry-run lookup for the import review modal.

    Hits Panoptes for project metadata + workflows, computes the
    zombie heuristic, and returns everything the admin needs to
    decide whether to commit the import — without persisting
    anything yet. The actual import goes through the POST endpoint
    after the admin confirms.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    zid = _parse_zooniverse_id(zooniverse_id_or_url)
    if not zid:
        return 400, {
            "detail": "Pass a numeric Zooniverse project ID or a /projects/<id> URL."
        }
    p = Panoptes(token=None)
    try:
        meta = p.get_project(zid)
    except ZooniverseError as e:
        return 400, {"detail": f"Panoptes lookup failed: {e}"}

    # Build classify URLs against the slug Panoptes returned. The
    # workflow list is a separate call; failure there only drops the
    # workflow rows from the preview, the rest still goes through.
    slug = meta.get("slug") or ""
    base = (
        f"https://www.zooniverse.org/projects/{slug}"
        if slug
        else f"https://www.zooniverse.org/projects/{zid}"
    )
    active_ids = {
        int(x)
        for x in ((meta.get("links") or {}).get("active_workflows") or [])
    }
    workflows_out: list[dict] = []
    try:
        from .tasks import _first_task_question

        for w in p.list_workflows(zid):
            wid_raw = w.get("id")
            try:
                wid = int(wid_raw) if wid_raw else 0
            except (TypeError, ValueError):
                continue
            if not wid or wid not in active_ids:
                continue
            workflows_out.append(
                {
                    "id": wid,
                    "display_name": w.get("display_name") or f"Workflow #{wid}",
                    "active": True,
                    "completeness": float(w.get("completeness") or 0.0),
                    "classify_url": f"{base}/classify/workflow/{wid}",
                    "description": _first_task_question(w)[:160],
                }
            )
    except ZooniverseError:
        pass

    launch_approved = bool(meta.get("launch_approved", True))
    # Same heuristic as the runtime ``_zooniverse_project_out`` —
    # never launch-approved + every active workflow near-empty.
    zombie = (not launch_approved) and (
        not workflows_out
        or all(w["completeness"] <= 0.001 for w in workflows_out)
    )
    already = ZooniverseProject.objects.filter(zooniverse_id=zid).exists()
    return 200, {
        "zooniverse_id": zid,
        "slug": slug,
        "title": meta.get("display_name") or "",
        "owner_login": "",
        "description": meta.get("description") or "",
        "introduction": meta.get("introduction") or "",
        "avatar_url": meta.get("avatar_src") or "",
        "background_url": meta.get("background_src") or "",
        "primary_language": meta.get("primary_language") or "",
        "state": meta.get("state") or "",
        "classifications_count": int(meta.get("classifications_count") or 0),
        "subjects_count": int(meta.get("subjects_count") or 0),
        "launch_approved": launch_approved,
        "beta_approved": bool(meta.get("beta_approved", False)),
        "private": bool(meta.get("private", False)),
        "workflows": workflows_out,
        "zombie": zombie,
        "already_in_catalogue": already,
    }


@router.post(
    "/zooniverse/admin/projects",
    response={201: ZooniverseProjectOut, 400: dict, 401: dict, 403: dict},
)
def admin_add_zooniverse_project(request: HttpRequest, payload: ZooniverseProjectAddIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    zid = _parse_zooniverse_id(payload.zooniverse_id_or_url)
    if not zid:
        # Could still be a slug like "zookeeper/galaxy-zoo" — Panoptes
        # supports that via /projects?slug=…, but MVP requires the ID.
        return 400, {
            "detail": "Pass a numeric Zooniverse project ID or a /projects/<id> URL."
        }
    existing = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    p = existing or ZooniverseProject.objects.create(
        zooniverse_id=zid,
        astrozor_curator=request.user,
    )
    # Best-effort metadata fetch; row is created even on failure so
    # admin can retry. is_featured defaults to True.
    try:
        from .tasks import _refresh_project_metadata

        _refresh_project_metadata(Panoptes(token=None), p)
    except ZooniverseError as e:
        return 400, {"detail": f"Panoptes lookup failed: {e}"}
    return 201, _zooniverse_project_out(p)


@router.patch(
    "/zooniverse/admin/projects/{zid}",
    response={200: ZooniverseProjectOut, 401: dict, 403: dict, 404: dict},
)
def admin_patch_zooniverse_project(
    request: HttpRequest, zid: int, payload: ZooniverseProjectPatchIn
):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not in catalogue"}
    if payload.is_featured is not None:
        p.is_featured = payload.is_featured
        p.save(update_fields=["is_featured"])
    if payload.tags is not None:
        clean = [t.strip() for t in payload.tags if t.strip()]
        if clean:
            p.tags.set(clean, clear=True)
        else:
            p.tags.clear()
    return 200, _zooniverse_project_out(p)


@router.get(
    "/zooniverse/admin/projects/{zid}/disconnect-preview",
    response={200: ZooniverseProjectDisconnectPreviewOut, 401: dict, 403: dict, 404: dict},
)
def admin_disconnect_preview(request: HttpRequest, zid: int):
    """Read-only snapshot of what will be deleted if the admin
    confirms ``DELETE /zooniverse/admin/projects/{zid}``.

    Nothing is mutated here; the response feeds the confirmation
    modal so the admin sees the blast radius before committing.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not in catalogue"}

    sprints_qs = Campaign.objects.filter(zooniverse_project=p).order_by("-starts_at")
    sprints_out = []
    participant_count = 0
    for s in sprints_qs[:50]:
        pc = s.sprint_participants.count()
        participant_count += pc
        sprints_out.append(
            {
                "slug": s.slug,
                "title": s.title,
                "status": s.status,
                "starts_at": s.starts_at,
                "ends_at": s.ends_at,
                "participant_count": pc,
            }
        )
    # Catch participants on sprints beyond the listed 50 (rare but
    # complete) so the displayed total doesn't undercount.
    if sprints_qs.count() > 50:
        from django.db.models import Count

        all_participants = (
            sprints_qs.aggregate(c=Count("sprint_participants"))["c"] or 0
        )
        participant_count = all_participants

    snapshot_count = ZooniverseStatsSnapshot.objects.filter(
        subject_type="project", subject_id=p.zooniverse_id
    ).count()

    has_downstream = bool(sprints_out or participant_count or snapshot_count)
    return 200, {
        "zooniverse_id": p.zooniverse_id,
        "title": p.title or "",
        "avatar_url": p.avatar_url or "",
        "sprints": sprints_out,
        "sprint_count": sprints_qs.count(),
        "participant_count": participant_count,
        "stats_snapshot_count": snapshot_count,
        "has_downstream": has_downstream,
    }


@router.delete(
    "/zooniverse/admin/projects/{zid}",
    response={200: ZooniverseProjectDisconnectResultOut, 401: dict, 403: dict, 404: dict},
)
def admin_remove_zooniverse_project(request: HttpRequest, zid: int):
    """Disconnect the project from Astrozor's catalogue.

    Cascades:

    * Linked ``Campaign`` rows (sprints) — including their
      ``SprintParticipant`` rows via CASCADE.
    * Cached ``ZooniverseStatsSnapshot`` rows keyed by
      ``(subject_type="project", subject_id=zid)``.

    Does NOT touch Zooniverse. The classification data, the project
    on Zooniverse, group membership — all remain intact upstream.
    Users who were sprint participants keep their Zooniverse account
    and group membership; only the Astrozor-side opt-in records go.
    """
    from django.db import transaction

    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    if not request.user.is_staff:
        return 403, {"detail": "Admin only"}
    p = ZooniverseProject.objects.filter(zooniverse_id=zid).first()
    if p is None:
        return 404, {"detail": "Project not in catalogue"}

    with transaction.atomic():
        # Count first so the response can summarize. ``delete()`` returns
        # cascaded totals too, but it's mixed by model — easier to count
        # upfront for the per-model breakdown.
        sprints = Campaign.objects.filter(zooniverse_project=p)
        sprint_count = sprints.count()
        from .models import SprintParticipant

        participant_count = SprintParticipant.objects.filter(
            sprint__zooniverse_project=p
        ).count()
        snapshot_count = ZooniverseStatsSnapshot.objects.filter(
            subject_type="project", subject_id=p.zooniverse_id
        ).count()

        # Explicit deletes (rather than relying on FK CASCADE) so we
        # control the order and don't rely on Django's SET_NULL on
        # Campaign.zooniverse_project — that flag is for the "lose
        # the catalogue but keep the campaign" semantics we don't
        # want here.
        ZooniverseStatsSnapshot.objects.filter(
            subject_type="project", subject_id=p.zooniverse_id
        ).delete()
        sprints.delete()  # cascades SprintParticipant rows
        p.delete()

    return 200, {
        "zooniverse_id": zid,
        "deleted_project": True,
        "deleted_sprints": sprint_count,
        "deleted_participants": participant_count,
        "deleted_snapshots": snapshot_count,
    }
