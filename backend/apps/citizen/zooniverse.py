"""Zooniverse Panoptes + ERAS API clients.

Two thin httpx wrappers used by the Citizen Science integration:

* :class:`Panoptes` — main REST API at ``panoptes.zooniverse.org``.
  Fetches project / user / group metadata and manages group membership.
  Most endpoints need an OAuth bearer; project metadata is technically
  public but we always send the bearer we already have.

* :class:`Eras` — running-average stats service at
  ``eras.zooniverse.org``. Returns classification counts for projects
  (public), users (per-user OAuth), and user groups (depends on the
  group's ``stats_visibility``).

Bearer tokens for the per-user calls live on
``accounts.Identity.access_token`` (collected during the Zooniverse
OAuth dance in :class:`apps.accounts.oauth.ZooniverseProvider`).

Errors are surfaced via :class:`ZooniverseError` so callers can show
the HTTP code + message to the user / log without dragging full
``httpx`` exceptions into call sites.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PANOPTES_BASE = os.environ.get(
    "ZOONIVERSE_PANOPTES_BASE", "https://panoptes.zooniverse.org"
)
ERAS_BASE = os.environ.get("ZOONIVERSE_ERAS_BASE", "https://eras.zooniverse.org")
TALK_BASE = os.environ.get("ZOONIVERSE_TALK_BASE", "https://talk.zooniverse.org")

# Panoptes follows the JSON:API-ish convention of versioned headers. The
# documented value is `application/vnd.api+json; version=1`. Without it
# you get inconsistent shapes back.
_PANOPTES_ACCEPT = "application/vnd.api+json; version=1"
_PANOPTES_CONTENT = "application/json"


class ZooniverseError(Exception):
    """A Zooniverse REST call returned non-2xx. ``status`` mirrors the HTTP code."""

    def __init__(self, status: int, detail: str, endpoint: str = ""):
        super().__init__(f"Zooniverse {endpoint} {status}: {detail}")
        self.status = status
        self.detail = detail
        self.endpoint = endpoint


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Token:
    """Wraps a Zooniverse bearer token.

    The Panoptes OAuth dance also returns ``refresh_token`` and
    ``expires_in``; we store those on ``Identity``. This object is what
    the API clients accept — just the access token string.
    """

    access_token: str

    @property
    def header(self) -> str:
        return f"Bearer {self.access_token}"


def service_token() -> Token | None:
    """Bootstrap token used for app-level operations (e.g. fetching the
    Astrozor group's join_token, listing members for the membership
    sync task).

    Lives in ``.env`` as ``ZOONIVERSE_SERVICE_ACCESS_TOKEN`` and is
    refreshed by a Celery task using ``ZOONIVERSE_SERVICE_REFRESH_TOKEN``.
    Returns ``None`` if not configured, so callers can degrade
    gracefully (e.g. show public stats only).
    """
    raw = os.environ.get("ZOONIVERSE_SERVICE_ACCESS_TOKEN", "")
    return Token(access_token=raw) if raw else None


# ---------------------------------------------------------------------------
# Panoptes client
# ---------------------------------------------------------------------------


class Panoptes:
    """REST client for ``panoptes.zooniverse.org/api``.

    Usage::

        p = Panoptes(token=service_token())
        proj = p.get_project(5733)                 # Galaxy Zoo
        group = p.get_group(2914377, include="users")
        p.add_users_to_group(2914377, [user_id])   # admin only
    """

    def __init__(self, token: Token | None = None, *, timeout: float = 15.0):
        self.token = token
        self.timeout = timeout

    # --- low-level

    def _headers(self) -> dict[str, str]:
        h = {
            "Accept": _PANOPTES_ACCEPT,
            "Content-Type": _PANOPTES_CONTENT,
            "User-Agent": "Astrozor/1.0 (https://astrozor.cz)",
        }
        if self.token:
            h["Authorization"] = self.token.header
        return h

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{PANOPTES_BASE.rstrip('/')}/api{path}"
        with httpx.Client(timeout=self.timeout) as client:
            r = client.request(
                method, url, headers=self._headers(), params=params, json=json
            )
        if r.status_code >= 300:
            detail = ""
            try:
                j = r.json()
                detail = j.get("errors", j.get("message", "")) or str(j)
            except Exception:
                detail = r.text[:200]
            logger.warning("Panoptes %s %s -> %s %s", method, path, r.status_code, detail)
            raise ZooniverseError(r.status_code, str(detail), endpoint=f"panoptes{path}")
        # 204 No Content is legitimate for DELETE.
        if r.status_code == 204 or not r.content:
            return {}
        return r.json()

    # --- projects

    def search_projects(
        self,
        *,
        search: str = "",
        tags: str = "astronomy",
        state: str = "live",
        page: int = 1,
        page_size: int = 20,
        sort: str = "-classifications_count",
    ) -> list[dict[str, Any]]:
        """Browse / search Panoptes ``/projects``.

        Useful filters (all optional):
          * ``search`` — text search across display_name + description
          * ``tags`` — comma-separated tag list (e.g. "astronomy,radio")
          * ``state`` — "live" | "paused" | "finished"; live by default
          * ``sort`` — prefix with "-" for descending; common choices
            include ``-launch_date``, ``-classifications_count``,
            ``display_name``.

        Returns just the ``projects`` array; pagination metadata is in
        ``meta.projects`` if the caller needs it (omitted for brevity).
        """
        params: dict[str, Any] = {
            "page": page,
            "page_size": min(max(1, page_size), 50),
            "sort": sort,
            "state": state,
        }
        if search:
            params["search"] = search
        if tags:
            params["tags"] = tags
        data = self._request("GET", "/projects", params=params)
        return data.get("projects") or []

    def get_project(self, project_id: int) -> dict[str, Any]:
        """``GET /projects/{id}?include=avatar,background``.

        Panoptes doesn't surface ``avatar_src`` / ``background_src``
        directly on the project envelope — it returns ``links.avatar``
        and ``links.background`` pointers instead. The ``include=``
        parameter inlines the media resources into a ``linked`` block
        so we can pluck the actual image URL in one round-trip.

        Returned dict carries the original project fields plus two
        synthetic ones we set ourselves so callers don't have to know
        about the JSON:API envelope shape::

            project["avatar_src"] = "https://panoptes-uploads.zooniverse.org/...jpeg"
            project["background_src"] = "https://...jpeg"
        """
        data = self._request(
            "GET", f"/projects/{project_id}", params={"include": "avatar,background"}
        )
        items = data.get("projects") or []
        if not items:
            raise ZooniverseError(404, f"project {project_id} not found", endpoint="projects")
        project = items[0]
        linked = data.get("linked") or {}
        avatars = linked.get("avatars") or []
        backgrounds = linked.get("backgrounds") or []
        if avatars and avatars[0].get("src"):
            project["avatar_src"] = avatars[0]["src"]
        if backgrounds and backgrounds[0].get("src"):
            project["background_src"] = backgrounds[0]["src"]
        return project

    # --- workflows

    def list_workflows(self, project_id: int) -> list[dict[str, Any]]:
        """``GET /workflows?project_id={id}`` — workflows belonging to a
        Zooniverse project.

        Returns a list of workflow envelopes. Each envelope carries
        ``id``, ``display_name``, ``active``, ``completeness``, plus a
        ``tasks`` blob we don't currently surface. Sample::

            [{"id": "28504", "display_name": "JWST COSMOS",
              "active": True, "completeness": 0.066},
             {"id": "5653",  "display_name": "SDSS workflow",
              "active": False, "completeness": 1.0}, ...]

        Pagination is ignored on purpose — Astrozor's catalogue caps
        at ~20 projects each with <30 workflows, well under the
        page_size limit.
        """
        data = self._request(
            "GET",
            "/workflows",
            params={"project_id": project_id, "page_size": 50},
        )
        return data.get("workflows") or []

    # --- subjects

    def get_subject(self, subject_id: int) -> dict[str, Any]:
        """``GET /subjects/{id}`` — fetch a Zooniverse subject envelope.

        Subjects are the classifiable items inside a workflow. They
        can be images (most projects), videos (Gravity Spy uses MP4),
        audio (Bat Detective), or multi-frame image sequences (Gravity
        Spy's spectrogram quartet renders as 4 PNGs the classifier
        animates / tiles). The envelope:

            {
              "subjects": [{
                "id": "12345678",
                "metadata": {...},
                "locations": [{"image/png": "..."}, {"video/mp4": "..."}, ...],
                "links": {"project": "7929", "subject_sets": [...]}
              }]
            }

        Panoptes encodes MIME as the *key* of each location entry —
        we surface that as ``location_media``: a list of
        ``{"url", "mime"}`` dicts in original order, so callers can
        pick the right HTML element (``<img>`` / ``<video>`` /
        ``<audio>``). ``location_urls`` is kept as a convenience flat
        URL list for the few legacy call sites that don't care about
        MIME.
        """
        data = self._request("GET", f"/subjects/{subject_id}")
        items = data.get("subjects") or []
        if not items:
            raise ZooniverseError(
                404, f"subject {subject_id} not found", endpoint="subjects"
            )
        subject = items[0]
        media: list[dict[str, str]] = []
        for loc in subject.get("locations") or []:
            if isinstance(loc, dict):
                for mime, url in loc.items():
                    if isinstance(url, str) and url.startswith("http"):
                        media.append({"url": url, "mime": str(mime)[:80]})
            elif isinstance(loc, str) and loc.startswith("http"):
                media.append({"url": loc, "mime": ""})
        subject["location_media"] = media
        subject["location_urls"] = [m["url"] for m in media]
        return subject

    # --- collections (favorites + owner-defined subject groups)

    def list_collections(
        self,
        *,
        owner: str = "",
        favorite: bool | None = None,
        page: int = 1,
        page_size: int = 20,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        """``GET /collections`` — list of user-curated subject groups.

        Two common shapes:

        * ``favorite=True`` — the implicit one-per-user "Favorites"
          collection (Zooniverse auto-creates one). Filter by
          ``owner`` to get the current user's favorites.
        * ``favorite=False`` — explicit collections the user has
          created (private or public).

        Returns the raw envelope ``{collections, meta}`` so callers
        can forward pagination.
        """
        params: dict[str, Any] = {
            "page": page,
            "page_size": min(max(1, page_size), 50),
        }
        if owner:
            params["owner"] = owner
        if favorite is not None:
            params["favorite"] = "true" if favorite else "false"
        if project_id:
            params["project_id"] = project_id
        return self._request("GET", "/collections", params=params)

    def list_subjects_by_ids(self, subject_ids: list[int]) -> list[dict[str, Any]]:
        """Batch ``GET /subjects?id=1,2,3`` — fetch many subjects in
        one round-trip. Used after building a candidate ID list from
        a classifications query, so the picker doesn't fire 24 separate
        ``/subjects/<id>`` calls.

        Returns the ``subjects`` array; preserves the order Panoptes
        returns (NOT the input order — caller should reorder if it
        matters).
        """
        if not subject_ids:
            return []
        # Panoptes caps comma-separated id list around 50 — chunk to be safe.
        out: list[dict[str, Any]] = []
        for i in range(0, len(subject_ids), 50):
            chunk = subject_ids[i : i + 50]
            data = self._request(
                "GET",
                "/subjects",
                params={"id": ",".join(str(x) for x in chunk), "page_size": len(chunk)},
            )
            out.extend(data.get("subjects") or [])
        return out

    def list_subjects_in_collection(
        self,
        collection_id: int,
        *,
        page: int = 1,
        page_size: int = 24,
    ) -> dict[str, Any]:
        """``GET /subjects?collection_id=<id>`` — server-side paged.

        Returns the raw envelope; each subject has the full metadata
        + locations block so callers can build subject preview cards
        without a follow-up call.
        """
        params = {
            "collection_id": collection_id,
            "page": page,
            "page_size": min(max(1, page_size), 50),
        }
        return self._request("GET", "/subjects", params=params)

    # --- users

    def get_user(self, user_id: int) -> dict[str, Any]:
        """``GET /users/{id}`` — returns public user profile.

        Response (excerpt)::

            {
              "users": [{
                "id": "1234",
                "login": "robozor",
                "display_name": "robozor",
                "avatar_src": "https://...",
                "credited_name": "Jan",
                ...
              }]
            }
        """
        data = self._request("GET", f"/users/{user_id}")
        items = data.get("users") or []
        if not items:
            raise ZooniverseError(404, f"user {user_id} not found", endpoint="users")
        return items[0]

    def get_me(self) -> dict[str, Any]:
        """``GET /me`` — current bearer's user. Used right after OAuth
        to capture the Zooniverse ``user_id`` for the Identity row."""
        data = self._request("GET", "/me")
        items = data.get("users") or []
        if not items:
            raise ZooniverseError(401, "no user returned for /me", endpoint="me")
        return items[0]

    # --- groups

    def get_group(
        self, group_id: int, *, include: str | None = None
    ) -> dict[str, Any]:
        """``GET /user_groups/{id}``.

        ``include`` accepts comma-separated relation names — most
        commonly ``"users"`` to inline membership in the same response::

            {
              "user_groups": [{
                "id": "2914377",
                "name": "Astrozor",
                "display_name": "Astrozor",
                "join_token": "abc123...",
                "stats_visibility": "public_show_all",
                "links": {"users": ["1234", "5678", ...]}
              }],
              "linked": {"users": [{"id": "1234", "login": "...", ...}]}
            }
        """
        params = {"include": include} if include else None
        data = self._request("GET", f"/user_groups/{group_id}", params=params)
        items = data.get("user_groups") or []
        if not items:
            raise ZooniverseError(404, f"group {group_id} not found", endpoint="user_groups")
        group = items[0]
        # Surface inlined ``users`` data on the returned dict for callers
        # that want display names without a second round-trip.
        if include and "linked" in data:
            group["_linked"] = data["linked"]
        return group

    def list_group_member_ids(self, group_id: int) -> list[int]:
        """Convenience: extract numeric user IDs from ``links.users``."""
        g = self.get_group(group_id)
        raw = (g.get("links") or {}).get("users") or []
        return [int(x) for x in raw]

    def add_users_to_group(self, group_id: int, user_ids: list[int]) -> dict[str, Any]:
        """``POST /user_groups/{id}/links/users``.

        Caller must be a group admin (the service-account bearer in
        practice). Zooniverse normally requires the *user* to click a
        join-link from their session — this endpoint is for admin
        bootstrap only and is **not** the path Astrozor uses for
        member onboarding (we use the join_token link instead).
        """
        return self._request(
            "POST",
            f"/user_groups/{group_id}/links/users",
            json={"users": [str(u) for u in user_ids]},
        )

    def remove_user_from_group(self, group_id: int, user_id: int) -> None:
        """``DELETE /user_groups/{id}/links/users/{user_id}``."""
        self._request("DELETE", f"/user_groups/{group_id}/links/users/{user_id}")


# ---------------------------------------------------------------------------
# Talk client (Zooniverse community discussion boards)
# ---------------------------------------------------------------------------


def _talk_get(path: str, params: dict[str, Any], *, timeout: float = 15.0) -> dict[str, Any]:
    """Low-level GET against ``talk.zooniverse.org``. Public reads —
    no auth header. Drops ``None`` params so we don't emit empty
    query keys. Surfaces non-2xx as ``ZooniverseError`` like the
    Panoptes / ERAS clients.
    """
    url = f"{TALK_BASE.rstrip('/')}{path}"
    clean = {k: v for k, v in params.items() if v is not None}
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            url,
            params=clean,
            headers={
                "Accept": "application/json",
                "User-Agent": "Astrozor/1.0 (https://astrozor.cz)",
            },
        )
    if r.status_code >= 300:
        raise ZooniverseError(r.status_code, r.text[:200], endpoint=f"talk{path}")
    return r.json() if r.content else {}


def talk_list_boards(project_zid: int, *, timeout: float = 15.0) -> list[dict[str, Any]]:
    """Public read of project boards on Zooniverse Talk.

    Talk boards are organised per-project — there is no per-workflow
    or per-subject board concept (subject-level threads live inside
    the project's default ``subject_default`` board, typically called
    "Notes"). The endpoint is documented at the talk-api repo:

        GET https://talk.zooniverse.org/boards?section=project-<zid>

    Public read works without authentication. Posting requires a
    Panoptes bearer (which Astrozor doesn't currently relay — sprint
    chat fills the gap with our own moderated discussion instead).
    """
    data = _talk_get(
        "/boards",
        {"section": f"project-{project_zid}", "page_size": 30},
        timeout=timeout,
    )
    return data.get("boards") or []


def talk_list_discussions(
    *,
    board_id: int | None = None,
    focus_id: int | None = None,
    focus_type: str = "Subject",
    page: int = 1,
    page_size: int = 20,
    sort: str = "-last_comment_created_at",
    timeout: float = 15.0,
) -> dict[str, Any]:
    """List Talk discussions either inside a board, or focused on a
    specific subject (``focus_id=<subject_id>``, ``focus_type=Subject``).

    Returns the raw envelope ``{discussions, meta}`` so the API
    layer can forward pagination metadata to the client.
    """
    params: dict[str, Any] = {
        "page": page,
        "page_size": min(max(1, page_size), 50),
        "sort": sort,
    }
    if board_id:
        params["board_id"] = board_id
    if focus_id:
        params["focus_id"] = focus_id
        params["focus_type"] = focus_type
    return _talk_get("/discussions", params, timeout=timeout)


def talk_get_discussion(discussion_id: int, *, timeout: float = 15.0) -> dict[str, Any]:
    """Single-discussion envelope. Useful when we land on a permalink
    and need the title + counts without trawling the parent board."""
    data = _talk_get(f"/discussions/{discussion_id}", {}, timeout=timeout)
    items = data.get("discussions") or []
    if not items:
        raise ZooniverseError(
            404, f"discussion {discussion_id} not found", endpoint="talk/discussions"
        )
    return items[0]


def talk_list_comments(
    discussion_id: int,
    *,
    page: int = 1,
    page_size: int = 30,
    sort: str = "created_at",
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Paged comments inside a discussion. Returns the raw envelope
    ``{comments, meta}``; each comment carries ``user_login`` +
    ``user_display_name`` inline so we don't have to batch-fetch
    users separately.
    """
    return _talk_get(
        "/comments",
        {
            "discussion_id": discussion_id,
            "page": page,
            "page_size": min(max(1, page_size), 50),
            "sort": sort,
        },
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# ERAS client
# ---------------------------------------------------------------------------


class Eras:
    """REST client for ``eras.zooniverse.org``.

    Three endpoints we use:

    * ``/classifications`` — totals per project / workflow (public).
    * ``/classifications/users/{id}`` — per-user totals (auth needed).
    * ``/classifications/user_groups/{id}`` — group totals + top
      contributors (auth depends on stats_visibility).

    Period bucketing: pass ``period="day"|"week"|"month"|"year"`` to
    get a time-series ``data`` array next to the ``total_count`` field.
    Omit ``period`` to get just ``total_count``.
    """

    def __init__(self, token: Token | None = None, *, timeout: float = 15.0):
        self.token = token
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {
            "Accept": "application/json",
            "User-Agent": "Astrozor/1.0 (https://astrozor.cz)",
        }
        if self.token:
            h["Authorization"] = self.token.header
        return h

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{ERAS_BASE.rstrip('/')}{path}"
        # Drop None values so we don't send empty params.
        clean = {k: v for k, v in params.items() if v is not None}
        with httpx.Client(timeout=self.timeout) as client:
            r = client.get(url, headers=self._headers(), params=clean)
        if r.status_code >= 300:
            detail = r.text[:200]
            try:
                detail = r.json()
            except Exception:
                pass
            logger.warning("ERAS GET %s -> %s %s", path, r.status_code, detail)
            raise ZooniverseError(r.status_code, str(detail), endpoint=f"eras{path}")
        return r.json() if r.content else {}

    def project_total(
        self,
        project_id: int,
        *,
        period: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        """Public — no auth needed.

        Response::

            {"total_count": 12345678, "data": [{"period": "2026-05-01", "count": 1234}, ...]}
        """
        return self._get(
            "/classifications",
            {
                "project_id": project_id,
                "period": period,
                "start_date": start_date,
                "end_date": end_date,
            },
        )

    def workflow_total(
        self,
        workflow_id: int,
        *,
        period: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        """Public — totals scoped to a single workflow."""
        return self._get(
            "/classifications",
            {
                "workflow_id": workflow_id,
                "period": period,
                "start_date": start_date,
                "end_date": end_date,
            },
        )

    def user_total(
        self,
        user_id: int,
        *,
        period: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        time_spent: bool = False,
        project_contributions: bool = False,
    ) -> dict[str, Any]:
        """Per-user totals. Requires the user's own OAuth bearer
        (Panoptes admins can also read it — irrelevant here).

        Response (with both flags on)::

            {
              "total_count": 4123,
              "time_spent": 3004,
              "project_contributions": [{"project_id": 5733, "count": 4000}, ...],
              "data": [{"period": "2026-05-01", "count": 12}, ...]
            }
        """
        if not self.token:
            raise ZooniverseError(401, "per-user query requires user bearer token")
        return self._get(
            f"/classifications/users/{user_id}",
            {
                "period": period,
                "start_date": start_date,
                "end_date": end_date,
                "time_spent": _bool(time_spent),
                "project_contributions": _bool(project_contributions),
            },
        )

    def group_total(
        self,
        group_id: int,
        *,
        period: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        project_id: int | None = None,
        top_contributors: int | None = None,
        individual_stats_breakdown: bool = False,
    ) -> dict[str, Any]:
        """Per-group totals.

        Access policy depends on the group's ``stats_visibility``:

        * ``private_*`` levels require a bearer for a member or admin
        * ``public_*`` levels accept unauthenticated requests for the
          aggregate; individual breakdowns still need a bearer.

        Response (with top_contributors=10 and individual_stats_breakdown=True)::

            {
              "total_count": 12,
              "time_spent": 71.304,
              "active_users": 1,
              "project_contributions": [{"project_id": 5733, "count": 9}, ...],
              "group_member_stats_breakdown": [
                {"user_id": 1234, "count": 12, "session_time": 71.304}, ...
              ]
            }
        """
        return self._get(
            f"/classifications/user_groups/{group_id}",
            {
                "period": period,
                "start_date": start_date,
                "end_date": end_date,
                "project_id": project_id,
                "top_contributors": top_contributors,
                "individual_stats_breakdown": _bool(individual_stats_breakdown),
            },
        )


def _bool(v: bool) -> str | None:
    """ERAS expects boolean params as lowercase strings; emit None for False
    so we don't waste bytes on the default case."""
    return "true" if v else None


# ---------------------------------------------------------------------------
# OAuth token exchange (used by ZooniverseProvider + Celery refresh task)
# ---------------------------------------------------------------------------


def exchange_refresh_token(refresh_token: str) -> dict[str, Any]:
    """Trade a refresh_token for a fresh access_token.

    Used by the Celery beat job that keeps the service-account bearer
    alive, and by the per-user sync when an access_token has expired.

    Returns the raw OAuth response::

        {"access_token": "...", "refresh_token": "...", "expires_in": 7200,
         "token_type": "Bearer", "scope": "user project group classification"}
    """
    client_id = os.environ.get("ZOONIVERSE_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("ZOONIVERSE_OAUTH_CLIENT_SECRET", "")
    if not (client_id and client_secret):
        raise ZooniverseError(
            500, "ZOONIVERSE_OAUTH_CLIENT_ID/_SECRET not configured", endpoint="oauth"
        )
    url = f"{PANOPTES_BASE.rstrip('/')}/oauth/token"
    with httpx.Client(timeout=15.0) as client:
        r = client.post(
            url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )
    if r.status_code >= 300:
        raise ZooniverseError(
            r.status_code, r.text[:200], endpoint="oauth/token (refresh)"
        )
    return r.json()
