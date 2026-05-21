"""Celery tasks for the Zooniverse integration.

Four periodic tasks keep our cache in sync with Zooniverse:

* ``citizen.sync_zooniverse_projects`` (hourly) — refresh Panoptes
  metadata + public ERAS totals for every catalogued project.
* ``citizen.sync_zooniverse_group`` (6 h) — refresh the canonical group
  row (join_token, member_count, visibility) and the ERAS group totals.
* ``citizen.sync_zooniverse_membership`` (6 h) — fan-out: for every
  ``Identity(provider="zooniverse")``, check if the Zooniverse user_id
  is in the group's ``links.users`` and flip the denormalized flag.
* ``citizen.sync_zooniverse_user_stats`` (6 h) — for every linked
  user with a fresh access_token, snapshot their last 30 days from
  the per-user ERAS endpoint.

All tasks are best-effort: a single Panoptes / ERAS failure logs at
WARNING and continues; a hard crash propagates so Celery's retry
machinery can do its job.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta
from typing import Any

from celery import shared_task
from django.utils import timezone

from .models import (
    ZooniverseGroup,
    ZooniverseProject,
    ZooniverseStatsSnapshot,
)
from .zooniverse import (
    Eras,
    Panoptes,
    Token,
    ZooniverseError,
    service_token,
)

logger = logging.getLogger(__name__)

SENTINEL_TOTAL = date(1970, 1, 1)


# ---------------------------------------------------------------------------
# Project sync
# ---------------------------------------------------------------------------


@shared_task(name="citizen.sync_zooniverse_projects")
def sync_zooniverse_projects() -> dict:
    """Refresh metadata + public totals for every catalogued project."""
    panoptes = Panoptes(token=None)
    eras = Eras(token=None)
    out = {"projects": 0, "errors": 0}
    for proj in ZooniverseProject.objects.all():
        try:
            _refresh_project_metadata(panoptes, proj)
            _refresh_project_totals(eras, proj)
            out["projects"] += 1
        except ZooniverseError as e:
            logger.warning("sync project %s: %s", proj.zooniverse_id, e)
            out["errors"] += 1
    if out["projects"] or out["errors"]:
        logger.info("citizen.sync_zooniverse_projects: %s", out)
    return out


def _refresh_project_metadata(p: Panoptes, proj: ZooniverseProject) -> None:
    meta = p.get_project(proj.zooniverse_id)
    proj.slug = meta.get("slug") or proj.slug
    proj.title = meta.get("display_name") or proj.title
    proj.description = meta.get("description") or proj.description
    proj.introduction = meta.get("introduction") or proj.introduction
    proj.avatar_url = meta.get("avatar_src") or proj.avatar_url
    proj.background_url = meta.get("background_src") or proj.background_url
    proj.primary_language = meta.get("primary_language") or proj.primary_language
    proj.state = meta.get("state") or proj.state
    proj.classifications_count = int(meta.get("classifications_count") or 0)
    proj.subjects_count = int(meta.get("subjects_count") or 0)
    # Lifecycle flags — see model comment for why we care. We
    # intentionally don't coerce to ``False`` on missing key (older
    # Panoptes responses may omit it for very old projects) — only
    # update when the field is explicitly present.
    if "launch_approved" in meta:
        proj.launch_approved = bool(meta.get("launch_approved"))
    if "beta_approved" in meta:
        proj.beta_approved = bool(meta.get("beta_approved"))
    # owner_login lives in meta.links.owner — Panoptes returns it as
    # {"id": "...", "type": "user"|"user_group"} so we resolve later if
    # needed. For now keep whatever the admin filled in.
    update_fields = [
        "slug",
        "title",
        "description",
        "introduction",
        "avatar_url",
        "background_url",
        "primary_language",
        "state",
        "classifications_count",
        "subjects_count",
        "launch_approved",
        "beta_approved",
        "last_synced_at",
    ]
    # Workflows: which subject-set classifies a user can pick from on
    # the project page. We surface ACTIVE workflows as buttons on the
    # detail; inactive ones are kept so admins can see history.
    # Project response's links.active_workflows gives us the active IDs
    # without a second round-trip for the boolean — but display_name +
    # completeness live on the workflow envelope, so we still need
    # the /workflows fetch.
    try:
        active_ids = {
            int(x)
            for x in ((meta.get("links") or {}).get("active_workflows") or [])
        }
        workflows = p.list_workflows(proj.zooniverse_id)
        proj.workflows = [
            {
                "id": int(w.get("id") or 0),
                "display_name": w.get("display_name") or "",
                "active": int(w.get("id") or 0) in active_ids,
                "completeness": _completeness(w.get("completeness")),
                # The first task's ``question`` field is the most
                # human-readable "what does this workflow ask" — exactly
                # what we want as a sub-label under the workflow name.
                "description": _first_task_question(w),
            }
            for w in workflows
            if w.get("id")
        ]
        proj.workflows_synced_at = timezone.now()
        update_fields += ["workflows", "workflows_synced_at"]
    except ZooniverseError as e:
        logger.info("workflows fetch failed for %s: %s", proj.zooniverse_id, e)
    proj.last_synced_at = timezone.now()
    proj.save(update_fields=update_fields)


def _completeness(v: Any) -> float:
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_MD_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")


def _first_task_question(workflow: dict[str, Any]) -> str:
    """Best-effort sub-label for a workflow button.

    Pulls the first task's ``question`` from a Panoptes workflow
    envelope. Strips minimal Markdown (bold + italic) so the result
    can be slotted under the workflow title without rendering raw
    asterisks. Falls back to "" when the workflow has no parseable
    first task (e.g. drawing-only tasks without a question prompt).
    """
    tasks = workflow.get("tasks") or {}
    first_id = workflow.get("first_task") or ""
    task = tasks.get(first_id) if first_id else None
    if task is None:
        # Some old workflows lack ``first_task``; fall back to T0 / init.
        for fallback in ("T0", "init", "0"):
            if fallback in tasks:
                task = tasks[fallback]
                break
    if task is None:
        return ""
    q = (task.get("question") or task.get("instruction") or "").strip()
    if not q:
        return ""
    q = _MD_BOLD_RE.sub(r"\1", q)
    q = _MD_ITALIC_RE.sub(r"\1", q)
    # Truncate aggressively — buttons are tight on screen and the
    # first sentence almost always conveys the gist.
    if len(q) > 140:
        q = q[:137].rstrip() + "…"
    return q


def _refresh_project_totals(e: Eras, proj: ZooniverseProject) -> None:
    """Cache today's bucket of the daily series + the rolling total."""
    total = e.project_total(proj.zooniverse_id)
    _upsert_snapshot(
        subject_type="project",
        subject_id=proj.zooniverse_id,
        period="total",
        when=SENTINEL_TOTAL,
        count=int(total.get("total_count") or 0),
    )
    # Daily for the last 7 days so the chart has a recent window without
    # re-fetching the full series every hour.
    end = timezone.now().date()
    start = end - timedelta(days=7)
    daily = e.project_total(
        proj.zooniverse_id,
        period="day",
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    for bucket in daily.get("data") or []:
        bucket_date = _parse_bucket_date(bucket.get("period"))
        if bucket_date is None:
            continue
        _upsert_snapshot(
            subject_type="project",
            subject_id=proj.zooniverse_id,
            period="day",
            when=bucket_date,
            count=int(bucket.get("count") or 0),
        )


# ---------------------------------------------------------------------------
# Group sync
# ---------------------------------------------------------------------------


@shared_task(name="citizen.sync_zooniverse_group")
def sync_zooniverse_group() -> dict:
    """Refresh the singleton ZooniverseGroup row + its ERAS totals."""
    gid = int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0)
    if not gid:
        logger.info("citizen.sync_zooniverse_group: ZOONIVERSE_GROUP_ID not set, skipping")
        return {"skipped": True}
    token = service_token()
    if not token:
        logger.info(
            "citizen.sync_zooniverse_group: ZOONIVERSE_SERVICE_ACCESS_TOKEN not set, "
            "using public access (members + join_token unavailable)"
        )
    p = Panoptes(token=token)
    e = Eras(token=token)
    out: dict[str, Any] = {"group_id": gid}
    try:
        meta = p.get_group(gid)
        member_ids = (meta.get("links") or {}).get("users") or []
        row, _ = ZooniverseGroup.objects.get_or_create(zooniverse_group_id=gid)
        # Panoptes returns ``name`` as a slug-ish internal identifier and
        # ``display_name`` for the human label. Prefer display_name for
        # display; keep name only if Panoptes returns something nicer
        # than the default "Astrozor".
        panoptes_name = meta.get("name") or ""
        panoptes_display = meta.get("display_name") or ""
        if panoptes_display:
            row.display_name = panoptes_display
            # Sync name to display_name when display_name looks human
            # (otherwise leave the default "Astrozor").
            if not row.name or row.name == "Astrozor":
                row.name = panoptes_display
        elif panoptes_name and not row.name:
            row.name = panoptes_name
        # join_token is only returned to authenticated admins; preserve
        # the existing value if Panoptes hands us nothing.
        row.join_token = meta.get("join_token") or row.join_token
        row.stats_visibility = meta.get("stats_visibility") or row.stats_visibility
        row.member_count = len(member_ids)
        row.last_synced_at = timezone.now()
        row.save()
        out["member_count"] = row.member_count
    except ZooniverseError as ex:
        logger.warning("sync_zooniverse_group panoptes: %s", ex)
        out["panoptes_error"] = str(ex)
    try:
        total = e.group_total(gid, top_contributors=10)
        _upsert_snapshot(
            subject_type="group",
            subject_id=gid,
            period="total",
            when=SENTINEL_TOTAL,
            count=int(total.get("total_count") or 0),
            time_spent_s=_seconds(total.get("time_spent")),
        )
        out["total_count"] = total.get("total_count")
    except ZooniverseError as ex:
        logger.warning("sync_zooniverse_group eras: %s", ex)
        out["eras_error"] = str(ex)
    logger.info("citizen.sync_zooniverse_group: %s", out)
    return out


@shared_task(name="citizen.sync_zooniverse_membership")
def sync_zooniverse_membership() -> dict:
    """For every Identity(provider=zooniverse), refresh the
    ``zooniverse_in_group`` flag using the latest Panoptes group roster.
    """
    from apps.accounts.models import Identity

    gid = int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0)
    if not gid:
        return {"skipped": True}
    token = service_token()
    p = Panoptes(token=token)
    try:
        member_ids = set(p.list_group_member_ids(gid))
    except ZooniverseError as ex:
        logger.warning("sync_zooniverse_membership panoptes: %s", ex)
        return {"error": str(ex)}
    out = {"checked": 0, "in_group": 0}
    qs = Identity.objects.filter(provider="zooniverse")
    for i in qs:
        try:
            in_group = int(i.provider_user_id or 0) in member_ids
        except ValueError:
            continue
        if i.zooniverse_in_group != in_group:
            i.zooniverse_in_group = in_group
            i.zooniverse_membership_synced_at = timezone.now()
            i.save(
                update_fields=["zooniverse_in_group", "zooniverse_membership_synced_at"]
            )
        else:
            i.zooniverse_membership_synced_at = timezone.now()
            i.save(update_fields=["zooniverse_membership_synced_at"])
        out["checked"] += 1
        if in_group:
            out["in_group"] += 1
    logger.info("citizen.sync_zooniverse_membership: %s", out)
    return out


# ---------------------------------------------------------------------------
# Per-user stats sync
# ---------------------------------------------------------------------------


@shared_task(name="citizen.sync_zooniverse_user_stats")
def sync_zooniverse_user_stats() -> dict:
    """Snapshot per-user totals for every linked Identity that opted in
    to profile activity display. Uses the user's own access_token.
    """
    from apps.accounts.models import Identity

    out = {"users": 0, "errors": 0}
    qs = Identity.objects.filter(provider="zooniverse").exclude(access_token="")
    for i in qs:
        try:
            zoon_user_id = int(i.provider_user_id or 0)
        except ValueError:
            continue
        if not zoon_user_id:
            continue
        e = Eras(token=Token(access_token=i.access_token))
        try:
            total = e.user_total(zoon_user_id, time_spent=True)
            _upsert_snapshot(
                subject_type="user",
                subject_id=zoon_user_id,
                period="total",
                when=SENTINEL_TOTAL,
                count=int(total.get("total_count") or 0),
                time_spent_s=_seconds(total.get("time_spent")),
            )
            out["users"] += 1
        except ZooniverseError as ex:
            # 401 here likely means expired token — log and let the
            # user re-link rather than spam the user with errors. A
            # Phase-4.5 refresh-token rotation task can fix this.
            logger.info("sync user %s: %s", zoon_user_id, ex)
            out["errors"] += 1
    if out["users"] or out["errors"]:
        logger.info("citizen.sync_zooniverse_user_stats: %s", out)
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _upsert_snapshot(
    *,
    subject_type: str,
    subject_id: int,
    period: str,
    when: date,
    count: int,
    time_spent_s: int | None = None,
) -> None:
    ZooniverseStatsSnapshot.objects.update_or_create(
        subject_type=subject_type,
        subject_id=subject_id,
        period=period,
        date=when,
        defaults={"count": count, "time_spent_s": time_spent_s},
    )


def _parse_bucket_date(raw: Any) -> date | None:
    if not raw:
        return None
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(raw[:10])
            except ValueError:
                return None
    return None


def _seconds(v: Any) -> int | None:
    """ERAS time_spent comes back as a float (seconds, maybe fractional).
    Snapshot stores integer seconds — round it."""
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None
