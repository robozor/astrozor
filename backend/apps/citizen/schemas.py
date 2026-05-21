from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from ninja import Schema
from pydantic import Field


class CampaignCreateIn(Schema):
    project_slug: str
    title: str = Field(min_length=2, max_length=200)
    description: str = ""
    methodology: str = ""
    kind: str = "other"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    contribution_schema: dict[str, Any] = {}
    tags: list[str] = []
    # When set, the campaign is a time-boxed sprint around a Zooniverse
    # project. The frontend then shows a Zooniverse-flavoured detail
    # (classify-directly buttons, group leaderboard scoped to the
    # window) instead of the in-house contribution form.
    zooniverse_project_zid: int | None = None
    zooniverse_workflow_id: int | None = None


class CampaignPatchIn(Schema):
    title: str | None = None
    description: str | None = None
    methodology: str | None = None
    kind: str | None = None
    status: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    contribution_schema: dict[str, Any] | None = None
    tags: list[str] | None = None
    zooniverse_project_zid: int | None = None
    zooniverse_workflow_id: int | None = None


class CampaignOut(Schema):
    id: UUID
    project_slug: str
    slug: str
    title: str
    description: str
    methodology: str
    kind: str
    status: str
    coordinator_email: str
    starts_at: datetime | None
    ends_at: datetime | None
    contribution_schema: dict[str, Any]
    contribution_count: int
    accepted_count: int
    created_at: datetime
    tags: list[str] = []
    # Zooniverse linkage — present so the calendar dot, the project
    # detail listing, and the campaign card can all render the
    # Zooniverse context without a second fetch.
    zooniverse_project_zid: int | None = None
    zooniverse_project_title: str = ""
    zooniverse_project_slug: str = ""
    zooniverse_project_avatar_url: str = ""
    zooniverse_workflow_id: int | None = None
    zooniverse_workflow_name: str = ""


class ContributionIn(Schema):
    title: str = ""
    data: dict[str, Any] = {}
    comment: str = ""


class ContributionReviewIn(Schema):
    status: str = Field(description="accepted, rejected, needs_revision")
    review_comment: str = ""


class ContributionOut(Schema):
    id: UUID
    campaign_slug: str
    user_email: str
    user_display_name: str
    title: str
    data: dict[str, Any]
    comment: str
    status: str
    review_comment: str
    reviewed_by_email: str | None
    reviewed_at: datetime | None
    created_at: datetime


# ---- Zooniverse integration ----


class ZooniverseWorkflowOut(Schema):
    """One classification workflow within a Zooniverse project.

    Active workflows render as separate "Classify" CTAs on the project
    detail (Zooniverse projects often run multiple parallel tasks — e.g.
    Galaxy Zoo runs both "JWST COSMOS" and "DECaLS DR5" simultaneously).
    """

    id: int
    display_name: str
    active: bool
    # Float 0.0–1.0 from Panoptes — how done the subject set is.
    completeness: float = 0.0
    # Direct URL to the classify interface for this workflow:
    # ``…/projects/<slug>/classify/workflow/<id>``.
    classify_url: str
    # First task's question, scraped from Panoptes ``tasks[first_task]``
    # — used as a sub-label under the workflow name so users know what
    # they'll be doing without opening Zooniverse first.
    description: str = ""


class ZooniverseProjectOut(Schema):
    id: UUID
    zooniverse_id: int
    slug: str
    title: str
    owner_login: str
    description: str
    introduction: str
    avatar_url: str
    background_url: str
    primary_language: str
    state: str
    classifications_count: int
    is_featured: bool
    tags: list[str] = []
    zooniverse_url: str
    last_synced_at: datetime | None
    # Astrozor-side aggregate, last snapshot we have for the group's
    # contribution on this project. Optional — None if no snapshot yet.
    group_contribution_count: int | None = None
    # Active workflows surface as classify buttons on the detail.
    # Inactive ones are filtered server-side so the wire stays small.
    workflows: list[ZooniverseWorkflowOut] = []
    # Lifecycle flags so the UI can show a "this project isn't
    # actively running" warning. ``zombie=True`` is the derived
    # convenience flag — live state but never launch-approved, with
    # no workflow that has subjects left to classify.
    launch_approved: bool = True
    beta_approved: bool = False
    subjects_count: int = 0
    zombie: bool = False


class ZooniverseProjectSearchResult(Schema):
    """One row in the search-as-you-type picker (admin curation).

    Lightweight subset of the Panoptes project envelope — just what the
    dropdown needs to render. ``already_in_catalogue`` lets the UI dim
    rows we've already added so the admin doesn't double-add.
    """

    zooniverse_id: int
    slug: str = ""
    title: str = ""
    description: str = ""
    avatar_url: str = ""
    classifications_count: int = 0
    state: str = ""
    primary_language: str = ""
    already_in_catalogue: bool = False
    launch_approved: bool = True


class ZooniverseProjectDisconnectSprintRef(Schema):
    """One sprint that will be cascaded out when the parent project is
    disconnected. Surfaces title + slug + status so the admin sees
    exactly which sprints disappear."""

    slug: str
    title: str
    status: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    participant_count: int = 0


class ZooniverseProjectDisconnectPreviewOut(Schema):
    """Counts + sample of records that will be deleted when the admin
    confirms disconnecting a Zooniverse project from the Astrozor
    catalogue.

    None of these touch Zooniverse itself — only our DB. The endpoint
    is read-only; deletion happens via the DELETE on the same path.
    """

    zooniverse_id: int
    title: str
    avatar_url: str = ""
    sprints: list[ZooniverseProjectDisconnectSprintRef] = []
    sprint_count: int = 0
    participant_count: int = 0
    stats_snapshot_count: int = 0
    # True when there are downstream records that *will* be deleted —
    # the modal upgrades to the warning style only then. A bare-bones
    # catalogue row with no sprints disconnects cleanly with no side
    # effects, and the modal can use a softer tone.
    has_downstream: bool = False


class ZooniverseProjectDisconnectResultOut(Schema):
    """Outcome summary of the cascading delete — used by the modal
    to render the post-disconnect flash."""

    zooniverse_id: int
    deleted_project: bool = False
    deleted_sprints: int = 0
    deleted_participants: int = 0
    deleted_snapshots: int = 0


class ZooniverseProjectPreviewOut(Schema):
    """Dry-run snapshot of a Zooniverse project for the admin import
    review modal.

    Differs from :class:`ZooniverseProjectOut` in three ways:

    * The project does **not** need to exist in our catalogue yet —
      Panoptes is queried on demand and the response is returned
      without persisting anything.
    * Includes every active workflow with completeness, so the admin
      sees exactly what users will be able to classify.
    * Surfaces the derived ``zombie`` flag (live but never
      launch-approved + empty subject sets) so the admin can spot
      dead-end projects before committing.
    """

    zooniverse_id: int
    slug: str = ""
    title: str = ""
    owner_login: str = ""
    description: str = ""
    introduction: str = ""
    avatar_url: str = ""
    background_url: str = ""
    primary_language: str = ""
    state: str = ""
    classifications_count: int = 0
    subjects_count: int = 0
    launch_approved: bool = True
    beta_approved: bool = False
    private: bool = False
    workflows: list[ZooniverseWorkflowOut] = []
    zombie: bool = False
    already_in_catalogue: bool = False


class SprintCreateIn(Schema):
    """Minimal payload for creating a Zooniverse-linked sprint.

    Sprints live inside a Zooniverse project — their parent ``Campaign``
    row exists for DB convenience (we reuse the Campaign table) but the
    UI surface is project-scoped. The Astrozor ``Project`` FK is
    auto-assigned to the umbrella ``citizen-science`` project so the
    user doesn't have to pick one.

    ``ends_at`` is optional — open-ended sprints stay open until
    manually closed via :func:`close_sprint`.
    """

    title: str = Field(min_length=2, max_length=200)
    description: str = ""
    workflow_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class SprintPatchIn(Schema):
    title: str | None = None
    description: str | None = None
    workflow_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class SprintOut(Schema):
    """Per-zoo-project sprint card — slimmer than CampaignOut, omits
    the bits the new sprint UI doesn't need (kind / contribution_schema /
    methodology / tags)."""

    id: UUID
    slug: str
    title: str
    description: str
    status: str
    coordinator_email: str
    coordinator_display_name: str = ""
    starts_at: datetime | None
    ends_at: datetime | None
    closed_at: datetime | None = None
    workflow_id: int | None = None
    workflow_name: str = ""
    workflow_classify_url: str = ""
    participant_count: int = 0
    is_joined: bool = False
    can_manage: bool = False
    created_at: datetime
    # Zooniverse project this sprint is attached to. Used by the
    # subject picker to filter favorites/collections to the relevant
    # project so the user doesn't have to scroll through unrelated work.
    zooniverse_project_zid: int | None = None


class SprintStatsOut(Schema):
    """ERAS-derived stats scoped to the sprint window + Zooniverse project.

    Counts are for the **whole Astrozor group** during the window, not
    just sprint participants — ERAS can't filter by Astrozor's roster,
    only by group membership. ``participants`` is the Astrozor-side
    opt-in count for context.
    """

    sprint_slug: str
    starts_at: datetime | None
    ends_at: datetime | None
    is_open: bool
    total_classifications: int = 0
    active_users: int = 0
    time_spent_s: int | None = None
    top_contributors: list[ZooniverseContributorOut] = []
    participants: int = 0
    fetched_at: datetime | None = None


class ZooniverseProjectAddIn(Schema):
    """Admin curation — paste a Zooniverse project ID or URL.

    Backend extracts the numeric ID, fetches metadata via Panoptes,
    creates / updates the row. Tags + is_featured editable separately
    via PATCH.
    """

    zooniverse_id_or_url: str = Field(min_length=1)


class ZooniverseProjectPatchIn(Schema):
    is_featured: bool | None = None
    tags: list[str] | None = None


class ZooniverseContributorOut(Schema):
    """One row in the top-contributors list.

    Where possible the Zooniverse ``user_id`` is matched against our
    ``Identity`` table to surface the Astrozor profile email (so the
    frontend can deep-link to it). Unmatched IDs still appear with the
    Zooniverse login/avatar fetched from Panoptes.
    """

    zooniverse_user_id: int
    login: str = ""
    display_name: str = ""
    avatar_url: str = ""
    count: int = 0
    time_spent_s: int | None = None
    # When we recognise this Zooniverse user as one of our Astrozor
    # users, populate the email so the frontend can link to their
    # profile.
    astrozor_email: str | None = None


class ZooniverseDailyBucket(Schema):
    date: str
    count: int


class ZooniverseGroupDashboardOut(Schema):
    """Aggregated stats for the CitizenSciencePage hero strip."""

    group_id: int
    name: str
    member_count: int
    total_classifications: int
    time_spent_s: int | None = None
    active_users: int = 0
    top_contributors: list[ZooniverseContributorOut] = []
    last_synced_at: datetime | None = None


class ZooniverseProjectSeriesOut(Schema):
    """Daily classifications time-series for the project chart."""

    zooniverse_id: int
    period: str = "day"
    data: list[ZooniverseDailyBucket] = []


class ZooniverseSubjectMedia(Schema):
    """One renderable media file inside a subject — typically an
    image, but also video (Gravity Spy) or audio (Bat Detective).
    ``mime`` is preserved from Panoptes so the renderer picks the
    correct HTML element.
    """

    url: str
    mime: str = ""


class ZooniverseSubjectResolvedOut(Schema):
    """Subject lookup result for the sprint-chat "attach Zooniverse
    subject" picker AND for the Talk subject thread page.

    Subjects can be multi-frame (Gravity Spy spectrograms come as 4
    PNGs that Zooniverse renders as a tiled / animated quartet —
    not a single image). ``media`` carries every frame in original
    order with MIME so the renderer can do the right thing;
    ``locations`` is kept as a back-compat URL list for code that
    only needs thumbnails.
    """

    subject_id: str
    project_zid: int
    media: list[ZooniverseSubjectMedia] = []
    locations: list[str] = []
    classify_url: str = ""
    talk_url: str = ""
    title: str = ""


class ZooniverseTalkDiscussionOut(Schema):
    """One discussion (thread) on Zooniverse Talk."""

    id: int
    title: str
    board_id: int
    user_id: int = 0
    user_login: str = ""
    comments_count: int = 0
    users_count: int = 0
    last_comment_created_at: str = ""
    created_at: str = ""
    sticky: bool = False
    locked: bool = False
    # Subject-bound discussions have a non-empty focus_id pointing
    # at the Zooniverse subject the thread is about.
    focus_id: int = 0
    focus_type: str = ""
    talk_url: str = ""
    # Excerpt of the latest comment so the list view can show context.
    latest_comment_excerpt: str = ""


class ZooniverseTalkDiscussionListOut(Schema):
    """Paged list of discussions in a board OR focused on a subject."""

    items: list[ZooniverseTalkDiscussionOut] = []
    page: int = 1
    page_size: int = 20
    page_count: int = 0
    total: int = 0


class ZooniverseTalkCommentOut(Schema):
    """One comment in a Talk discussion. Sanitised on the way out so
    user-supplied markdown can't break the renderer (Talk allows
    markdown; we render server-side to HTML)."""

    id: int
    body_html: str
    user_id: int = 0
    user_login: str = ""
    user_display_name: str = ""
    created_at: str = ""
    upvotes: int = 0
    is_deleted: bool = False
    reply_id: int = 0


class ZooniverseTalkDiscussionDetailOut(Schema):
    """Discussion meta + a page of comments. Pagination is on
    comments, not discussions — the discussion itself is one row."""

    id: int
    title: str
    board_id: int
    board_title: str = ""
    focus_id: int = 0
    focus_type: str = ""
    locked: bool = False
    sticky: bool = False
    user_login: str = ""
    created_at: str = ""
    talk_url: str = ""
    comments: list[ZooniverseTalkCommentOut] = []
    comments_page: int = 1
    comments_page_size: int = 30
    comments_page_count: int = 0
    comments_total: int = 0


class ZooniverseTalkSubjectViewOut(Schema):
    """Bundled view for ``/talk/subjects/{id}`` — the subject media
    on the left, all discussions focused on it on the right.

    Used both by the standalone "subject thread" page and by chat
    attachment cards that want to surface "what others said about
    this subject" without a second click.
    """

    subject: ZooniverseSubjectResolvedOut
    discussions: list[ZooniverseTalkDiscussionOut] = []
    discussions_total: int = 0


class ZooniverseTalkBoardOut(Schema):
    """One board on the Zooniverse Talk discussion site, scoped to a
    specific project.

    Talk is per-project, not per-workflow. Each project has 3–10
    boards (e.g. "Notes" for per-subject discussion, "General Help",
    plus project-specific topics). We surface them read-only —
    posting requires Zooniverse OAuth which Astrozor doesn't relay.
    """

    id: int
    title: str
    description: str = ""
    discussions_count: int = 0
    comments_count: int = 0
    subject_default: bool = False
    talk_url: str = ""


class ZooniverseTalkBoardsOut(Schema):
    """Wrapper carrying the board list + a project-level Talk URL
    so the frontend's "Open on Zooniverse" button has somewhere to
    land when the user wants to participate.
    """

    project_zid: int
    talk_url: str
    boards: list[ZooniverseTalkBoardOut] = []


class ZooniverseCollectionOut(Schema):
    """One Zooniverse collection — either the user's auto-created
    "favorites" or an explicit collection they've built."""

    id: int
    display_name: str
    favorite: bool = False
    private: bool = False
    subjects_count: int = 0
    # First subject's first media URL — used as a tile thumbnail in
    # the picker so the user picks a collection visually.
    preview_url: str = ""


class ZooniverseCollectionListOut(Schema):
    """List of the user's collections + needs_reconnect signal so the
    picker can prompt for a fresh OAuth when the Identity row exists
    without tokens."""

    items: list[ZooniverseCollectionOut] = []
    needs_reconnect: bool = False


class ZooniverseSubjectListOut(Schema):
    """Paginated list of subjects with media resolved — ready for
    rendering via the MediaBrowser without further calls.

    ``needs_reconnect`` flips to true when we recognise the user has
    a Zooniverse Identity row but its OAuth tokens are missing or
    expired beyond recovery (typically an old identity created before
    refresh-token storage was added). UI then prompts the user to
    disconnect + reconnect the Zoo account.
    """

    items: list[ZooniverseSubjectResolvedOut] = []
    page: int = 1
    page_size: int = 24
    total: int = 0
    needs_reconnect: bool = False


class ZooniverseWorkflowActivityOut(Schema):
    """Per-workflow activity flag for the current user, used to badge
    workflow CTAs on the Zooniverse project detail page.

    ``linked`` is false when the user hasn't connected a Zooniverse
    account — UI then hides the badges and the picker quietly. When
    linked, ``workflows`` lists every active workflow on the project
    with the user's classification count (0 if they've never
    classified there).
    """

    linked: bool
    workflows: list[dict] = []


class ZooniverseMembershipOut(Schema):
    """Connection + membership state for the current user.

    Drives the JoinAstrozorGroupCard's three states on the frontend:
      * linked=false              → "Connect Zooniverse account"
      * linked=true, in_group=false → "Join Astrozor group"
      * linked=true, in_group=true  → "You are a member" badge
    """

    linked: bool
    in_group: bool
    zooniverse_user_id: int | None = None
    zooniverse_login: str = ""
    join_url: str = ""
    group_public_url: str = ""
    member_count: int = 0
    last_synced_at: datetime | None = None
