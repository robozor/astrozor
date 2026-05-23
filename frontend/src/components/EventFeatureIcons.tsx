import type { Event } from "../lib/api";

/**
 * A row of 4 small feature icons that show at a glance which channels
 * an event has configured: video meeting (Jitsi/Zoom/…), Discord chat,
 * geocaching cache code, and a radio frequency.
 *
 * Lit (full color / opacity) = the field is set on the event.
 * Dimmed (gray) = empty — feature isn't available for this event.
 *
 * Hover shows the value as a tooltip; lit icons may optionally render
 * as <a> when an `interactive` prop is passed (used in EventDetail's
 * action chip row).
 */
export function EventFeatureIcons({
  event,
  interactive = false,
  size = "sm",
  className = "",
}: {
  event: Pick<Event, "meeting_url" | "discord_url" | "geocache_url" | "radio_frequency">;
  /** When true, lit icons become clickable links opening their URL. */
  interactive?: boolean;
  /** sm = 18px button, md = 28px button. */
  size?: "sm" | "md";
  className?: string;
}) {
  // Active = colored background tinted by feature kind so the lit
  // state reads as "branded chip", not just "slightly less dim emoji".
  // The dim state uses heavy filter to push the emoji nearly invisible.
  const features: Array<{
    key: string;
    label: string;
    icon: string;
    value: string;
    href?: string | undefined;
    /** Background classes applied when the feature is set. */
    activeBg: string;
  }> = [
    {
      key: "meeting",
      label: "Online meeting",
      icon: "🎥",
      value: event.meeting_url,
      href: event.meeting_url || undefined,
      activeBg: "bg-emerald-600/30 ring-1 ring-emerald-500/60",
    },
    {
      key: "discord",
      label: "Discord chat",
      icon: "💬",
      value: event.discord_url,
      href: event.discord_url || undefined,
      activeBg: "bg-indigo-600/30 ring-1 ring-indigo-500/60",
    },
    {
      key: "geocache",
      label: "Geocaching",
      icon: "🧭",
      value: event.geocache_url,
      href: event.geocache_url
        ? /^GC[0-9A-Z]+$/i.test(event.geocache_url.trim())
          ? `https://www.geocaching.com/geocache/${event.geocache_url.trim()}`
          : event.geocache_url
        : undefined,
      activeBg: "bg-green-700/30 ring-1 ring-green-500/60",
    },
    {
      key: "radio",
      label: "Vysílačka",
      icon: "📻",
      value: event.radio_frequency,
      href: undefined,
      activeBg: "bg-amber-600/30 ring-1 ring-amber-500/60",
    },
  ];

  const cellSize = size === "md" ? "w-7 h-7 text-base" : "w-6 h-6 text-sm";

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      data-testid="event-feature-icons"
    >
      {features.map((f) => {
        const active = !!f.value;
        const tooltip = active ? `${f.label}: ${f.value}` : `${f.label} (nenastaveno)`;
        // Active: tinted ring + full opacity. Inactive: nearly invisible
        // — grayscale + 20% opacity + dashed outline ring so it reads
        // as "slot that COULD be filled" rather than "is off".
        const stateClasses = active
          ? `${f.activeBg} opacity-100`
          : "opacity-20 grayscale ring-1 ring-dashed ring-slate-800";
        const base = `inline-flex items-center justify-center rounded ${cellSize} leading-none transition ${stateClasses}`;
        if (active && interactive && f.href) {
          return (
            <a
              key={f.key}
              href={f.href}
              target="_blank"
              rel="noopener noreferrer"
              title={tooltip}
              onClick={(e) => e.stopPropagation()}
              className={`${base} hover:brightness-125`}
              data-testid={`event-feature-${f.key}`}
              aria-label={tooltip}
            >
              {f.icon}
            </a>
          );
        }
        return (
          <span
            key={f.key}
            title={tooltip}
            aria-label={tooltip}
            className={base}
            data-testid={`event-feature-${f.key}`}
          >
            {f.icon}
          </span>
        );
      })}
    </div>
  );
}
