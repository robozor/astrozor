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


def _headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "Astrozor/0.x"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def fetch_repo_metadata(repo: GHRepo) -> dict:
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}"
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=_headers())
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
