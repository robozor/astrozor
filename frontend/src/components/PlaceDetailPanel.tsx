import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  chat,
  places as placesApi,
  presence,
  subscriptions,
  type BortleHistoryItem,
  type Place,
  type Me,
  type Subscription,
} from "../lib/api";

type Tab = "overview" | "chat";

const WIDTH_STORAGE_KEY = "astrozor.placeDetail.width";
const MIN_WIDTH = 320;
const MAX_WIDTH_FACTOR = 0.6;
const DEFAULT_WIDTH_FACTOR = 0.25;

function readInitialWidth(): number {
  if (typeof window === "undefined") return 384;
  const max = Math.round(window.innerWidth * MAX_WIDTH_FACTOR);
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY) || "");
  if (stored && Number.isFinite(stored)) {
    return Math.max(MIN_WIDTH, Math.min(max, Math.round(stored)));
  }
  return Math.max(MIN_WIDTH, Math.min(max, Math.round(window.innerWidth * DEFAULT_WIDTH_FACTOR)));
}

export function PlaceDetailPanel({
  place,
  me,
  onClose,
}: {
  place: Place;
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
      const dx = dragging.current.startX - e.clientX; // drag handle is on the left edge → moving left grows panel
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

  // Re-clamp on viewport resize so the panel never exceeds 60vw on a smaller screen
  useEffect(() => {
    function onResize() {
      setWidth((w) =>
        Math.max(MIN_WIDTH, Math.min(Math.round(window.innerWidth * MAX_WIDTH_FACTOR), w)),
      );
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <aside
      data-testid="place-detail"
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
        data-testid="place-detail-resize"
      />

      <header className="sticky top-0 bg-slate-950/95 backdrop-blur px-5 py-4 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold pr-4 truncate">{place.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {t(`places.kind.${place.kind}`)}
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
        {me && <SubscribeButton placeSlug={place.slug} />}
        <nav className="flex gap-1 mt-3">
          <TabBtn id="overview" active={tab === "overview"} onClick={() => setTab("overview")}>
            {t("place.tab.overview")}
          </TabBtn>
          <TabBtn id="chat" active={tab === "chat"} onClick={() => setTab("chat")}>
            {t("place.tab.chat")}
          </TabBtn>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto dark-scroll px-5 py-4">
        {tab === "overview" && <OverviewTab place={place} me={me} />}
        {tab === "chat" && <ChatTab place={place} me={me} />}
      </div>
    </aside>
  );
}

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
      data-testid={`place-tab-${id}`}
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

// ---- Overview tab (place info + presence panel inline) ----

function OverviewTab({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div>
        {place.address && <p className="text-xs text-slate-400 mb-2">{place.address}</p>}
        {place.description && (
          <p className="text-sm text-slate-300 mb-4 whitespace-pre-line">{place.description}</p>
        )}
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <Stat label={t("places.field.lat")} value={place.lat.toFixed(4)} />
          <Stat label={t("places.field.lon")} value={place.lon.toFixed(4)} />
          {place.elevation_m !== null && (
            <Stat
              label={t("places.field.elevation")}
              value={`${place.elevation_m} m`}
            />
          )}
        </dl>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <BortleDualBox
            label={t("place.bortle.boxManual")}
            value={place.bortle_class_manual}
            kind="manual"
          />
          <BortleDualBox
            label={t("place.bortle.boxMap")}
            value={place.bortle_class_map}
            kind="map"
            source={place.bortle_class_map_source}
            updatedAt={place.bortle_class_map_updated_at}
            place={place}
            me={me}
          />
        </div>
        <BortleHistorySection place={place} me={me} />
        {/* Weekly schedule (the structured definition) */}
        {place.opening_hours_schedule &&
          Object.keys(place.opening_hours_schedule).length > 0 && (
            <div className="mt-3">
              <OpeningHoursDisplay schedule={place.opening_hours_schedule} />
            </div>
          )}
        {/* Free-text opening hours — labelled "Doplňující text" in the
            form. Always shown when non-empty so it sits right under the
            weekly grid (e.g. "Po dohodě", reservation link, seasonal
            note). If there's no weekly grid at all, this text doubles
            as the only opening-hours info. */}
        {place.opening_hours && (
          <div className="mt-3 text-xs">
            <div className="text-slate-400 uppercase tracking-wide mb-1">
              {place.opening_hours_schedule &&
              Object.keys(place.opening_hours_schedule).length > 0
                ? t("places.field.openingHoursNote")
                : t("places.field.openingHours")}
            </div>
            <div className="text-slate-200 whitespace-pre-line">
              {place.opening_hours}
            </div>
          </div>
        )}
        {/* Validity window — shown only for temporary places where it
            actually has meaning; permanent observatories don't expire. */}
        {place.kind === "spot_temporary" &&
          (place.valid_from || place.valid_to) && (
            <div className="mt-3 text-xs">
              <div className="text-slate-400 uppercase tracking-wide mb-1">
                {t("places.field.validity")}
              </div>
              <div className="text-slate-200">
                {place.valid_from && new Date(place.valid_from).toLocaleString()}
                {place.valid_from && place.valid_to && " → "}
                {place.valid_to && new Date(place.valid_to).toLocaleString()}
              </div>
            </div>
          )}
        {place.contact && (
          <div className="mt-3 text-xs">
            <div className="text-slate-400 uppercase tracking-wide mb-1">
              {t("places.field.contact")}
            </div>
            <div className="text-slate-200 whitespace-pre-line break-words">
              {place.contact}
            </div>
          </div>
        )}
        <PlaceOwnerActions place={place} me={me} />
        {place.website && (
          <a
            href={place.website}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-4 text-xs text-indigo-300 hover:text-indigo-200 underline break-all"
          >
            {place.website}
          </a>
        )}
      </div>

      <div className="border-t border-slate-800 pt-4">
        <h4 className="text-sm font-medium text-slate-200 mb-2">
          {t("place.presence.title")}
        </h4>
        <PresencePanel place={place} me={me} />
      </div>
    </div>
  );
}

// ---- Presence panel (formerly its own tab) ----

function PresencePanel({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const pres = useQuery({
    queryKey: ["presence", place.slug],
    queryFn: () => presence.get(place.slug),
    refetchInterval: 10_000,
  });

  // Both mutations invalidate the *places* list too because
  // `active_checkin_count` is annotated on the Place row and drives
  // the marker's pulsing halo on the map. Without this the map marker
  // keeps pulsing for ~30 s (until next places refetch) after the
  // last check-in ends — confusing to users on the map view.
  const checkin = useMutation({
    mutationFn: (opts: { comment: string; anonymous: boolean }) =>
      presence.checkin(place.slug, { ...opts, expires_in_hours: 4 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presence", place.slug] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
  const end = useMutation({
    mutationFn: (id: string) => presence.end(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presence", place.slug] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });

  const [comment, setComment] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const ownEmail = me?.user.email.toLowerCase() ?? "";
  const ownActive = pres.data?.checkins.find(
    (c) => c.user_email && c.user_email.toLowerCase() === ownEmail,
  );

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">
        {t("place.presence.activeCount", { count: pres.data?.count ?? 0 })}
      </p>
      <ul className="space-y-2 mb-4">
        {pres.data?.checkins.map((c) => (
          <li key={c.id} className="bg-slate-900 ring-1 ring-slate-800 rounded-md px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p>
                  <span className="text-emerald-400">●</span>{" "}
                  <UserNameLink
                    email={c.user_email}
                    displayName={c.display_name}
                    className="text-slate-200 font-semibold"
                    testid={`checkin-author-${c.id}`}
                  />
                </p>
                {c.comment && <p className="text-slate-400 mt-0.5">{c.comment}</p>}
                <p className="text-slate-500 mt-0.5 font-mono">
                  ↓ {new Date(c.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              {c.user_email && c.user_email.toLowerCase() === ownEmail && (
                <button
                  type="button"
                  onClick={() => end.mutate(c.id)}
                  className="text-xs text-rose-400 hover:text-rose-300"
                >
                  {t("place.presence.endMine")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {me && !ownActive && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            checkin.mutate({ comment, anonymous });
          }}
          className="space-y-2"
        >
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("place.presence.commentPlaceholder")}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 outline-none text-xs"
          />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            <span>{t("place.presence.anonymous")}</span>
          </label>
          <button
            type="submit"
            disabled={checkin.isPending}
            data-testid="place-checkin-submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-xs px-3 py-1.5 rounded-md transition"
          >
            {checkin.isPending ? "…" : t("place.presence.checkIn")}
          </button>
        </form>
      )}

      {!me && (
        <p className="text-xs text-slate-500 text-center">{t("place.presence.loginToCheckin")}</p>
      )}
    </div>
  );
}


// ---- Chat tab — delegates to the shared ThreadedDiscussion component
// so it stays in lockstep with the article comments thread. ----

function ChatTab({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  // Discussion is members-only — anon must log in even to READ. We
  // skip the query for anon (saves API roundtrip + matches backend 401)
  // and render a login CTA instead.
  const messages = useQuery({
    queryKey: ["chat", place.slug],
    queryFn: () => chat.list(place.slug),
    refetchInterval: 3_000,
    enabled: !!me,
  });

  if (!me) {
    return (
      <div
        className="h-full min-h-[20rem] flex flex-col items-center justify-center text-center px-6 py-10 bg-slate-950/40 ring-1 ring-slate-800 rounded-md"
        data-testid="chat-anon-gate"
      >
        <p className="text-3xl mb-3" aria-hidden>🔒</p>
        <p className="text-sm text-slate-300 mb-1">
          {t("place.chat.loginToView")}
        </p>
        <p className="text-xs text-slate-500 max-w-xs">
          {t("place.chat.loginToViewHint")}
        </p>
      </div>
    );
  }

  return (
    <ThreadedDiscussion
      items={messages.data?.items ?? []}
      me={me}
      queryKey={["chat", place.slug]}
      onPost={(body) => chat.post(place.slug, body)}
      onDelete={(id) => chat.remove(id)}
      emptyLabel={t("place.chat.empty")}
      testidPrefix="chat"
      entityTimezone={place.timezone}
    />
  );
}

// ---- Subscribe button (top of panel) ----

function SubscribeButton({ placeSlug }: { placeSlug: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: ["subscriptions"], queryFn: subscriptions.list });
  const existing = all.data?.find(
    (s: Subscription) => s.kind === "place" && s.target_id === placeSlug,
  );

  const subscribe = useMutation({
    mutationFn: () => subscriptions.create(placeSlug, "place"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });
  const unsubscribe = useMutation({
    mutationFn: (id: string) => subscriptions.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  if (existing) {
    return (
      <button
        type="button"
        onClick={() => unsubscribe.mutate(existing.id)}
        className="mt-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-md ring-1 ring-slate-700 transition"
      >
        ✓ {t("place.subscribed")} — {t("place.unsubscribe")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => subscribe.mutate()}
      data-testid="place-subscribe"
      className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-md transition"
    >
      🔔 {t("place.subscribe")}
    </button>
  );
}

// ---- Bortle history (table + add-manual form) ----

function BortleHistorySection({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const history = useQuery({
    queryKey: ["bortle-history", place.slug],
    queryFn: () => placesApi.bortleHistory(place.slug),
    enabled: open,
  });
  const items = history.data?.items ?? [];

  return (
    <div className="mt-2 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-slate-400 hover:text-slate-200"
        data-testid="bortle-history-toggle"
      >
        {open ? "▾" : "▸"} {t("place.bortle.history.title")}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {history.isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
          {items.length === 0 && !history.isLoading && (
            <p className="text-slate-500">{t("place.bortle.history.empty")}</p>
          )}
          {items.map((h) => (
            <BortleHistoryRow key={h.id} item={h} />
          ))}
          {me && !formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
              data-testid="bortle-add-manual"
            >
              + {t("place.bortle.history.addManual")}
            </button>
          )}
          {formOpen && me && (
            <AddBortleManualForm
              placeSlug={place.slug}
              onDone={() => {
                setFormOpen(false);
                qc.invalidateQueries({ queryKey: ["bortle-history", place.slug] });
                qc.invalidateQueries({ queryKey: ["places"] });
              }}
              onCancel={() => setFormOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BortleHistoryRow({ item }: { item: BortleHistoryItem }) {
  const { t } = useTranslation();
  const sourceLabel = t(`place.bortle.history.source.${item.source}`);
  const isAuto = item.source !== "manual";
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-slate-100">{item.value.toFixed(1)}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${
            isAuto
              ? "bg-slate-800 ring-slate-700 text-slate-400"
              : "bg-indigo-900/40 ring-indigo-700/40 text-indigo-200"
          }`}
        >
          {sourceLabel}
        </span>
        <span className="text-slate-500 font-mono ml-auto">
          {new Date(item.measured_at).toLocaleDateString()}
        </span>
      </div>
      {item.notes && <p className="text-slate-400 mt-0.5">{item.notes}</p>}
      {item.submitted_by_email && !isAuto && (
        <p className="text-slate-500 mt-0.5 text-[10px]">
          <UserNameLink
            email={item.submitted_by_email}
            displayName={item.submitted_by_email}
            className="text-slate-500"
            testid={`bortle-author-${item.id}`}
          />
        </p>
      )}
    </div>
  );
}

function AddBortleManualForm({
  placeSlug,
  onDone,
  onCancel,
}: {
  placeSlug: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>("4");
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      placesApi.addBortleManual(placeSlug, {
        value: Number(value),
        notes,
      }),
    onSuccess: onDone,
  });
  return (
    <form
      className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2 space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(value);
        if (Number.isFinite(v) && v >= 1 && v <= 9) mut.mutate();
      }}
    >
      <label className="flex items-center gap-2">
        <span className="text-slate-400 w-14">{t("place.bortle.history.valueLabel")}</span>
        <input
          type="number"
          min="1"
          max="9"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-0.5 text-slate-100 font-mono"
        />
      </label>
      <textarea
        placeholder={t("place.bortle.history.notesPlaceholder")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1 text-slate-100 resize-y dark-scroll"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={mut.isPending}
          className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
        >
          {mut.isPending ? "…" : t("place.bortle.history.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded-md ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800"
        >
          {t("common.cancel")}
        </button>
      </div>
      {mut.isError && (
        <p className="text-rose-400">{(mut.error as Error)?.message}</p>
      )}
    </form>
  );
}

// ---- Owner / admin actions: edit + delete this place ----

function PlaceOwnerActions({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwner = !!me && me.user.email.toLowerCase() === (place.owner_email || "").toLowerCase();
  const isAdmin = !!me && me.user.is_staff;
  const canEdit = isOwner || isAdmin;

  const del = useMutation({
    mutationFn: () => placesApi.remove(place.slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["places"] });
      // After delete the panel will refer to a non-existent place; signal
      // upward via a custom event so MapView can close the detail panel.
      window.dispatchEvent(new CustomEvent("astrozor:place-deleted", { detail: { slug: place.slug } }));
    },
  });

  if (!canEdit || !me) return null;

  return (
    <>
      <div className="mt-3 flex gap-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
          data-testid="place-edit"
        >
          ✎ {t("place.actions.edit")}
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="px-2 py-1 rounded-md ring-1 ring-rose-900/60 hover:bg-rose-950/40 text-rose-300"
          data-testid="place-delete"
        >
          ✕ {t("place.actions.delete")}
        </button>
        {!isOwner && isAdmin && place.owner_email && (
          <span className="text-slate-500 ml-1 self-center">
            ({t("place.actions.owner")}:{" "}
            <UserNameLink
              email={place.owner_email}
              displayName={place.owner_email}
              className="text-slate-400"
              testid="place-owner-link"
            />
            )
          </span>
        )}
      </div>

      {confirmDelete && (
        <div className="mt-2 bg-rose-950/40 ring-1 ring-rose-900/60 rounded-md p-2 text-xs">
          <p className="text-rose-200 mb-2">
            {t("place.actions.confirmDelete", { name: place.name })}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white"
              data-testid="place-delete-confirm"
            >
              {del.isPending ? "…" : t("place.actions.deleteYes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 rounded ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {t("common.cancel")}
            </button>
          </div>
          {del.isError && (
            <p className="mt-1 text-rose-300">{(del.error as Error)?.message}</p>
          )}
        </div>
      )}

      {editing && (
        <PlaceFormModalLazy
          mode="edit"
          initial={place}
          me={me}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  );
}

// Lazy-import to avoid a circular import with MapView via shared types
import { PlaceFormModal as PlaceFormModalLazy } from "./PlaceFormModal";
import { ThreadedDiscussion } from "./ThreadedDiscussion";
import { OpeningHoursDisplay } from "./OpeningHoursEditor";
import { UserNameLink } from "./UserNameLink";



// ---- Dual Bortle boxes: manual + from-map ----

function BortleDualBox({
  label,
  value,
  kind,
  source,
  updatedAt,
  place,
  me,
}: {
  label: string;
  value: number | null;
  kind: "manual" | "map";
  source?: string;
  updatedAt?: string | null;
  place?: Place;
  me?: Me | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  function toggleTooltip(e: React.MouseEvent) {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) setCoords({ left: r.left + r.width / 2, top: r.top });
    setOpen((v) => !v);
  }

  // Close the tooltip when clicking outside / pressing Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("click", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const refresh = useMutation({
    mutationFn: () => placesApi.estimateBortleForPlace(place!.slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["places"] });
      qc.invalidateQueries({ queryKey: ["bortle-history", place?.slug] });
    },
  });

  // PlaceDetailPanel receives `place` as a snapshot from MapView's
  // `selected` state — invalidating ["places"] in the cache won't
  // refresh this prop. Show the fresh value from the mutation response
  // immediately so the user sees the click landed.
  const effectiveValue =
    kind === "map" && refresh.data?.bortle_class_map != null
      ? refresh.data.bortle_class_map
      : value;
  const effectiveSource =
    kind === "map" && refresh.data?.bortle_class_map_source
      ? refresh.data.bortle_class_map_source
      : source;
  const effectiveUpdatedAt =
    kind === "map" && refresh.data?.bortle_class_map_updated_at
      ? refresh.data.bortle_class_map_updated_at
      : updatedAt;

  const sourceLabel =
    effectiveSource === "viirs_dnb_latest"
      ? "VIIRS DNB"
      : effectiveSource === "viirs_black_marble"
        ? "Black Marble"
        : "";

  return (
    <div
      className="bg-slate-900/80 ring-1 ring-slate-800 rounded-md p-2"
      data-testid={`bortle-${kind}`}
    >
      <dt className="text-[10px] uppercase text-slate-500 tracking-wide flex items-center gap-1">
        <span>{label}</span>
        {effectiveValue !== null && effectiveValue !== undefined && (
          <button
            ref={ref}
            type="button"
            onClick={toggleTooltip}
            aria-label="info"
            aria-expanded={open}
            data-testid={`bortle-${kind}-info`}
            className={`ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold leading-none transition ${
              open
                ? "bg-indigo-500 text-white"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            i
          </button>
        )}
      </dt>
      <dd className="mt-0.5 font-mono text-slate-200 text-base">
        {effectiveValue !== null && effectiveValue !== undefined ? (
          effectiveValue.toFixed(1)
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </dd>
      {kind === "map" && (sourceLabel || effectiveUpdatedAt) && (
        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
          {sourceLabel}
          {effectiveUpdatedAt && ` · ${new Date(effectiveUpdatedAt).toLocaleDateString()}`}
        </p>
      )}
      {kind === "map" && me && place && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            refresh.mutate();
          }}
          disabled={refresh.isPending}
          className="mt-1 text-[10px] px-1.5 py-0.5 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-50"
          data-testid="bortle-map-refresh"
        >
          {refresh.isPending ? "…" : t("place.bortle.refreshFromMap")}
        </button>
      )}
      {refresh.isError && (
        <p className="text-[10px] text-rose-400 mt-0.5">
          {(refresh.error as Error)?.message?.slice(0, 80) || "failed"}
        </p>
      )}
      {open && effectiveValue !== null && effectiveValue !== undefined && (
        <BortleTooltip anchor={coords} value={effectiveValue} />
      )}
    </div>
  );
}

// ---- Legacy single Bortle stat box (still used elsewhere if needed) ----

type BortleRow = { kind: string; desc: string };

// @ts-expect-error keep for potential future use (single-value rendering)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _BortleStatLegacy({ value }: { value: number }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  function recompute() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setCoords({ left: r.left + r.width / 2, top: r.top });
  }
  function show() {
    recompute();
    setOpen(true);
  }
  function hide() {
    setOpen(false);
  }

  return (
    <div
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      role="button"
      aria-describedby={open ? "bortle-tooltip" : undefined}
      className="bg-slate-900/80 ring-1 ring-slate-800 rounded-md p-2 cursor-help focus:outline-none focus:ring-1 focus:ring-indigo-500"
      data-testid="bortle-stat"
    >
      <dt className="text-[10px] uppercase text-slate-500 tracking-wide">
        {t("places.field.bortle")}{" "}
        <span className="text-slate-400" aria-hidden="true">ⓘ</span>
      </dt>
      <dd className="mt-0.5 font-mono text-slate-200">{value.toFixed(1)}</dd>
      {open && <BortleTooltip anchor={coords} value={value} />}
    </div>
  );
}

function BortleTooltip({
  anchor,
  value,
}: {
  anchor: { left: number; top: number };
  value: number;
}) {
  const { t } = useTranslation();
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: -9999,
    top: -9999,
  });
  const rows = (t("place.bortle.rows", { returnObjects: true }) as BortleRow[]) || [];
  const cur = Math.round(value);

  // Measure once visible, place above the anchor if there's room, else below.
  // Clamp horizontally to viewport with 8px margin.
  useLayoutEffect(() => {
    const r = tipRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    let top = anchor.top - r.height - margin;
    if (top < margin) {
      // anchor "top" was box.top; place tooltip below the box instead
      top = anchor.top + margin;
    }
    let left = anchor.left - r.width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - r.width - margin, left));
    setPos({ left, top });
  }, [anchor.left, anchor.top]);

  return createPortal(
    <div
      ref={tipRef}
      id="bortle-tooltip"
      role="tooltip"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[60] w-[22rem] max-w-[92vw] bg-slate-900 ring-1 ring-slate-700 rounded-md shadow-xl p-3 pointer-events-none"
      data-testid="bortle-tooltip"
    >
      <h5 className="text-xs font-semibold text-slate-100">{t("place.bortle.title")}</h5>
      <p className="text-[10px] text-slate-400 mt-0.5 mb-2">
        {t("place.bortle.subtitle")}
      </p>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="text-slate-500 border-b border-slate-800">
            <th className="text-left pr-2 py-0.5 font-medium">
              {t("place.bortle.col.class")}
            </th>
            <th className="text-left pr-2 py-0.5 font-medium">
              {t("place.bortle.col.kind")}
            </th>
            <th className="text-left py-0.5 font-medium">
              {t("place.bortle.col.what")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const cls = i + 1;
            const active = cls === cur;
            return (
              <tr
                key={cls}
                className={`align-top ${
                  active
                    ? "bg-indigo-950/80 text-slate-100 ring-1 ring-indigo-700/50"
                    : "text-slate-300"
                }`}
              >
                <td className="font-mono pr-2 py-0.5">{cls}</td>
                <td className="pr-2 py-0.5">{row.kind}</td>
                <td className="py-0.5">{row.desc}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/80 ring-1 ring-slate-800 rounded-md p-2">
      <dt className="text-[10px] uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className="mt-0.5 font-mono text-slate-200">{value}</dd>
    </div>
  );
}
