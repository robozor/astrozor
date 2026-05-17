import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { events, type Event, type Me } from "../lib/api";

type View = { kind: "list" } | { kind: "detail"; slug: string } | { kind: "new" };

export function EventsPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "detail") {
    return <EventDetail slug={view.slug} me={me} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "new") {
    return (
      <EventEditor
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }
  return (
    <EventList
      onOpen={(slug) => setView({ kind: "detail", slug })}
      onNew={() => setView({ kind: "new" })}
    />
  );
}

const STATUS_COLOR: Record<Event["status"], string> = {
  draft: "text-slate-500",
  planned: "text-sky-400",
  registration_open: "text-emerald-400",
  registration_closed: "text-amber-400",
  happening: "text-fuchsia-400",
  done: "text-slate-500",
  cancelled: "text-rose-400",
};

function EventList({ onOpen, onNew }: { onOpen: (slug: string) => void; onNew: () => void }) {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ["events"], queryFn: () => events.list() });

  return (
    <section data-testid="events-list">
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("events.title")}</h2>
        <button
          type="button"
          onClick={onNew}
          data-testid="event-new"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
        >
          {t("events.new")}
        </button>
      </header>

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && list.data.length === 0 && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("events.empty")}</p>
        </div>
      )}

      <ul className="space-y-3">
        {list.data?.map((e) => (
          <li
            key={e.id}
            className="bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-700 rounded-xl p-4 cursor-pointer transition"
            onClick={() => onOpen(e.slug)}
            data-testid={`event-card-${e.slug}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-slate-100 truncate">{e.title}</h3>
                <p className="text-xs text-slate-500">
                  {new Date(e.starts_at).toLocaleString()}
                  {e.place_slug && ` · ${e.place_slug}`}
                </p>
              </div>
              <div className="text-xs flex flex-col items-end gap-1 shrink-0">
                <span className={`font-mono ${STATUS_COLOR[e.status]}`}>{e.status}</span>
                <span className="text-slate-500">
                  {e.registration_count}
                  {e.capacity > 0 ? ` / ${e.capacity}` : ""} {t("events.attendees")}
                </span>
              </div>
            </div>
            {e.description && (
              <p className="text-sm text-slate-400 mt-2 line-clamp-2">{e.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventDetail({ slug, me, onBack }: { slug: string; me: Me; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ["event", slug], queryFn: () => events.get(slug) });

  const isOrganizer = event.data?.organizer_email === me.user.email;

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

  return (
    <section data-testid="event-detail">
      <button
        type="button"
        onClick={onBack}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.back")}
      </button>

      {event.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {event.isSuccess && (
        <article className="space-y-4">
          <header>
            <h2 className="text-2xl font-semibold text-slate-100">{event.data.title}</h2>
            <p className="text-xs text-slate-500 mt-1">
              <span className={`font-mono ${STATUS_COLOR[event.data.status]}`}>
                {event.data.status}
              </span>
              {" · "}
              {new Date(event.data.starts_at).toLocaleString()}
              {event.data.ends_at && ` — ${new Date(event.data.ends_at).toLocaleString()}`}
              {event.data.place_slug && ` · ${event.data.place_slug}`}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t("events.organizer")}: {event.data.organizer_email}
            </p>
          </header>

          {event.data.description && (
            <p className="text-slate-300 whitespace-pre-wrap">{event.data.description}</p>
          )}

          <div className="text-xs text-slate-400">
            {event.data.registration_count}
            {event.data.capacity > 0 ? ` / ${event.data.capacity}` : ""}{" "}
            {t("events.attendees")}
          </div>

          {!isOrganizer && event.data.status === "registration_open" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => register.mutate()}
                disabled={register.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition"
                data-testid="event-register"
              >
                {register.isPending ? "…" : t("events.register")}
              </button>
              <button
                type="button"
                onClick={() => cancel.mutate()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm px-4 py-2 rounded-md transition"
              >
                {t("events.cancelRegistration")}
              </button>
            </div>
          )}

          <a
            href={events.icalUrl(slug)}
            className="inline-block text-xs text-slate-400 hover:text-slate-200"
          >
            📅 {t("events.downloadIcal")}
          </a>

          {isOrganizer && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3">
              <h3 className="text-sm font-medium text-slate-200 mb-2">
                {t("events.organizerActions")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "planned",
                    "registration_open",
                    "registration_closed",
                    "happening",
                    "done",
                    "cancelled",
                  ] as Event["status"][]
                ).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => transition.mutate(s)}
                    disabled={transition.isPending || s === event.data.status}
                    className={`text-xs px-2 py-1 rounded-md transition ring-1 ${
                      s === event.data.status
                        ? "bg-slate-800 text-slate-500 ring-slate-800"
                        : "bg-slate-900 ring-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    → {s}
                  </button>
                ))}
              </div>
              {transition.error && (
                <p className="text-xs text-rose-400 mt-2">
                  {(transition.error as Error).message}
                </p>
              )}
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function EventEditor({
  onDone,
  onCancel,
}: {
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("meetup");
  const [placeSlug, setPlaceSlug] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      events.create({
        title,
        description,
        kind,
        place_slug: placeSlug || undefined,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
        capacity,
      }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      onDone(e.slug);
    },
  });

  return (
    <section data-testid="event-editor">
      <button
        type="button"
        onClick={onCancel}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.cancel")}
      </button>
      <h2 className="text-xl font-semibold mb-4">{t("events.new")}</h2>
      <form
        className="space-y-3 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && startsAt) create.mutate();
        }}
      >
        <Input
          label={t("events.field.title")}
          value={title}
          onChange={setTitle}
          required
          testId="event-title"
        />
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("events.field.description")}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">{t("events.field.kind")}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          >
            <option value="meetup">meetup</option>
            <option value="observation_night">observation_night</option>
            <option value="lecture">lecture</option>
            <option value="workshop">workshop</option>
            <option value="campaign">campaign</option>
          </select>
        </label>
        <Input
          label={t("events.field.placeSlug")}
          value={placeSlug}
          onChange={setPlaceSlug}
          placeholder="e.g. observatory-petrin"
        />
        <Input
          label={t("events.field.startsAt")}
          value={startsAt}
          onChange={setStartsAt}
          type="datetime-local"
          required
          testId="event-starts"
        />
        <Input
          label={t("events.field.endsAt")}
          value={endsAt}
          onChange={setEndsAt}
          type="datetime-local"
        />
        <Input
          label={t("events.field.capacity")}
          value={String(capacity)}
          onChange={(v) => setCapacity(parseInt(v) || 0)}
          type="number"
        />
        {create.error && (
          <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
            {(create.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending || !title.trim() || !startsAt}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
          data-testid="event-create"
        >
          {create.isPending ? "…" : t("events.create")}
        </button>
      </form>
    </section>
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
