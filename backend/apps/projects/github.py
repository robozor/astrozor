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
