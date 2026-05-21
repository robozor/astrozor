import type { Event } from "../lib/api";

const STATUS_LABEL_CS: Record<string, string> = {
  draft: "návrh",
  announced: "ohlášeno",
  registration_open: "registrace",
  registration_closed: "zapsáno",
  in_progress: "probíhá",
};

/**
 * Map marker for an Event — plain pin emoji. The event title and
 * status are exposed only via the native hover tooltip (title attr)
 * so the map stays uncluttered. Click opens the side panel.
 */
export function EventMarker({
  event,
  onClick,
}: {
  event: Event;
  onClick: () => void;
}) {
  const statusLabel = STATUS_LABEL_CS[event.status] ?? event.status;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      data-testid={`event-marker-${event.slug}`}
      className="cursor-pointer select-none -translate-y-1/2 text-2xl leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
      title={`${event.title} — ${statusLabel}`}
      aria-label={`${event.title} (${statusLabel})`}
    >
      📍
    </button>
  );
}
