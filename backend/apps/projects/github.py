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
    repo.topics = data.get("topics") or []
    repo.last_status = "ok"
    repo.last_fetched_at = dj_tz.now()

    # Extended metadata — best-effort; each call's failure is
    # tolerated independently (a missing release shouldn't blank the
    # contributors list and vice versa). Saves one DB write per
    # successful fetch via update_fields if we batched, but the cache
    # is cold enough that an extra save is cheap.
    _refresh_release(repo, token)
    _refresh_contributors(repo, token)
    repo.save()
    # Commit-date cache lives on the same model but is more expensive
    # (paginated GH calls). Refresh it inline so a manual repo refresh
    # also rebuilds the activity graph; the project-activity endpoint
    # has its own TTL gate for lazy refreshes between manual ones.
    try:
        refresh_repo_commit_cache(repo, user=user)
    except Exception:  # pragma: no cover — never block metadata refresh on commits
        logger.warning("commit cache refresh failed for %s", repo.full_name)

    return {
        "status": "ok",
        "stars": repo.stars,
        "forks": repo.forks,
        "language": repo.language,
    }


def _refresh_release(repo: GHRepo, token: str | None) -> None:
    """``GET /repos/{owner}/{name}/releases/latest`` — sets the
    release fields on ``repo`` (no save). Tolerates 404 (no release
    yet) and 403 (rate limited) silently."""
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/releases/latest"
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(url, headers=_headers(token))
    except httpx.HTTPError:
        return
    if r.status_code != 200:
        if r.status_code == 404:
            # No releases — clear stale state.
            repo.last_release_tag = ""
            repo.last_release_name = ""
            repo.last_release_at = None
            repo.last_release_url = ""
        return
    d = r.json()
    repo.last_release_tag = (d.get("tag_name") or "")[:120]
    repo.last_release_name = (d.get("name") or d.get("tag_name") or "")[:200]
    repo.last_release_at = _parse_iso(
        d.get("published_at") or d.get("created_at")
    )
    repo.last_release_url = (d.get("html_url") or "")[:300]


def _refresh_contributors(repo: GHRepo, token: str | None, *, top_n: int = 10) -> None:
    """``GET /repos/{owner}/{name}/contributors?per_page=N`` — caches
    top N contributors as a JSON list of avatar chips."""
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/contributors"
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                url, headers=_headers(token), params={"per_page": top_n, "anon": 0}
            )
    except httpx.HTTPError:
        return
    if r.status_code != 200:
        return
    try:
        data = r.json()
    except ValueError:
        return
    out: list[dict] = []
    for c in data[:top_n]:
        login = c.get("login") or ""
        if not login:
            continue
        out.append(
            {
                "login": login,
                "avatar_url": (c.get("avatar_url") or "")[:300],
                "html_url": (c.get("html_url") or "")[:300],
                "contributions": int(c.get("contributions") or 0),
            }
        )
    repo.top_contributors = out


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


# Allowlist for GitHub-rendered content: avatars, repo assets, user
# uploads. We only render markdown-derived HTML — never raw HTML from
# the GH response — so the rules are about which image/link hosts are
# safe to keep when bleach scrubs the output.
_GH_CONTENT_HOSTS = {
    "github.com",
    "www.github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "objects.githubusercontent.com",
    "raw.githubusercontent.com",
    "avatars.githubusercontent.com",
    "camo.githubusercontent.com",
    "media.githubusercontent.com",
}


def _render_gh_markdown(body: str) -> str:
    """Render GitHub-flavoured markdown body to safe HTML.

    The body comes back as raw markdown from the GH issues API. We
    don't trust it, so we render server-side via ``markdown-it`` and
    scrub the result via bleach with an issue-specific tag/host
    allowlist. The same approach we use for Zooniverse Talk; the
    allowlist of image hosts differs (GH user-content vs Panoptes
    uploads).
    """
    if not body:
        return ""
    import bleach
    from markdown_it import MarkdownIt
    from urllib.parse import urlparse

    allowed_tags = [
        "b", "strong", "i", "em", "u", "s", "del",
        "code", "pre",
        "p", "br", "hr",
        "ul", "ol", "li",
        "blockquote",
        "a", "img",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "table", "thead", "tbody", "tr", "th", "td",
    ]
    allowed_attrs = {
        "a": ["href", "title"],
        "img": ["src", "alt", "title", "width", "height"],
        "code": ["class"],  # language- for code highlighting
        # GFM tables encode column alignment as ``style="text-align:..."``
        # on th/td. Keep ``align`` (legacy) plus ``style`` restricted
        # to text-align values.
        "th": ["align", "style"],
        "td": ["align", "style"],
    }

    def img_filter(tag: str, name: str, value: str) -> bool:
        if tag != "img":
            return name in allowed_attrs.get(tag, [])
        if name == "src":
            try:
                host = (urlparse(value).hostname or "").lower()
            except Exception:
                return False
            return host in _GH_CONTENT_HOSTS
        return name in ("alt", "title", "width", "height")

    def td_th_style_filter(tag: str, name: str, value: str) -> bool:
        if name != "style":
            return name in ("align",)
        # Only ``text-align: left|right|center`` is allowed — that's
        # the single style markdown-it emits for GFM table alignment.
        v = (value or "").strip().rstrip(";").lower()
        return v in (
            "text-align:left",
            "text-align: left",
            "text-align:right",
            "text-align: right",
            "text-align:center",
            "text-align: center",
        )

    # ``gfm-like`` preset turns on GFM-style extensions on top of
    # CommonMark: tables, strikethrough (~~text~~), and proper task
    # list handling. We add linkify + breaks to keep auto-linking
    # of bare URLs and ``\n``-as-``<br>`` behaviour the user expects
    # from a chat-y composer.
    html = (
        MarkdownIt("gfm-like", {"linkify": True, "breaks": True, "html": False})
        .enable("linkify")
        .render(body)
    )
    attrs = {
        **allowed_attrs,
        "img": img_filter,
        "th": td_th_style_filter,
        "td": td_th_style_filter,
    }
    return bleach.clean(
        html,
        tags=allowed_tags,
        attributes=attrs,
        protocols=["http", "https", "mailto"],
        strip=True,
    )


def _user_avatar_dict(u: dict | None) -> dict:
    """Slim down GH user envelope for inclusion in issue/comment payload."""
    u = u or {}
    return {
        "login": u.get("login") or "",
        "avatar_url": u.get("avatar_url") or "",
        "html_url": u.get("html_url") or "",
    }


def fetch_issue_detail(repo: GHRepo, issue_number: int, user=None) -> dict:
    """Fetch one GH issue + its comments, rendered ready for the
    Astrozor detail panel.

    Two REST calls:
      * ``GET /repos/{o}/{n}/issues/{number}`` — body, author, state, etc.
      * ``GET /repos/{o}/{n}/issues/{number}/comments`` — paginated
        comments (we cap at 50 — anything more belongs on GH itself).

    Returns a dict ready for serialisation, or ``{"status": "..."}``
    when GH refuses. Both calls go through the user's bearer when
    available so private repos work for connected accounts.
    """
    base = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/issues/{issue_number}"
    token = _resolve_user_token(user) if user else None
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(base, headers=_headers(token))
    except httpx.HTTPError as e:
        return {"status": "error", "detail": str(e)}
    if r.status_code == 404:
        return {"status": "not_found"}
    if r.status_code == 403:
        return {"status": "rate_limited"}
    if r.status_code != 200:
        return {"status": f"http_{r.status_code}"}
    issue = r.json()

    comments: list[dict] = []
    try:
        with httpx.Client(timeout=10.0) as client:
            cr = client.get(
                f"{base}/comments",
                headers=_headers(token),
                params={"per_page": 50},
            )
        if cr.status_code == 200:
            for c in cr.json():
                comments.append(
                    {
                        "id": c.get("id"),
                        "body_html": _render_gh_markdown(c.get("body") or ""),
                        "user": _user_avatar_dict(c.get("user")),
                        "created_at": c.get("created_at"),
                        "updated_at": c.get("updated_at"),
                        "html_url": c.get("html_url") or "",
                    }
                )
    except httpx.HTTPError:
        pass

    return {
        "status": "ok",
        "number": issue.get("number"),
        "title": issue.get("title") or "",
        "state": issue.get("state") or "open",
        "body_html": _render_gh_markdown(issue.get("body") or ""),
        "html_url": issue.get("html_url") or "",
        "user": _user_avatar_dict(issue.get("user")),
        "labels": [
            {"name": lab.get("name"), "color": lab.get("color")}
            for lab in (issue.get("labels") or [])
        ],
        "assignees": [
            _user_avatar_dict(a) for a in (issue.get("assignees") or [])
        ],
        "milestone": (issue.get("milestone") or {}).get("title") or "",
        "created_at": issue.get("created_at"),
        "updated_at": issue.get("updated_at"),
        "comments_count": issue.get("comments", 0),
        "comments": comments,
    }


def fetch_commit_dates(
    repo: GHRepo,
    *,
    days: int = 365,
    user=None,
    max_pages: int = 10,
    per_page: int = 100,
) -> dict[str, int]:
    """``GET /repos/{o}/{n}/commits`` paginated, grouped by date.

    Synchronous (unlike ``/stats/commit_activity`` which is computed
    async by GitHub and returns 202 for cold caches). We page through
    until the first commit older than ``since`` is hit, or until the
    cap. Returns ``{"YYYY-MM-DD": count, ...}``.

    Pagination cap: 10 × 100 = 1000 commits per refresh. Anything
    busier than that and we'll undercount, but that's fine for a
    52-week visualization — the user already gets dense colour on
    the high-traffic days. Rate limit budget: 1–3 calls per repo
    in steady state.
    """
    from datetime import datetime as dt, timedelta, timezone as tz

    since = (dt.now(tz=tz.utc) - timedelta(days=days)).isoformat()
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/commits"
    token = _resolve_user_token(user) if user else None
    counts: dict[str, int] = {}
    cutoff = dt.now(tz=tz.utc) - timedelta(days=days)
    for page in range(1, max_pages + 1):
        try:
            with httpx.Client(timeout=15.0) as client:
                r = client.get(
                    url,
                    headers=_headers(token),
                    params={"since": since, "per_page": per_page, "page": page},
                )
        except httpx.HTTPError:
            break
        if r.status_code != 200:
            break
        try:
            rows = r.json() or []
        except ValueError:
            break
        if not rows:
            break
        oldest_in_window = True
        for c in rows:
            commit = c.get("commit") or {}
            author = commit.get("author") or {}
            committer = commit.get("committer") or {}
            iso = author.get("date") or committer.get("date") or ""
            if not iso:
                continue
            try:
                t = dt.fromisoformat(iso.replace("Z", "+00:00"))
            except ValueError:
                continue
            if t < cutoff:
                # Reached the edge of our window — drop this and stop
                # the outer loop. /commits is sorted desc by date, so
                # nothing after this will be in-window either.
                oldest_in_window = False
                break
            key = t.date().isoformat()
            counts[key] = counts.get(key, 0) + 1
        if not oldest_in_window:
            break
        if len(rows) < per_page:
            # Last page reached.
            break
    return counts


def refresh_repo_commit_cache(repo: GHRepo, *, user=None, days: int = 365) -> None:
    """Rebuild ``GHRepo.daily_commit_counts`` from the GH commits API
    and stamp ``commits_synced_at``. Safe to call repeatedly — the
    aggregation endpoint uses ``commits_synced_at`` as a TTL gate."""
    counts = fetch_commit_dates(repo, days=days, user=user)
    repo.daily_commit_counts = counts
    repo.commits_synced_at = dj_tz.now()
    repo.save(update_fields=["daily_commit_counts", "commits_synced_at"])


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


def assign_issue_to_self(
    repo: GHRepo, issue_number: int, user
) -> dict:
    """Add the caller's GitHub login to the issue's assignees.

    Uses GH's dedicated ``POST /issues/{n}/assignees`` endpoint (vs.
    ``PATCH /issues/{n}`` which replaces the whole assignees list).
    The caller's GH login is read from their connected Identity. GH
    silently drops assignees who aren't repo collaborators — in that
    case the response will be 201 but the login won't appear in the
    ``assignees`` array. We surface this as ``status="not_collaborator"``
    so the UI can show a helpful hint.

    Returns one of:
      * ``{"status": "ok", "assignees": [...]}`` — login is in assignees
      * ``{"status": "not_collaborator", "assignees": [...]}`` — GH
        accepted the call but dropped the assignee (no write access)
      * ``{"status": "no_token" | "no_identity"}`` — caller hasn't
        connected GitHub or their Identity has no GH username
      * ``{"status": "http_NNN" | "error", "detail": "..."}``
    """
    token = _resolve_user_token(user) if user else None
    if not token:
        return {"status": "no_token", "detail": "User has no connected GitHub token"}
    from apps.accounts.models import Identity

    ident = (
        Identity.objects.filter(user=user, provider="github")
        .exclude(provider_username="")
        .first()
    )
    if not ident or not ident.provider_username:
        return {"status": "no_identity", "detail": "GitHub login unknown for this user"}
    login = ident.provider_username
    url = (
        f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/"
        f"issues/{issue_number}/assignees"
    )
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                url,
                headers=_headers(token),
                json={"assignees": [login]},
            )
    except httpx.HTTPError as e:
        return {"status": "error", "detail": str(e)}
    if r.status_code not in (200, 201):
        return {"status": f"http_{r.status_code}", "detail": r.text[:200]}
    data = r.json()
    assignees = [
        (a.get("login") or "").lower()
        for a in (data.get("assignees") or [])
    ]
    if login.lower() not in assignees:
        return {
            "status": "not_collaborator",
            "detail": "GitHub accepted the request but dropped the assignee — caller is not a collaborator on this repo.",
            "assignees": [a.get("login") for a in (data.get("assignees") or [])],
        }
    return {
        "status": "ok",
        "assignees": [a.get("login") for a in (data.get("assignees") or [])],
    }


def unassign_issue_from_self(
    repo: GHRepo, issue_number: int, user
) -> dict:
    """Remove the caller's GitHub login from the issue's assignees.

    Mirror of ``assign_issue_to_self``: uses GH's dedicated
    ``DELETE /issues/{n}/assignees`` endpoint, which only removes
    the listed logins (vs. ``PATCH`` which replaces the whole list).
    Other assignees on the same issue are left untouched.

    Returns one of:
      * ``{"status": "ok", "assignees": [...]}`` — caller no longer
        in the assignees array
      * ``{"status": "no_token" | "no_identity"}``
      * ``{"status": "http_NNN" | "error", "detail": "..."}``
    """
    token = _resolve_user_token(user) if user else None
    if not token:
        return {"status": "no_token", "detail": "User has no connected GitHub token"}
    from apps.accounts.models import Identity

    ident = (
        Identity.objects.filter(user=user, provider="github")
        .exclude(provider_username="")
        .first()
    )
    if not ident or not ident.provider_username:
        return {"status": "no_identity", "detail": "GitHub login unknown for this user"}
    login = ident.provider_username
    url = (
        f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/"
        f"issues/{issue_number}/assignees"
    )
    try:
        with httpx.Client(timeout=10.0) as client:
            # httpx supports request body on DELETE — GitHub requires
            # the assignees list in the body, not as query params.
            r = client.request(
                "DELETE",
                url,
                headers=_headers(token),
                json={"assignees": [login]},
            )
    except httpx.HTTPError as e:
        return {"status": "error", "detail": str(e)}
    if r.status_code not in (200, 201):
        return {"status": f"http_{r.status_code}", "detail": r.text[:200]}
    data = r.json()
    return {
        "status": "ok",
        "assignees": [a.get("login") for a in (data.get("assignees") or [])],
    }


def create_issue(
    repo: GHRepo,
    *,
    title: str,
    body: str,
    labels: list[str],
    user,
) -> dict:
    """POST a new GitHub issue using the caller's connected token.

    GitHub will silently drop labels that don't exist on the target
    repo, so we don't pre-validate them — the bug/feature/task labels
    just won't stick if the repo doesn't have them defined. The caller
    sees the created issue regardless.

    Returns ``{"status": "ok", "number": N, "html_url": "..."}`` or
    ``{"status": "no_token" | "http_NNN" | "error", "detail": "..."}``.
    """
    token = _resolve_user_token(user) if user else None
    if not token:
        return {"status": "no_token", "detail": "User has no connected GitHub token"}
    url = f"{GH_API}/repos/{repo.owner_login}/{repo.repo_name}/issues"
    payload: dict = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(url, headers=_headers(token), json=payload)
    except httpx.HTTPError as e:
        return {"status": "error", "detail": str(e)}
    if r.status_code not in (200, 201):
        return {"status": f"http_{r.status_code}", "detail": r.text[:200]}
    data = r.json()
    return {
        "status": "ok",
        "number": int(data.get("number") or 0),
        "html_url": data.get("html_url", ""),
    }
