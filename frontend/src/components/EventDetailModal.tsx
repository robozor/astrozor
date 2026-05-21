import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { events, type Event } from "../lib/api";
import { UserNameLink } from "./UserNameLink";

/**
 * Read-only modal for an Event. Opens from the map when a user clicks
 * an event marker. Intentionally minimal: title, status, when, where,
 * organizer, description, capacity. No edit / register actions — for
 * those the user navigates to the Events agenda.
 */
export function EventDetailModal({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["event", slug],
    queryFn: () => events.get(slug),
    staleTime: 30_000,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-xl w-full max-w-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="font-medium text-slate-100">{t("events.title")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>
        <div className="p-4">
          {q.isLoading && (
            <p className="text-slate-400 text-sm">{t("common.loading")}</p>
          )}
          {q.data && <Body event={q.data} />}
        </div>
      </div>
    </div>
  );
}

function Body({ event }: { event: Event }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-100">{event.title}</h2>
      <p className="text-xs text-slate-500">
        <span className="font-mono">{event.status}</span>
        {" · "}
        {new Date(event.starts_at).toLocaleString()}
        {event.ends_at && ` — ${new Date(event.ends_at).toLocaleString()}`}
      </p>
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
      {(event.place_name || event.external_address) && (
        <p className="text-sm text-slate-300">
          📍 {event.place_name || event.external_address}
        </p>
      )}
      {!event.place_name &&
        !event.external_address &&
        event.external_lat !== null &&
        event.external_lon !== null && (
          <p className="text-sm text-slate-300 font-mono">
            📍 {event.external_lat.toFixed(4)},{" "}
            {event.external_lon.toFixed(4)}
          </p>
        )}
      {event.description && (
        <p className="text-sm text-slate-300 whitespace-pre-line">
          {event.description}
        </p>
      )}
      {event.capacity > 0 && (
        <p className="text-xs text-slate-500">
          {event.registration_count} / {event.capacity}{" "}
          {t("events.attendees")}
        </p>
      )}
    </div>
  );
}
