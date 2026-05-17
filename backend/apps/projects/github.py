"""Anonymous GitHub REST API fetcher for repo metadata.

Public read-only endpoints work without auth (60 req/h per IP). Token
support deferred until B-1 unblocks (then we move to 5000 req/h).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from django.utils import timezone as dj_tz

from .models import GHRepo

logger = logging.getLogger(__name__)

GH_API = "https://api.github.com"


def _headers(token: str | None = None) -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "Astrozor/0.x"}
    effective = token or os.environ.get("GITHUB_TOKEN")
    if effective:
        h["Authorization"] = f"Bearer {effective}"
    return h


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _resolve_user_token(user) -> str | None:
    """Return the user's GitHub OAuth access_token if they have a connected
    Identity, else None (caller falls back to anonymous or env token).
    """
    if not user or not getattr(user, "is_authenticated", False):
        return None
    try:
        from apps.accounts.models import Identity

        ident = (
            Identity.objects.filter(user=user, provider="github")
            .exclude(access_token="")
            .first()
        )
    except Exception:
        return None
    return ident.access_token if ident else None


def fetch_repo_metadata(repo: GHRepo, user=None) -> dict:
    """Fetch repo metadata. If `user` is given and has a connected GitHub
    Identity, we use their access_token (5000 req/h). Otherwise anonymous.
    """
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}"
    token = _resolve_user_token(user) if user else None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=_headers(token))
    except httpx.HTTPError as e:  # pragma: no cover
        repo.last_status = f"error: {e}"[:40]
        repo.last_fetched_at = dj_tz.now()
        repo.save()
        return {"status": "error", "detail": str(e)}

    if resp.status_code == 404:
        repo.last_status = "not_found"
        repo.last_fetched_at = dj_tz.now()
        repo.save()
        return {"status": "not_found"}
    if resp.status_code == 403:
        repo.last_status = "rate_limited"
        repo.last_fetched_at = dj_tz.now()
        repo.save()
        return {"status": "rate_limited"}
    resp.raise_for_status()
    data = resp.json()

    repo.description = data.get("description") or ""
    repo.stars = data.get("stargazers_count", 0)
    repo.forks = data.get("forks_count", 0)
    repo.language = data.get("language") or ""
    repo.open_issues = data.get("open_issues_count", 0)
    repo.default_branch = data.get("default_branch") or ""
    repo.html_url = data.get("html_url") or ""
    repo.last_commit_at = _parse_iso(data.get("pushed_at"))
    repo.last_status = "ok"
    repo.last_fetched_at = dj_tz.now()
    repo.save()

    return {
        "status": "ok",
        "stars": repo.stars,
        "forks": repo.forks,
        "language": repo.language,
    }


def fetch_repo_issues(repo: GHRepo, user=None, limit: int = 30) -> list[dict]:
    """Fetch open issues for `repo`. Returns list of normalized dicts.

    Excludes pull requests (GitHub's REST /issues returns both unless filtered).
    """
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/issues"
    token = _resolve_user_token(user) if user else None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                url,
                headers=_headers(token),
                params={"state": "open", "per_page": min(limit, 100)},
            )
    except httpx.HTTPError as e:
        logger.warning("issues fetch failed for %s: %s", repo.full_name, e)
        return []
    if resp.status_code != 200:
        logger.warning(
            "issues fetch %s returned HTTP %s (token=%s, scopes=%s)",
            repo.full_name,
            resp.status_code,
            "yes" if token else "no",
            resp.headers.get("x-oauth-scopes", ""),
        )
        return []

    # Repo is reachable. If stored metadata says otherwise (e.g. because
    # it was first added with a less-privileged token), refresh it now so
    # the UI's stale "unreachable" warning auto-clears on next read.
    if repo.last_status != "ok":
        try:
            fetch_repo_metadata(repo, user=user)
        except Exception as e:  # pragma: no cover
            logger.warning("auto-refresh after issues fetch failed: %s", e)

    items = []
    for it in resp.json():
        if "pull_request" in it:  # skip PRs
            continue
        items.append(
            {
                "number": it.get("number"),
                "title": it.get("title") or "",
                "state": it.get("state") or "open",
                "html_url": it.get("html_url") or "",
                "comments": it.get("comments", 0),
                "labels": [
                    {"name": lab.get("name"), "color": lab.get("color")}
                    for lab in (it.get("labels") or [])
                ],
                "assignees": [
                    {
                        "login": a.get("login"),
                        "avatar_url": a.get("avatar_url"),
                        "html_url": a.get("html_url"),
                    }
                    for a in (it.get("assignees") or [])
                ],
                "created_at": it.get("created_at"),
                "updated_at": it.get("updated_at"),
            }
        )
    return items


def post_issue_comment(
    repo: GHRepo, issue_number: int, body: str, user
) -> dict:
    """POST a comment on the given GH issue using the user's access_token.

    Returns {"status": "ok", "html_url": "..."} or {"status": "...", "detail": "..."}.
    """
    token = _resolve_user_token(user) if user else None
    if not token:
        return {"status": "no_token", "detail": "User has no connected GitHub token"}
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/issues/{issue_number}/comments"
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(url, headers=_headers(token), json={"body": body})
    except httpx.HTTPError as e:
        return {"status": "error", "detail": str(e)}
    if r.status_code not in (200, 201):
        return {"status": f"http_{r.status_code}", "detail": r.text[:200]}
    data = r.json()
    return {"status": "ok", "html_url": data.get("html_url", "")}
