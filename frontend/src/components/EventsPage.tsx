import { useEffect, useState } from "react";

// Convert an ISO timestamp ("2026-06-01T20:00:00Z") to the value format
// the native <input type="datetime-local"> expects ("YYYY-MM-DDTHH:mm",
// local time, no Z). Cheap inline so we don't pull a date lib for one
// formatter.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  campaigns as campaignsApi,
  events,
  zooniverse,
  type Campaign,
  type Event,
  type Me,
  type Sprint,
  type VisibilityLevel,
  type ZooniverseProject,
} from "../lib/api";
import { navigateTo, useUrlParam } from "../lib/urlParam";

/**
 * Adapt a Sprint (Zoo-linked Campaign) to the Campaign shape the
 * calendar + events list already understand. The Sprint endpoint
 * returns a slimmer envelope, so we synthesise the missing fields
 * with sensible defaults — the consumers only read the fields we
 * actually populate.
 */
function sprintToCampaign(s: Sprint, projects: ZooniverseProject[]): Campaign {
  const project = projects.find(
    (p) => p.zooniverse_id !== null && s.workflow_classify_url.includes(`/projects/${p.slug}`),
  );
  return {
    id: s.id,
    project_slug: "",
    slug: s.slug,
    title: s.title,
    description: s.description,
    methodology: "",
    kind: "other",
    status: s.status,
    coordinator_email: s.coordinator_email,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    contribution_schema: {},
    contribution_count: 0,
    accepted_count: 0,
    created_at: s.created_at,
    tags: [],
    zooniverse_project_zid: project?.zooniverse_id ?? null,
    zooniverse_project_title: project?.title ?? "",
    zooniverse_project_slug: project?.slug ?? "",
    zooniverse_project_avatar_url: project?.avatar_url ?? "",
    zooniverse_workflow_id: s.workflow_id,
    zooniverse_workflow_name: s.workflow_name,
  };
}

function startOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}
import { DateTimePicker } from "./DateTimePicker";
import { EventFeatureIcons } from "./EventFeatureIcons";
import { EventsCalendar } from "./EventsCalendar";
import { EMPTY_LOCATION, LocationPicker, type LocationValue } from "./LocationPicker";
import { RadioChannelPicker } from "./RadioChannelPicker";
import { TagFilter, TagInput, TagsList } from "./Tags";
import { TimeDisplay } from "./TimeDisplay";
import { UserNameLink } from "./UserNameLink";
import { VisibilityPicker } from "./VisibilityPicker";

type View =
  | { kind: "list" }
  | { kind: "detail"; slug: string }
  | { kind: "new" }
  | { kind: "edit"; slug: string };

export function EventsPage({
  me,
  onRequireLogin,
}: {
  me: Me | null;
  onRequireLogin?: () => void;
}) {
  // ?e=<slug> in the URL opens the event detail. Refresh + share links
  // work. Editor states (new/edit) stay session-local — not shareable.
  const [eventSlug, setEventSlug] = useUrlParam("e");
  const [view, setView] = useState<View>(() =>
    eventSlug ? { kind: "detail", slug: eventSlug } : { kind: "list" },
  );
  useEffect(() => {
    if (eventSlug && (view.kind !== "detail" || view.slug !== eventSlug)) {
      setView({ kind: "detail", slug: eventSlug });
    } else if (!eventSlug && view.kind === "detail") {
      setView({ kind: "list" });
    }
  }, [eventSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = (next: View) => {
    setView(next);
    if (next.kind === "detail") setEventSlug(next.slug);
    else if (next.kind === "list") setEventSlug(null);
  };

  // Anon visitors can read the list + detail. Creating / editing /
  // registering routes through onRequireLogin (login modal).
  if (view.kind === "detail") {
    return (
      <EventDetail
        slug={view.slug}
        me={me}
        onBack={() => navigate({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", slug: view.slug })}
        onRequireLogin={onRequireLogin}
      />
    );
  }
  if (view.kind === "new" && me) {
    return (
      <EventEditor
        editSlug={null}
        me={me}
        onDone={(slug) => navigate({ kind: "detail", slug })}
        onCancel={() => navigate({ kind: "list" })}
      />
    );
  }
  if (view.kind === "edit" && me) {
    return (
      <EventEditor
        editSlug={view.slug}
        me={me}
        onDone={(slug) => navigate({ kind: "detail", slug })}
        onCancel={() => navigate({ kind: "detail", slug: view.slug })}
      />
    );
  }
  return (
    <EventList
      isAuthed={!!me}
      me={me}
      onOpen={(slug) => navigate({ kind: "detail", slug })}
      onNew={() => {
        if (me) setView({ kind: "new" });
        else onRequireLogin?.();
      }}
    />
  );
}

// Mirrors backend events/models.py TRANSITIONS — now bidirectional, so
// the organizer can move an event to ANY other status. Self-loops are
// the only thing excluded. Keep in sync with the backend.
const ALL_STATUSES: Event["status"][] = [
  "draft",
  "announced",
  "registration_open",
  "registration_closed",
  "in_progress",
  "finished",
  "cancelled",
];
const TRANSITIONS: Record<Event["status"], Event["status"][]> = ALL_STATUSES.reduce(
  (acc, s) => {
    acc[s] = ALL_STATUSES.filter((other) => other !== s);
    return acc;
  },
  {} as Record<Event["status"], Event["status"][]>,
);

const STATUS_COLOR: Record<Event["status"], string> = {
  draft: "text-slate-500",
  announced: "text-sky-400",
  registration_open: "text-emerald-400",
  registration_closed: "text-amber-400",
  in_progress: "text-fuchsia-400",
  finished: "text-slate-500",
  cancelled: "text-rose-400",
};

function EventList({
  isAuthed,
  me,
  onOpen,
  onNew,
}: {
  isAuthed: boolean;
  me: Me | null;
  onOpen: (slug: string) => void;
  onNew: () => void;
}) {
  void isAuthed; // reserved for future "members-only events" filter; keeps prop required for clarity
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ["events"], queryFn: () => events.list() });
  // Calendar dual-mode: events (single-day) + campaigns (date range).
  // Campaigns are filtered to those with at least one date (otherwise
  // they have no place on a calendar) AND that aren't archived/draft.
  // Sprints (zoo-linked Campaign rows) are excluded from the generic
  // /campaigns endpoint, so we fetch them separately from the
  // Zooniverse endpoints. To stay project-agnostic we walk every
  // catalogued project and concat their sprints.
  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => campaignsApi.list(),
  });
  const zooProjectsQ = useQuery({
    queryKey: ["zooniverse-projects"],
    queryFn: () => zooniverse.listProjects(false),
    staleTime: 5 * 60_000,
  });
  const sprintsQ = useQuery({
    // ``enabled`` blocks the fan-out until we know which projects to
    // hit; staleTime keeps it cheap when the user toggles the filter
    // off and back on.
    queryKey: [
      "events-page-sprints",
      (zooProjectsQ.data ?? []).map((p) => p.zooniverse_id).sort().join(","),
    ],
    queryFn: async () => {
      const projects = zooProjectsQ.data ?? [];
      if (projects.length === 0) return [] as Sprint[];
      const lists = await Promise.all(
        projects.map((p) =>
          zooniverse.listSprints(p.zooniverse_id).catch(() => [] as Sprint[]),
        ),
      );
      return lists.flat();
    },
    enabled: zooProjectsQ.isSuccess,
    staleTime: 60_000,
  });
  // Convert sprints to the same Campaign shape the calendar expects.
  // The shared Campaign type already has zooniverse_project_* fields.
  const sprintsAsCampaigns: Campaign[] = (sprintsQ.data ?? []).map((s) =>
    sprintToCampaign(s, zooProjectsQ.data ?? []),
  );
  const calendarCampaigns: Campaign[] = [
    ...((campaignsQ.data ?? []).filter(
      (c) =>
        (c.starts_at || c.ends_at) &&
        c.status !== "draft" &&
        c.status !== "archived",
    )),
    ...sprintsAsCampaigns.filter(
      (c) =>
        (c.starts_at || c.ends_at) &&
        c.status !== "draft" &&
        c.status !== "archived",
    ),
  ];
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // Calendar day filter — yyyy-mm-dd string (local viewer date) or null.
  // Set by clicking a calendar day; passed back from EventsCalendar.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // "Include sprints" toggle — default on, so the unified list is the
  // typical view. Off restricts the page to in-house events only.
  const [includeSprints, setIncludeSprints] = useState(true);

  const handleCampaignClick = (c: Campaign) => {
    // Sprint (Zoo-linked campaign) → dedicated SprintFullPage so the
    // user lands directly on the discussion / Join prompt rather
    // than the parent project. Project-detail is one back-button away.
    // Unlinked campaigns fall back to the citizen-science index.
    if (c.zooniverse_project_zid && c.slug) {
      navigateTo(
        `/citizen-science?p=${c.zooniverse_project_zid}&s=${encodeURIComponent(c.slug)}`,
      );
    } else if (c.zooniverse_project_zid) {
      navigateTo(`/citizen-science?p=${c.zooniverse_project_zid}`);
    } else {
      navigateTo("/citizen-science");
    }
  };
  const filteredEvents = (list.data ?? []).filter((e) => {
    if (tagFilter.length > 0) {
      const tagSet = new Set((e.tags ?? []).map((t) => t.toLowerCase()));
      if (!tagFilter.every((t) => tagSet.has(t.toLowerCase()))) return false;
    }
    if (selectedDate) {
      // Match yyyy-mm-dd of starts_at in viewer-local time. Use same
      // helper logic as the calendar (toLocaleDateString might vary).
      const d = new Date(e.starts_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key !== selectedDate) return false;
    }
    return true;
  });

  // When the day filter is set, a sprint matches if the selected date
  // falls within ``starts_at..ends_at`` (or ``..today`` for open-ended).
  // Without a day filter, all non-archived sprints show up sorted by
  // starts_at.
  const filteredSprints = includeSprints
    ? sprintsAsCampaigns.filter((c) => {
        if (!c.starts_at && !c.ends_at) return false;
        if (c.status === "archived" || c.status === "draft") return false;
        if (!selectedDate) return true;
        const sel = new Date(selectedDate);
        sel.setHours(0, 0, 0, 0);
        const start = c.starts_at ? startOfDay(c.starts_at) : null;
        const end = c.ends_at ? startOfDay(c.ends_at) : new Date();
        if (start && sel < start) return false;
        if (end && sel > end) return false;
        return true;
      })
    : [];

  // Unified item list, sorted by primary date desc so the upcoming
  // / most recent surface to the top. We tag the discriminator so
  // the renderer picks the right row layout.
  type Row =
    | { kind: "event"; event: Event; sortKey: number }
    | { kind: "sprint"; campaign: Campaign; sortKey: number };
  const rows: Row[] = [
    ...filteredEvents.map<Row>((e) => ({
      kind: "event",
      event: e,
      sortKey: new Date(e.starts_at).getTime(),
    })),
    ...filteredSprints.map<Row>((c) => ({
      kind: "sprint",
      campaign: c,
      // Sort by starts_at if set (matches calendar order); otherwise
      // by ends_at as a fallback so something always lands.
      sortKey: new Date(c.starts_at ?? c.ends_at ?? Date.now()).getTime(),
    })),
  ].sort((a, b) => b.sortKey - a.sortKey);

  return (
    <section data-testid="events-list">
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-xl font-semibold">{t("events.title")}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="flex items-center gap-1.5 text-xs text-slate-300 select-none cursor-pointer"
            title={t("events.includeSprintsHint")}
          >
            <input
              type="checkbox"
              checked={includeSprints}
              onChange={(e) => setIncludeSprints(e.target.checked)}
              data-testid="events-include-sprints"
              className="accent-fuchsia-500"
            />
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" />
              {t("events.includeSprints")}
            </span>
          </label>
          <TagFilter kind="events" selected={tagFilter} onChange={setTagFilter} />
          <button
            type="button"
            onClick={onNew}
            data-testid="event-new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
          >
            {t("events.new")}
          </button>
        </div>
      </header>

      {/* Calendar overview — sits above the list. Clicking a day
          narrows the list to events starting on that day. Citizen-
          Science campaigns get fuchsia bars on every day in their
          range; clicking a campaign hops to its Zooniverse detail.
          The same ``includeSprints`` toggle that hides sprints from
          the list also hides them from the calendar — keeping the
          two surfaces in sync. */}
      {list.isSuccess &&
        (list.data.length > 0 ||
          (includeSprints && calendarCampaigns.length > 0)) && (
          <EventsCalendar
            events={list.data}
            campaigns={includeSprints ? calendarCampaigns : []}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onCampaignClick={handleCampaignClick}
          />
        )}

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && rows.length === 0 && (list.data.length === 0 && filteredSprints.length === 0) && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("events.empty")}</p>
        </div>
      )}
      {list.isSuccess && (list.data.length > 0 || filteredSprints.length > 0) && rows.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-4">
          {t("articles.filter.noMatches")}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((row) =>
          row.kind === "event" ? (
            <EventRow key={`event-${row.event.id}`} event={row.event} me={me} onOpen={onOpen} />
          ) : (
            <SprintRow key={`sprint-${row.campaign.id}`} campaign={row.campaign} onOpen={handleCampaignClick} />
          ),
        )}
      </ul>
    </section>
  );
}

/** Stand-alone in-house event row — moved out of the list mapping so
 *  the unified list can stay declarative and the sprint row can sit
 *  beside it without an inline ternary explosion. */
function EventRow({
  event: e,
  me,
  onOpen,
}: {
  event: Event;
  me: Me | null;
  onOpen: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      className="bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-700 rounded-xl p-4 cursor-pointer transition"
      onClick={() => onOpen(e.slug)}
      data-testid={`event-card-${e.slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-100 truncate">{e.title}</h3>
          <div className="text-xs text-slate-400">
            <TimeDisplay iso={e.starts_at} entityTimezone={e.timezone} me={me} />
            {(e.place_name || e.external_address) && (
              <span className="text-slate-500"> · {e.place_name || e.external_address}</span>
            )}
            {!e.place_name &&
              !e.external_address &&
              e.external_lat !== null &&
              e.external_lon !== null && (
                <span className="text-slate-500"> · {e.external_lat.toFixed(3)}, {e.external_lon.toFixed(3)}</span>
              )}
          </div>
        </div>
        <div className="text-xs flex flex-col items-end gap-1 shrink-0">
          <span className={`font-mono ${STATUS_COLOR[e.status]}`}>{e.status}</span>
          <span className="text-slate-500">
            {e.registration_count}
            {e.capacity > 0 ? ` / ${e.capacity}` : ""} {t("events.attendees")}
          </span>
          <EventFeatureIcons event={e} />
        </div>
      </div>
      {e.description && (
        <p className="text-sm text-slate-400 mt-2 line-clamp-2">{e.description}</p>
      )}
      {e.tags && e.tags.length > 0 && (
        <div className="mt-2">
          <TagsList tags={e.tags} size="xs" />
        </div>
      )}
    </li>
  );
}

/** Sprint row — visually distinct from events (fuchsia accent, project
 *  avatar) so the user can scan-spot Citizen Science items even though
 *  they live in the same list. Click lands on the parent Zooniverse
 *  project detail (where the sprint is actually managed). */
function SprintRow({
  campaign: c,
  onOpen,
}: {
  campaign: Campaign;
  onOpen: (c: Campaign) => void;
}) {
  const { t, i18n } = useTranslation();
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  let dateLabel = "";
  if (c.starts_at && c.ends_at) {
    dateLabel = `${fmtDate(c.starts_at)} – ${fmtDate(c.ends_at)}`;
  } else if (c.starts_at) {
    dateLabel = `${fmtDate(c.starts_at)} →`;
  } else if (c.ends_at) {
    dateLabel = `→ ${fmtDate(c.ends_at)}`;
  }
  return (
    <li
      className="bg-fuchsia-950/15 ring-1 ring-fuchsia-900/40 hover:ring-fuchsia-800/60 rounded-xl p-4 cursor-pointer transition"
      onClick={() => onOpen(c)}
      data-testid={`events-sprint-row-${c.slug}`}
    >
      <div className="flex items-start gap-3">
        {c.zooniverse_project_avatar_url ? (
          <img
            src={c.zooniverse_project_avatar_url}
            alt=""
            className="w-10 h-10 rounded-md ring-1 ring-fuchsia-900/40 object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 rounded-md bg-slate-900 ring-1 ring-fuchsia-900/40 flex items-center justify-center text-fuchsia-300 shrink-0">
            🔭
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 mb-0.5 flex items-center gap-2">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-fuchsia-500" />
            {t("events.sprintRowKicker")}
            <span className="text-slate-500 font-mono normal-case tracking-normal">{c.status}</span>
          </div>
          <h3 className="font-medium text-slate-100 truncate">{c.title}</h3>
          <div className="text-xs text-slate-400 mt-0.5">
            {dateLabel}
            {c.zooniverse_project_title && (
              <span className="text-slate-500">
                {" · "}
                {t("events.sprintProjectLabel", { name: c.zooniverse_project_title })}
              </span>
            )}
            {c.zooniverse_workflow_name && (
              <span className="text-slate-500"> · {c.zooniverse_workflow_name}</span>
            )}
          </div>
          {c.description && (
            <p className="text-sm text-slate-400 mt-2 line-clamp-2">{c.description}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function EventDetail({
  slug,
  me,
  onBack,
  onEdit,
  onRequireLogin,
}: {
  slug: string;
  me: Me | null;
  onBack: () => void;
  onEdit: () => void;
  onRequireLogin?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ["event", slug], queryFn: () => events.get(slug) });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOrganizer = !!me && event.data?.organizer_email === me.user.email;
  const canEdit = !!me && (isOrganizer || me.user.is_staff);
  // Used to gate the registration UI — anon visitors see a "Log in to
  // register" button instead of the live registration controls.
  void onRequireLogin;

  const register = useMutation({
    mutationFn: () => events.register(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });
  const cancel = useMutation({
    mutationFn: () => events.cancelRegistration(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });
  const transition = useMutation({
    mutationFn: (status: Event["status"]) => events.transition(slug, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });
  const remove = useMutation({
    mutationFn: () => events.remove(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.removeQueries({ queryKey: ["event", slug] });
      onBack();
    },
  });

  return (
    <section data-testid="event-detail">
      {/* Top toolbar — Back left, primary actions (Edit, Delete) right.
          Mirrors the layout of ArticleDetail / PlaceDetailPanel so the
          three agendas read as one product. Edit & Delete live here so
          the organizer doesn't have to scroll to find them. */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("common.back")}
        </button>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              data-testid="event-edit"
              className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 px-3 py-1 rounded-md ring-1 ring-slate-700 transition"
            >
              ✎ {t("events.edit")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              data-testid="event-delete"
              className="text-sm bg-rose-950/60 hover:bg-rose-900/60 text-rose-200 px-3 py-1 rounded-md ring-1 ring-rose-900/60 transition"
            >
              ✕ {t("events.delete")}
            </button>
          </div>
        )}
      </div>

      {event.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {event.isSuccess && (
        <article className="space-y-4">
          {/* Header: title + status badge + key meta. Same structure as
              EventDetailPanel.OverviewTab (just with bigger type). */}
          <header className="space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <h2 className="text-2xl font-semibold text-slate-100 flex-1 min-w-0">
                {event.data.title}
              </h2>
              <span
                className={`text-xs font-mono uppercase tracking-wider px-2 py-1 rounded ring-1 ring-slate-800 bg-slate-900 ${STATUS_COLOR[event.data.status]}`}
              >
                {event.data.status}
              </span>
            </div>
            <dl className="text-xs text-slate-400 flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                  {t("events.field.from")}
                </dt>
                <dd className="text-slate-300">
                  <TimeDisplay
                    iso={event.data.starts_at}
                    entityTimezone={event.data.timezone}
                    me={me}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                  {t("events.field.to")}
                </dt>
                <dd className={event.data.ends_at ? "text-slate-300" : "text-slate-500 italic"}>
                  {event.data.ends_at ? (
                    <TimeDisplay
                      iso={event.data.ends_at}
                      entityTimezone={event.data.timezone}
                      me={me}
                    />
                  ) : (
                    t("events.field.endsAtNotSet")
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                  {t("events.field.location")}
                </dt>
                <dd className="text-slate-300">
                  {event.data.place_name || event.data.external_address || (
                    event.data.external_lat !== null && event.data.external_lon !== null ? (
                      <span className="font-mono">
                        {event.data.external_lat.toFixed(4)},{" "}
                        {event.data.external_lon.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">—</span>
                    )
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                  {t("events.organizer")}
                </dt>
                <dd>
                  <UserNameLink
                    email={event.data.organizer_email}
                    displayName={
                      event.data.organizer_display_name ||
                      event.data.organizer_email.split("@")[0]
                    }
                    className="text-slate-300"
                    testid="event-organizer-link"
                  />
                </dd>
              </div>
            </dl>
          </header>

          {event.data.description && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
              <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                {event.data.description}
              </p>
            </div>
          )}

          {/* Action chips — main feature links + iCal. Each chip
              renders only when the corresponding field is set; the
              feature-icons row above the registration shows the
              full set with dim/lit states. */}
          <div className="flex flex-wrap items-center gap-2">
            {event.data.meeting_url && (
              <a
                href={event.data.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md transition"
                data-testid="event-join-meeting"
              >
                🎥 {t("events.joinMeeting")}
              </a>
            )}
            {event.data.discord_url && (
              <a
                href={event.data.discord_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-md transition"
                data-testid="event-join-discord"
              >
                💬 Discord
              </a>
            )}
            {event.data.geocache_url && (
              <a
                href={
                  /^GC[0-9A-Z]+$/i.test(event.data.geocache_url.trim())
                    ? `https://www.geocaching.com/geocache/${event.data.geocache_url.trim()}`
                    : event.data.geocache_url
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-1.5 rounded-md transition"
                data-testid="event-open-geocache"
              >
                🧭 Geocaching
              </a>
            )}
            {event.data.radio_frequency && (
              <span
                className="inline-flex items-center gap-1.5 bg-slate-800 text-slate-100 text-sm px-3 py-1.5 rounded-md ring-1 ring-slate-700 font-mono"
                title={t("events.field.radioFrequency")}
                data-testid="event-radio"
              >
                📻 {event.data.radio_frequency}
              </span>
            )}
            <a
              href={events.icalUrl(slug)}
              className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 ring-1 ring-slate-700 text-slate-200 text-sm px-3 py-1.5 rounded-md transition"
            >
              📅 {t("events.downloadIcal")}
            </a>
          </div>

          {/* Registration card */}
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm text-slate-300">
                <span className="font-semibold">{event.data.registration_count}</span>
                {event.data.capacity > 0 ? ` / ${event.data.capacity}` : ""}{" "}
                <span className="text-slate-500">{t("events.attendees")}</span>
              </span>
              {!isOrganizer && event.data.status === "registration_open" && (
                <div className="flex gap-2">
                  {me ? (
                    <>
                      <button
                        type="button"
                        onClick={() => register.mutate()}
                        disabled={register.isPending}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-1.5 rounded-md transition"
                        data-testid="event-register"
                      >
                        {register.isPending ? "…" : t("events.register")}
                      </button>
                      <button
                        type="button"
                        onClick={() => cancel.mutate()}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm px-3 py-1.5 rounded-md transition"
                      >
                        {t("events.cancelRegistration")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRequireLogin?.()}
                      data-testid="event-register-login"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-1.5 rounded-md transition"
                    >
                      {t("events.loginToRegister")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Organizer-only: status transitions card. Edit/Delete live
              up in the toolbar; this card now only manages workflow. */}
          {canEdit && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-medium text-slate-200">
                {t("events.organizerActions")}
              </h3>
              <p className="text-[11px] text-slate-500">
                {t("events.transitionsTo")}
              </p>
              <div className="flex flex-wrap gap-2">
                {(TRANSITIONS[event.data.status] ?? []).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => transition.mutate(s)}
                    disabled={transition.isPending}
                    className={`text-xs px-2.5 py-1 rounded-md transition ring-1 ${
                      STATUS_COLOR[s]
                    } bg-slate-900 ring-slate-700 hover:bg-slate-800`}
                  >
                    → {s}
                  </button>
                ))}
              </div>
              {transition.error && (
                <p className="text-xs text-rose-400">
                  {(transition.error as Error).message}
                </p>
              )}
            </div>
          )}

          {/* Inline delete confirmation — anchored at the bottom near
              the toolbar action that triggered it. */}
          {confirmDelete && (
            <div className="bg-rose-950/40 ring-1 ring-rose-900/60 rounded-xl p-4 text-sm">
              <p className="text-rose-200 mb-3">
                {t("events.confirmDelete", { title: event.data.title })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="bg-rose-700 hover:bg-rose-600 text-white text-sm px-4 py-1.5 rounded-md transition"
                  data-testid="event-delete-confirm"
                >
                  {remove.isPending ? "…" : t("events.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-sm text-slate-400 hover:text-slate-200 px-3 py-1.5"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function EventEditor({
  editSlug,
  me,
  onDone,
  onCancel,
}: {
  editSlug: string | null;
  me: Me;
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!editSlug;

  // Hydrate from existing event when editing. The form is the same as
  // for create — same fields, same LocationPicker — only the submit
  // target switches to PATCH and we pre-fill state once on load.
  const existing = useQuery({
    queryKey: ["event", editSlug],
    queryFn: () => events.get(editSlug!),
    enabled: isEdit,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("observation");
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");
  const [geocacheUrl, setGeocacheUrl] = useState("");
  const [radioFrequency, setRadioFrequency] = useState("");
  const [capacity, setCapacity] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  // Visibility — see apps/core/visibility.py. Same shape as Place.
  const [visibility, setVisibility] = useState<VisibilityLevel>("public");
  const [allowedEmails, setAllowedEmails] = useState<string[]>([]);
  const [discussionVisibility, setDiscussionVisibility] = useState<"" | VisibilityLevel>("");
  const [discussionAllowedEmails, setDiscussionAllowedEmails] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(!isEdit);

  useEffect(() => {
    if (!isEdit || hydrated || !existing.data) return;
    const e = existing.data;
    setTitle(e.title);
    setDescription(e.description);
    setKind(e.kind);
    // Choose LocationValue mode that matches whatever the event stores
    // — Astrozor place wins if present, otherwise address/map by
    // whether external_address is non-empty.
    if (e.place_slug) {
      setLocation({
        ...EMPTY_LOCATION,
        mode: "place",
        place_slug: e.place_slug,
      });
    } else if (e.external_address) {
      setLocation({
        ...EMPTY_LOCATION,
        mode: "address",
        external_address: e.external_address,
        external_lat: e.external_lat,
        external_lon: e.external_lon,
      });
    } else if (e.external_lat !== null && e.external_lon !== null) {
      setLocation({
        ...EMPTY_LOCATION,
        mode: "map",
        external_lat: e.external_lat,
        external_lon: e.external_lon,
      });
    }
    // datetime-local needs `YYYY-MM-DDTHH:mm` (no Z, local time).
    // DateTimePicker takes ISO directly — no need for the
    // toDatetimeLocal() conversion the native input required.
    setStartsAt(e.starts_at);
    setEndsAt(e.ends_at ?? "");
    setMeetingUrl(e.meeting_url);
    setDiscordUrl(e.discord_url || "");
    setGeocacheUrl(e.geocache_url || "");
    setRadioFrequency(e.radio_frequency || "");
    setCapacity(e.capacity);
    setTags(e.tags ?? []);
    setVisibility(e.visibility ?? "public");
    setAllowedEmails(e.allowed_user_emails ?? []);
    setDiscussionVisibility(e.discussion_visibility ?? "");
    setDiscussionAllowedEmails(e.discussion_allowed_user_emails ?? []);
    setHydrated(true);
  }, [isEdit, hydrated, existing.data]);

  const body = () => ({
    title,
    description,
    kind,
    place_slug:
      location.mode === "place" && location.place_slug
        ? location.place_slug
        : undefined,
    external_address:
      location.mode === "address" ? location.external_address : undefined,
    external_lat:
      location.mode !== "place" ? location.external_lat : undefined,
    external_lon:
      location.mode !== "place" ? location.external_lon : undefined,
    meeting_url: meetingUrl.trim() || undefined,
    discord_url: discordUrl.trim() || undefined,
    geocache_url: geocacheUrl.trim() || undefined,
    radio_frequency: radioFrequency.trim() || undefined,
    // startsAt / endsAt are already ISO strings from DateTimePicker.
    starts_at: startsAt,
    ends_at: endsAt || undefined,
    capacity,
    tags,
    visibility,
    allowed_user_emails: allowedEmails,
    discussion_visibility: discussionVisibility,
    discussion_allowed_user_emails: discussionAllowedEmails,
  });

  const create = useMutation({
    mutationFn: () => events.create(body()),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      onDone(e.slug);
    },
  });
  // Discord auto-generate flow (events.createDiscordChannel) is wired
  // on the backend but the bot-install OAuth currently 50040s on our
  // test account, so the UI button is hidden — see Discord field
  // comment in the form below. Re-add the mutation + button when the
  // OAuth flow is unblocked.

  const update = useMutation({
    mutationFn: () => {
      // PATCH allows partial; we send the full body so the user's edits
      // (including blanking ends_at) propagate. Backend ignores
      // undefined keys via Pydantic exclude_unset.
      const b = body();
      return events.patch(editSlug!, {
        title: b.title,
        description: b.description,
        kind: b.kind,
        place_slug: b.place_slug ?? "",   // empty string clears the FK on the server
        external_address: b.external_address ?? "",
        external_lat: b.external_lat ?? null,
        external_lon: b.external_lon ?? null,
        meeting_url: b.meeting_url ?? "",
        discord_url: b.discord_url ?? "",
        geocache_url: b.geocache_url ?? "",
        radio_frequency: b.radio_frequency ?? "",
        starts_at: b.starts_at,
        ends_at: b.ends_at ?? null,
        capacity: b.capacity,
        tags,
        visibility,
        allowed_user_emails: allowedEmails,
        discussion_visibility: discussionVisibility,
        discussion_allowed_user_emails: discussionAllowedEmails,
      });
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["event", editSlug] });
      onDone(e.slug);
    },
  });

  const save = isEdit ? update : create;

  return (
    <section data-testid="event-editor">
      {/* Mirror the article / event-detail toolbar — back left, save
          right. Save lives in the header so the user always has it in
          reach. Disabled until required fields are valid. */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("common.cancel")}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            form="event-editor-form"
            disabled={save.isPending || !title.trim() || !startsAt}
            data-testid={isEdit ? "event-save" : "event-create"}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-1.5 rounded-md transition"
          >
            {save.isPending
              ? "…"
              : isEdit
                ? t("events.saveChanges")
                : t("events.create")}
          </button>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">
        {isEdit ? t("events.editTitle") : t("events.new")}
      </h2>

      <form
        id="event-editor-form"
        className="space-y-4 max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && startsAt) save.mutate();
        }}
      >
        <FormSection title={t("events.section.basic")}>
          <Input
            label={t("events.field.title")}
            value={title}
            onChange={setTitle}
            required
            testId="event-title"
          />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              {t("events.field.kind")}
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-sm"
            >
              <option value="observation">{t("events.kind.observation")}</option>
              <option value="star_party">{t("events.kind.star_party")}</option>
              <option value="lecture">{t("events.kind.lecture")}</option>
              <option value="workshop">{t("events.kind.workshop")}</option>
              <option value="projection">{t("events.kind.projection")}</option>
              <option value="exhibition">{t("events.kind.exhibition")}</option>
              <option value="citizen_campaign">{t("events.kind.citizen_campaign")}</option>
              <option value="other">{t("events.kind.other")}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              {t("events.field.description")}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-sm"
            />
          </label>
        </FormSection>

        <FormSection title={t("events.section.schedule")}>
          {/* Explainer for organizers: timezone semantics of the
              pickers. The form treats whatever the user types as
              LOCAL clock time at the event coordinates — i.e. what
              participants on site will see on their watches at the
              requested moment. Astrozor converts to UTC at save time
              and renders all 3 flavours (UTC / Local / User) wherever
              the event surface appears. */}
          <div className="bg-slate-900/40 ring-1 ring-slate-800 rounded-md px-3 py-2 mb-1 text-[11px] text-slate-400">
            <p>
              <span className="text-amber-300 mr-1" aria-hidden>⏱</span>
              {t("events.field.localTimeHint")}
            </p>
            {existing.data?.timezone && (
              <p className="mt-0.5 text-slate-500">
                <span className="font-mono text-slate-400">
                  {existing.data.timezone}
                </span>{" "}
                {t("events.field.detectedFromCoords")}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                {t("events.field.startsAt")} *
              </span>
              <DateTimePicker
                value={startsAt}
                onChange={setStartsAt}
                required
                testId="event-starts"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                {t("events.field.endsAt")}
              </span>
              <DateTimePicker value={endsAt} onChange={setEndsAt} />
            </label>
          </div>
        </FormSection>

        <FormSection title={t("events.section.location")}>
          <LocationPicker value={location} onChange={setLocation} />
        </FormSection>

        <FormSection title={t("events.section.online")}>
          {/* Each of these fields lights up its corresponding feature
              icon on the event card. Empty = icon dimmed, set = icon
              lit. */}
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              🎥 {t("events.field.meetingUrl")}
            </span>
            <div className="flex gap-2">
              <input
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.jit.si/…"
                className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  const room = `astrozor-${
                    Math.random().toString(36).slice(2, 12)
                  }-${Math.random().toString(36).slice(2, 6)}`;
                  setMeetingUrl(`https://meet.jit.si/${room}`);
                }}
                data-testid="event-jitsi-generate"
                className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-2 rounded-md transition whitespace-nowrap"
                title={t("events.field.meetingGenerateHint")}
              >
                🎥 {t("events.field.meetingGenerate")}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              💬 {t("events.field.discordUrl")}
            </span>
            {/* Manual paste only — Discord bot auto-generate was
                planned but Discord's API throws error 50040 in our
                setup for reasons we couldn't reproduce in test apps.
                Backend code is still in place (apps.accounts.
                discord_bot + the /events/{slug}/discord-channel
                endpoint) so we can re-enable the button when Discord
                cooperates. For now organizers paste their own invite. */}
            <input
              type="url"
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              placeholder="https://discord.gg/…"
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs"
              data-testid="event-discord-url"
            />
            <details className="mt-1 text-[11px] text-slate-500">
              <summary className="cursor-pointer hover:text-slate-300 transition select-none">
                {t("events.field.discordHowto")}
              </summary>
              <ol
                className="list-decimal list-inside mt-1.5 space-y-0.5 text-slate-400 pl-1"
                dangerouslySetInnerHTML={{ __html: t("events.field.discordHowtoSteps") }}
              />
            </details>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              🧭 {t("events.field.geocacheUrl")}
            </span>
            <input
              type="text"
              value={geocacheUrl}
              onChange={(e) => setGeocacheUrl(e.target.value)}
              placeholder={t("events.field.geocachePlaceholder")}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs"
              data-testid="event-geocache-url"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              {t("events.field.geocacheHint")}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              📻 {t("events.field.radioFrequency")}
            </span>
            <RadioChannelPicker
              value={radioFrequency}
              onChange={setRadioFrequency}
            />
          </label>
        </FormSection>

        <FormSection title={t("events.section.attendance")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={t("events.field.capacity")}
              value={String(capacity)}
              onChange={(v) => setCapacity(parseInt(v) || 0)}
              type="number"
            />
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                {t("events.field.tags")}
              </span>
              <TagInput value={tags} onChange={setTags} />
            </label>
          </div>
        </FormSection>

        <FormSection title={t("events.section.visibility")}>
          <div className="space-y-3">
            <VisibilityPicker
              label={t("visibility.label")}
              value={visibility}
              allowedEmails={allowedEmails}
              onChange={(v) => v && setVisibility(v as VisibilityLevel)}
              onAllowedEmailsChange={setAllowedEmails}
              ownerEmail={existing.data?.organizer_email || me.user.email}
              testidPrefix="event-visibility"
            />
            <VisibilityPicker
              label={t("visibility.discussionLabel")}
              value={discussionVisibility}
              allowedEmails={discussionAllowedEmails}
              onChange={setDiscussionVisibility}
              onAllowedEmailsChange={setDiscussionAllowedEmails}
              allowInherit
              ownerEmail={existing.data?.organizer_email || me.user.email}
              testidPrefix="event-discussion-visibility"
            />
          </div>
        </FormSection>

        {save.error && (
          <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
            {(save.error as Error).message}
          </p>
        )}

        {/* Footer save — duplicate of header button so the user doesn't
            have to scroll back up after the last section. */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={save.isPending || !title.trim() || !startsAt}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
          >
            {save.isPending
              ? "…"
              : isEdit
                ? t("events.saveChanges")
                : t("events.create")}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Boxed section with a small label header. Used inside EventEditor to
 * group related fields (Basic / Schedule / Location / Online / …).
 * Visually consistent with PlaceFormModal's section style so the two
 * forms feel like siblings.
 */
function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="bg-slate-950/40 ring-1 ring-slate-800 rounded-xl p-4 space-y-3">
      <legend className="text-[11px] uppercase tracking-wider text-slate-400 font-medium px-2 -ml-2">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
      />
    </label>
  );
}
