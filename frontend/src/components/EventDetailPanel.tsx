import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, auth, events, type Event, type Me } from "../lib/api";
import { ThreadedDiscussion } from "./ThreadedDiscussion";
import { TimeDisplay } from "./TimeDisplay";
import { UserNameLink } from "./UserNameLink";

// Mirrors backend events/models.py TRANSITIONS — bidirectional, every
// status can move to every other status (no terminal states). Self-loops
// excluded. Keep in sync with the backend.
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

/**
 * Build a `https://calendar.google.com/calendar/r/eventedit?…` URL with
 * the event details pre-filled. Opening this URL in a new tab puts the
 * user in Google Calendar's "Create event" page with everything filled
 * in — they just confirm with Save. Uses the default (primary)
 * calendar by default. No OAuth scope required.
 *
 * Format: YYYYMMDDTHHmmssZ/YYYYMMDDTHHmmssZ (UTC, no punctuation).
 * If `ends_at` is missing we default to 2 hours after starts_at.
 */
function googleCalendarUrl(ev: Event): string {
  const fmt = (iso: string) =>
    iso.replace(/-|:|\.\d+/g, "").replace(/T/, "T").replace(/Z$/, "Z");
  const startMs = new Date(ev.starts_at).getTime();
  const endIso = ev.ends_at
    ? new Date(ev.ends_at).toISOString()
    : new Date(startMs + 2 * 60 * 60 * 1000).toISOString();
  const dates = `${fmt(new Date(ev.starts_at).toISOString())}/${fmt(endIso)}`;
  const location =
    ev.place_name || ev.external_address ||
    (ev.external_lat !== null && ev.external_lon !== null
      ? `${ev.external_lat.toFixed(5)},${ev.external_lon.toFixed(5)}`
      : "");
  const detail = ev.description || `Astrozor: ${ev.title}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
    details: detail.slice(0, 1000),
  });
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const MIN_WIDTH = 340;
const MAX_WIDTH_FACTOR = 0.6;
const WIDTH_STORAGE_KEY = "astrozor.eventPanel.width";

type Tab = "overview" | "discussion";

const STATUS_COLOR: Record<string, string> = {
  draft: "text-slate-500",
  announced: "text-sky-400",
  registration_open: "text-emerald-400",
  registration_closed: "text-amber-400",
  in_progress: "text-fuchsia-400",
  finished: "text-slate-500",
  cancelled: "text-rose-400",
};

function readInitialWidth(): number {
  try {
    const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (Number.isFinite(v) && v >= MIN_WIDTH) return v;
    }
  } catch {
    // ignore
  }
  return 420;
}

/**
 * Slide-in right panel for an Event — mirrors PlaceDetailPanel so the
 * UI feels uniform. Tabs:
 *   - overview:  read-only event info + registration controls
 *   - discussion: threaded comments (same ThreadedDiscussion component
 *                 used by chat & article comments)
 */
export function EventDetailPanel({
  slug,
  me,
  onClose,
}: {
  slug: string;
  me: Me | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");
  const [width, setWidth] = useState<number>(readInitialWidth);
  const dragging = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = dragging.current.startX - e.clientX;
      const next = Math.max(
        MIN_WIDTH,
        Math.min(
          Math.round(window.innerWidth * MAX_WIDTH_FACTOR),
          dragging.current.startW + dx,
        ),
      );
      setWidth(next);
    }
    function onUp() {
      if (dragging.current) {
        try {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
        } catch {
          // ignore
        }
        dragging.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  return (
    <aside
      data-testid="event-detail-panel"
      className="absolute top-0 right-0 bottom-0 bg-slate-950/95 ring-1 ring-slate-800 backdrop-blur overflow-hidden z-10 flex flex-col"
      style={{ width: `${width}px` }}
    >
      <button
        type="button"
        aria-label="Resize panel"
        onMouseDown={(e) => {
          dragging.current = { startX: e.clientX, startW: width };
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
        }}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors z-20"
      />
      <header className="sticky top-0 bg-slate-950/95 backdrop-blur px-5 py-4 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold pr-4 truncate">
              📍 <EventTitle slug={slug} />
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {t("events.title")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <nav className="flex gap-1 mt-3">
          <TabBtn id="overview" active={tab === "overview"} onClick={() => setTab("overview")}>
            {t("events.tab.overview")}
          </TabBtn>
          <TabBtn id="discussion" active={tab === "discussion"} onClick={() => setTab("discussion")}>
            {t("events.tab.discussion")}
          </TabBtn>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto dark-scroll px-5 py-4">
        {tab === "overview" && <OverviewTab slug={slug} me={me} />}
        {tab === "discussion" && <DiscussionTab slug={slug} me={me} />}
      </div>
    </aside>
  );
}

// Identical visual style to PlaceDetailPanel.TabBtn so the two panels
// feel like one product. Active = subtle gray (not indigo) so the tab
// row doesn't fight with primary actions further down.
function TabBtn({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`event-tab-${id}`}
      className={`flex-1 text-xs px-2 py-1.5 rounded-md transition ${
        active
          ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// Tiny helper: header shows the event title from the cached query so
// it appears as soon as the panel opens (no flash of "Načítám…").
function EventTitle({ slug }: { slug: string }) {
  const q = useQuery({
    queryKey: ["event", slug],
    queryFn: () => events.get(slug),
    staleTime: 30_000,
  });
  return <>{q.data?.title ?? slug}</>;
}

// ---- Overview tab ----

function OverviewTab({ slug, me }: { slug: string; me: Me | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["event", slug],
    queryFn: () => events.get(slug),
    staleTime: 30_000,
  });

  const [confirmDelete, setConfirmDelete] = useState(false);

  const register = useMutation({
    mutationFn: () => events.register(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });
  const cancelReg = useMutation({
    mutationFn: () => events.cancelRegistration(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });

  // Transitions + delete are gated on owner/admin. Same rules as the
  // events agenda Detail view; we duplicate the check here so the map
  // panel feels like a fully-functional event view.
  const transition = useMutation({
    mutationFn: (status: Event["status"]) => events.transition(slug, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", slug] }),
  });
  const remove = useMutation({
    mutationFn: () => events.remove(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.removeQueries({ queryKey: ["event", slug] });
      // Tell the map host to close this panel — emit a custom event
      // since we don't hold a setter here.
      window.dispatchEvent(new CustomEvent("astrozor:event-deleted", { detail: { slug } }));
    },
  });

  if (q.isLoading) return <p className="text-slate-400 text-sm">{t("common.loading")}</p>;
  if (q.isError)
    return <p className="text-rose-400 text-sm">{(q.error as ApiError).detail}</p>;
  if (!q.data) return null;
  const event = q.data;
  const statusColor = STATUS_COLOR[event.status] ?? "text-slate-400";
  const canRegister = !!me && event.status === "registration_open";
  const canEdit = !!me && (event.organizer_email === me.user.email || me.user.is_staff);
  const error =
    (register.error as ApiError | null) ??
    (cancelReg.error as ApiError | null) ??
    (transition.error as ApiError | null) ??
    (remove.error as ApiError | null) ??
    null;

  // Pick whichever pair of coords we actually have — place takes
  // precedence (it's the canonical Astrozor record).
  const lat = event.place_lat ?? event.external_lat;
  const lon = event.place_lon ?? event.external_lon;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-100">{event.title}</h2>
      <p className="text-xs">
        <span className={`font-mono ${statusColor}`}>{event.status}</span>
      </p>
      <dl className="text-xs text-slate-400 space-y-1.5">
        <div className="flex gap-2">
          <dt className="text-slate-500 w-7 shrink-0">{t("events.field.from")}</dt>
          <dd className="text-slate-300">
            <TimeDisplay
              iso={event.starts_at}
              entityTimezone={event.timezone}
              me={me}
            />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-500 w-7 shrink-0">{t("events.field.to")}</dt>
          <dd className={event.ends_at ? "text-slate-300" : "text-slate-500 italic"}>
            {event.ends_at ? (
              <TimeDisplay
                iso={event.ends_at}
                entityTimezone={event.timezone}
                me={me}
              />
            ) : (
              t("events.field.endsAtNotSet")
            )}
          </dd>
        </div>
      </dl>
      {(event.place_name || event.external_address) && (
        <p className="text-sm text-slate-200">
          📍 {event.place_name || event.external_address}
        </p>
      )}
      <p className="text-xs text-slate-400">
        {t("events.organizer")}:{" "}
        <UserNameLink
          email={event.organizer_email}
          displayName={
            event.organizer_display_name ||
            event.organizer_email.split("@")[0]
          }
          className="text-slate-300"
        />
      </p>

      {event.description && (
        <div className="bg-slate-900/40 ring-1 ring-slate-800 rounded-md p-3">
          <p className="text-sm text-slate-300 whitespace-pre-line">
            {event.description}
          </p>
        </div>
      )}

      {/* Join-meeting button — always rendered so its presence is part
          of the panel's visual identity. Grey/disabled when no URL is
          configured so the user knows the option exists even if this
          event hasn't enabled it. */}
      {event.meeting_url ? (
        <a
          href={event.meeting_url}
          target="_blank"
          rel="noreferrer"
          data-testid="event-panel-join-meeting"
          className="block w-full text-center text-xs px-3 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white transition"
        >
          🎥 {t("events.joinMeeting")}
        </a>
      ) : (
        <button
          type="button"
          disabled
          data-testid="event-panel-join-meeting-disabled"
          title={t("events.noMeetingConfigured")}
          className="block w-full text-center text-xs px-3 py-2 rounded-md bg-slate-900 ring-1 ring-slate-800 text-slate-500 cursor-not-allowed"
        >
          🎥 {t("events.joinMeeting")}
          <span className="text-slate-600 ml-1">— {t("events.noMeetingConfigured")}</span>
        </button>
      )}

      {(lat !== null || event.place_elevation_m !== null || event.place_bortle !== null) && (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {lat !== null && (
            <Stat label={t("places.field.lat")} value={lat.toFixed(4)} />
          )}
          {lon !== null && (
            <Stat label={t("places.field.lon")} value={lon.toFixed(4)} />
          )}
          {event.place_elevation_m !== null && (
            <Stat
              label={t("places.field.elevation")}
              value={`${event.place_elevation_m} m`}
            />
          )}
          {event.place_bortle !== null && (
            <Stat
              label={t("places.field.bortle")}
              value={event.place_bortle.toFixed(1)}
            />
          )}
        </dl>
      )}

      <AttendeesList slug={event.slug} total={event.registration_count} capacity={event.capacity} />

      {/* Google Calendar shortcut — only meaningful when the user has
          a linked Google identity (otherwise the "create event" page
          forces a sign-in that won't reuse their Astrozor session).
          We open the prefilled template URL in a new tab; user just
          clicks Save in Google's UI. */}
      <GoogleCalendarButton event={event} me={me} />

      {/* Registration controls */}
      <div className="border-t border-slate-800 pt-3 space-y-2">
        {!me && (
          <p className="text-xs text-slate-500 italic">
            {t("events.loginToRegister")}
          </p>
        )}
        {canRegister && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => register.mutate()}
              disabled={register.isPending || cancelReg.isPending}
              data-testid="event-panel-register"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-3 py-2 rounded-md transition"
            >
              {register.isPending ? "…" : t("events.register")}
            </button>
            <button
              type="button"
              onClick={() => cancelReg.mutate()}
              disabled={register.isPending || cancelReg.isPending}
              data-testid="event-panel-cancel-reg"
              className="text-sm text-rose-400 hover:text-rose-300 px-3 py-2"
            >
              {t("events.cancelRegistration")}
            </button>
          </div>
        )}
        {me && !canRegister && (
          <p className="text-xs text-slate-500 italic">
            {t("events.registrationNotOpen")}
          </p>
        )}
        {error && (
          <p className="text-xs text-rose-400">{error.detail}</p>
        )}
      </div>

      {/* Owner / admin controls — status transitions + delete. The same
          surface as in EventDetail (Events agenda) so editing the
          event from either entry point feels the same. */}
      {canEdit && (
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">
            {t("events.organizerActions")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(TRANSITIONS[event.status] ?? []).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => transition.mutate(s)}
                disabled={transition.isPending}
                data-testid={`event-panel-transition-${s}`}
                className="text-xs px-2 py-1 rounded-md ring-1 bg-slate-900 ring-slate-700 text-slate-300 hover:bg-slate-800 transition"
              >
                → {s}
              </button>
            ))}
            {TRANSITIONS[event.status]?.length === 0 && (
              <span className="text-xs text-slate-500 italic">
                {t("events.terminalState")}
              </span>
            )}
          </div>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              data-testid="event-panel-delete"
              className="text-xs px-2 py-1 rounded-md ring-1 bg-rose-950/40 ring-rose-900/60 text-rose-300 hover:bg-rose-900/40 transition"
            >
              ✕ {t("events.delete")}
            </button>
          ) : (
            <div className="bg-rose-950/40 ring-1 ring-rose-900/60 rounded-md p-2 text-xs">
              <p className="text-rose-200 mb-2">
                {t("events.confirmDelete", { title: event.title })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="bg-rose-700 hover:bg-rose-600 text-white px-3 py-1 rounded-md"
                >
                  {remove.isPending ? "…" : t("events.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-slate-400 hover:text-slate-200 px-3 py-1"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleCalendarButton({
  event,
  me,
}: {
  event: Event;
  me: Me | null;
}) {
  const { t } = useTranslation();
  // Only fetch identities when logged in — anonymous users see the
  // disabled button with a generic hint.
  const q = useQuery({
    queryKey: ["identities"],
    queryFn: auth.listIdentities,
    enabled: !!me,
    staleTime: 60_000,
  });
  const hasGoogle = (q.data ?? []).some((i) => i.provider === "google");
  const url = googleCalendarUrl(event);

  if (!me) {
    return (
      <button
        type="button"
        disabled
        className="w-full text-xs px-3 py-2 rounded-md bg-slate-900 ring-1 ring-slate-800 text-slate-500 cursor-not-allowed"
        title={t("events.googleCalendar.loginFirst")}
      >
        📅 {t("events.googleCalendar.add")}
      </button>
    );
  }

  if (!hasGoogle) {
    return (
      <button
        type="button"
        disabled
        data-testid="event-gcal-disabled"
        className="w-full text-xs px-3 py-2 rounded-md bg-slate-900 ring-1 ring-slate-800 text-slate-500 cursor-not-allowed"
        title={t("events.googleCalendar.connectFirst")}
      >
        📅 {t("events.googleCalendar.add")}{" "}
        <span className="text-slate-600">— {t("events.googleCalendar.connectHint")}</span>
      </button>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      data-testid="event-gcal-link"
      className="block w-full text-center text-xs px-3 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white transition"
      title={t("events.googleCalendar.tooltip")}
    >
      📅 {t("events.googleCalendar.add")}
    </a>
  );
}

// Collapsible attendees list. Defaults to collapsed so the panel
// stays compact; the count + chevron click toggles expansion. Each
// row is a UserNameLink so clicking opens the public profile modal.
function AttendeesList({
  slug,
  total,
  capacity,
}: {
  slug: string;
  total: number;
  capacity: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["event-registrations", slug],
    queryFn: () => events.registrations(slug),
    enabled: open,
    staleTime: 30_000,
  });
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1"
        data-testid="event-attendees-toggle"
      >
        <span>
          👥 {total}
          {capacity > 0 ? ` / ${capacity}` : ""} {t("events.attendees")}
        </span>
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {q.isLoading && (
            <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
          )}
          {q.data && q.data.length === 0 && (
            <p className="text-[11px] text-slate-500 italic">
              {t("events.attendeesEmpty")}
            </p>
          )}
          {q.data?.map((r) => (
            <div
              key={r.id}
              className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-xs"
            >
              <UserNameLink
                email={r.user_email}
                displayName={r.user_display_name || r.user_email.split("@")[0]}
                className="text-slate-200"
                testid={`attendee-${r.id}`}
              />
              <span className="text-slate-500 ml-2 text-[10px]">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-slate-100 font-mono">{value}</div>
    </div>
  );
}

// ---- Discussion tab ----

function DiscussionTab({ slug, me }: { slug: string; me: Me | null }) {
  const { t } = useTranslation();
  // Reuse the event detail query (same key as OverviewTab) — React
  // Query dedupes the fetch, so we get the timezone without a second
  // network call. Only used for entityTimezone forwarding to the
  // ThreadedDiscussion timestamps.
  const eventQ = useQuery({
    queryKey: ["event", slug],
    queryFn: () => events.get(slug),
    staleTime: 30_000,
  });
  const comments = useQuery({
    queryKey: ["event-comments", slug],
    queryFn: () => events.comments(slug),
    refetchInterval: 5_000,
  });
  return (
    <ThreadedDiscussion
      items={comments.data?.items ?? []}
      me={me}
      queryKey={["event-comments", slug]}
      onPost={(body) => events.postComment(slug, body)}
      onDelete={(id) => events.deleteComment(id)}
      emptyLabel={t("events.discussionEmpty")}
      testidPrefix="event-discussion"
      entityTimezone={eventQ.data?.timezone}
    />
  );
}
