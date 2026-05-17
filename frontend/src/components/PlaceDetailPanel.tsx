import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  chat,
  presence,
  subscriptions,
  type Place,
  type Me,
  type Subscription,
} from "../lib/api";

type Tab = "overview" | "chat" | "presence";

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

  return (
    <aside
      data-testid="place-detail"
      className="absolute top-0 right-0 bottom-0 w-full sm:w-96 bg-slate-950/95 ring-1 ring-slate-800 backdrop-blur overflow-y-auto z-10"
    >
      <header className="sticky top-0 bg-slate-950/95 backdrop-blur ring-b ring-slate-800 px-5 py-4 border-b border-slate-800">
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
          <TabBtn id="presence" active={tab === "presence"} onClick={() => setTab("presence")}>
            {t("place.tab.presence")}
          </TabBtn>
        </nav>
      </header>

      <div className="px-5 py-4">
        {tab === "overview" && <OverviewTab place={place} />}
        {tab === "chat" && <ChatTab place={place} me={me} />}
        {tab === "presence" && <PresenceTab place={place} me={me} />}
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

// ---- Overview tab ----

function OverviewTab({ place }: { place: Place }) {
  const { t } = useTranslation();
  return (
    <div>
      {place.address && <p className="text-xs text-slate-400 mb-2">{place.address}</p>}
      {place.description && (
        <p className="text-sm text-slate-300 mb-4">{place.description}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Stat label={t("places.field.lat")} value={place.lat.toFixed(4)} />
        <Stat label={t("places.field.lon")} value={place.lon.toFixed(4)} />
        {place.elevation_m !== null && (
          <Stat label={t("places.field.elevation")} value={`${place.elevation_m} m`} />
        )}
        {place.bortle_class !== null && (
          <Stat label={t("places.field.bortle")} value={place.bortle_class.toFixed(1)} />
        )}
      </dl>
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
  );
}

// ---- Chat tab ----

function ChatTab({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const messages = useQuery({
    queryKey: ["chat", place.slug],
    queryFn: () => chat.list(place.slug),
    refetchInterval: 3_000,
  });

  const post = useMutation({
    mutationFn: () => chat.post(place.slug, text),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["chat", place.slug] });
    },
  });

  return (
    <div className="flex flex-col h-[55vh]">
      <ul className="flex-1 overflow-y-auto space-y-2 pr-1">
        {messages.data?.items.length === 0 && (
          <li className="text-xs text-slate-500 text-center py-8">{t("place.chat.empty")}</li>
        )}
        {messages.data?.items.map((m) => (
          <li key={m.id} className="text-xs">
            <p className="text-slate-500 mb-0.5">
              <strong className="text-slate-300">{m.user_display_name}</strong>{" · "}
              <span className="font-mono">
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>
            <p
              className="text-slate-200 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: m.text }}
            />
          </li>
        ))}
      </ul>

      {me ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) post.mutate();
          }}
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("place.chat.placeholder")}
            className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 outline-none text-xs"
          />
          <button
            type="submit"
            disabled={!text.trim() || post.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-xs px-3 py-1.5 rounded-md transition"
          >
            {post.isPending ? "…" : "→"}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-500 text-center">{t("place.chat.loginToPost")}</p>
      )}
    </div>
  );
}

// ---- Presence tab ----

function PresenceTab({ place, me }: { place: Place; me: Me | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const pres = useQuery({
    queryKey: ["presence", place.slug],
    queryFn: () => presence.get(place.slug),
    refetchInterval: 10_000,
  });

  const checkin = useMutation({
    mutationFn: (opts: { comment: string; anonymous: boolean }) =>
      presence.checkin(place.slug, { ...opts, expires_in_hours: 4 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presence", place.slug] }),
  });
  const end = useMutation({
    mutationFn: (id: string) => presence.end(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presence", place.slug] }),
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
                  <strong className="text-slate-200">{c.display_name}</strong>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/80 ring-1 ring-slate-800 rounded-md p-2">
      <dt className="text-[10px] uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className="mt-0.5 font-mono text-slate-200">{value}</dd>
    </div>
  );
}
