import type { Place } from "../lib/api";

/**
 * Map marker for a Place.
 *
 * Three visual dimensions:
 *  1. Kind: observatory (dome SVG) vs spot (location pin SVG).
 *  2. Active: someone is currently checked-in here → colored + pulse halo.
 *     Inactive: faded gray.
 *  3. Subscribed: star badge in top-right corner.
 *
 * The marker is positioned by parent <Marker> (react-map-gl), this component
 * only paints the visual.
 */

type Props = {
  kind: Place["kind"];
  active: boolean;
  subscribed: boolean;
  testid?: string;
  ariaLabel?: string;
};

const KIND_COLOR: Record<Place["kind"], string> = {
  observatory_public: "#22d3ee", // cyan
  observatory_private: "#a78bfa", // purple
  spot_permanent: "#fbbf24", // amber
  spot_temporary: "#f472b6", // pink
};

export function MapMarker({ kind, active, subscribed, testid, ariaLabel }: Props) {
  const color = active ? KIND_COLOR[kind] : "#475569"; // slate-600 when inactive
  const isObservatory = kind.startsWith("observatory");

  return (
    <div
      data-testid={testid}
      role="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      className="relative cursor-pointer select-none"
      style={{ width: 32, height: 36 }}
    >
      {/* Pulse halo for active places — Tailwind animate-ping with low opacity */}
      {active && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: color, opacity: 0.35 }}
        />
      )}

      {/* Body — circle with kind-specific icon */}
      <div
        className="absolute inset-0 flex items-center justify-center rounded-full ring-2 shadow-lg"
        style={{
          background: active ? color : "#1e293b",
          borderColor: active ? color : "#475569",
          color: active ? "#0b1020" : "#94a3b8",
          width: 32,
          height: 32,
          top: 0,
          left: 0,
        }}
      >
        {isObservatory ? <ObservatoryIcon /> : <SpotIcon />}
      </div>

      {/* Star badge — top right, only when subscribed */}
      {subscribed && (
        <span
          data-testid="marker-subscribed-badge"
          className="absolute -top-1 -right-1 bg-amber-400 ring-2 ring-slate-950 rounded-full flex items-center justify-center"
          style={{ width: 14, height: 14 }}
          aria-label="Subscribed"
          title="Sledováno"
        >
          <StarIcon />
        </span>
      )}
    </div>
  );
}

function ObservatoryIcon() {
  // Simple observatory dome silhouette
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 19h18v2H3v-2zm2-4a7 7 0 0 1 14 0v3H5v-3zm6.5-7.5v-3a1.5 1.5 0 0 1 3 0v3a3.5 3.5 0 0 1-3 0z" />
    </svg>
  );
}

function SpotIcon() {
  // Location pin
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="#0b1020" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
