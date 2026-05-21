import type { Place } from "../lib/api";

/**
 * Map marker for a Place.
 *
 * The four place kinds now use four visually distinct silhouettes so
 * users can scan the map and pick out kinds at a glance — no more
 * "every observatory is a dome circle" problem:
 *
 *   observatory_public  → wide arched DOME with a vertical aperture slit
 *   observatory_private → boxy BUILDING with a peaked roof + small lock
 *   spot_permanent      → 5-pointed STAR (classic astronomy)
 *   spot_temporary      → narrow pointed TENT / mountain triangle
 *
 * Container size dropped from 32 px to 22 px (≈70 % per user request)
 * so markers don't crowd the map at mid-zoom levels. The pulse halo
 * for active places (someone checked in here) remains the same — it
 * extends slightly beyond the body so it's visible at the smaller size.
 */

type Props = {
  kind: Place["kind"];
  active: boolean;
  subscribed: boolean;
  testid?: string;
  ariaLabel?: string;
};

// Marker palette — kind is communicated by SHAPE; color only signals
// activity (someone checked in here right now). Default is near-white/
// near-black neutral. Active is pastel green for the body PLUS a
// saturated red pulse halo — green alone gets lost on OSM vegetation,
// so the red animation ring rides on top for visibility while the
// marker body keeps the calm pastel green semantics.
const COLORS = {
  inactiveBg: "#e2e8f0", // slate-200 (near-white)
  inactiveShape: "#1e293b", // slate-800 (near-black)
  inactiveRing: "#cbd5e1", // slate-300 — thin outline
  // Active = at least one check-in. Pastel BLUE (not green) so the
  // marker pops on the OSM/PMTiles base map which is dominated by
  // green landuse/forest tiles. The pulsing red halo around the
  // marker still carries the "active" semantic; this fill is just
  // contrast against the map.
  activeBg: "#93c5fd", // blue-300 pastel
  activeShape: "#0f172a", // slate-900
  activeRing: "#60a5fa", // blue-400 (1 px outline) — matches new bg
  haloRing: "#ef4444", // red-500 (animated pulse — saturated for OSM visibility)
};

const SIZE = 22; // 70 % of the prior 32 px
const ICON_SIZE = 14;

function KindIcon({ kind }: { kind: Place["kind"] }) {
  switch (kind) {
    case "observatory_public":
      return <PublicObservatoryIcon />;
    case "observatory_private":
      return <PrivateObservatoryIcon />;
    case "spot_permanent":
      return <PermanentSpotIcon />;
    case "spot_temporary":
      return <TemporarySpotIcon />;
  }
}

export function MapMarker({ kind, active, subscribed, testid, ariaLabel }: Props) {
  const bg = active ? COLORS.activeBg : COLORS.inactiveBg;
  const shape = active ? COLORS.activeShape : COLORS.inactiveShape;
  const ring = active ? COLORS.activeRing : COLORS.inactiveRing;

  return (
    <div
      data-testid={testid}
      role="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      className="relative cursor-pointer select-none"
      style={{ width: SIZE, height: SIZE + 4 }}
      data-kind={kind}
      data-active={active ? "1" : "0"}
    >
      {/* Pulse halo for active places — saturated red so it pops on
          OSM's green vegetation/parks. Body underneath stays pastel
          green to keep the "presence" semantic. */}
      {active && (
        <span
          className="absolute rounded-full animate-ping"
          style={{
            background: COLORS.haloRing,
            opacity: 0.85,
            width: SIZE + 6,
            height: SIZE + 6,
            top: -3,
            left: -3,
          }}
        />
      )}

      <div
        className="absolute inset-0 flex items-center justify-center rounded-full shadow-md"
        style={{
          background: bg,
          color: shape,
          width: SIZE,
          height: SIZE,
          top: 0,
          left: 0,
          // 1 px outline instead of the previous ring-2 — markers no
          // longer dominate the map visually.
          boxShadow: `0 0 0 1px ${ring}, 0 1px 2px rgba(0,0,0,0.4)`,
        }}
      >
        <KindIcon kind={kind} />
      </div>

      {subscribed && (
        <span
          data-testid="marker-subscribed-badge"
          className="absolute -bottom-1 -right-1 bg-amber-400 rounded-full flex items-center justify-center"
          style={{
            width: 10,
            height: 10,
            boxShadow: `0 0 0 1px ${COLORS.inactiveShape}`,
          }}
          aria-label="Subscribed"
          title="Sledováno"
        >
          <StarIconBadge />
        </span>
      )}
    </div>
  );
}

/* ---- Kind-specific glyphs ---- */

/** Public observatory — wide arched dome with a tall vertical aperture
 * slit and ground line. Most "dome-like" of the set. */
function PublicObservatoryIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {/* Ground line */}
      <rect x="2" y="19" width="20" height="2" rx="0.6" fill="currentColor" />
      {/* Dome — wide arch */}
      <path d="M3 19a9 9 0 0 1 18 0H3z" fill="currentColor" />
      {/* Tall aperture slit — the signature shape */}
      <rect x="10.5" y="9" width="3" height="10" rx="0.8" fill={COLORS.inactiveBg} />
    </svg>
  );
}

/** Private observatory — peaked-roof rectangular building (NOT a dome)
 * with a small padlock above the door. Reads instantly as "house/closed". */
function PrivateObservatoryIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {/* Walls — boxy rectangle */}
      <rect x="5" y="11" width="14" height="10" rx="0.5" fill="currentColor" />
      {/* Peaked roof */}
      <path d="M4 12L12 4l8 8H4z" fill="currentColor" />
      {/* Door cut-out */}
      <rect x="10.5" y="14.5" width="3" height="6.5" rx="0.3" fill={COLORS.inactiveBg} />
      {/* Padlock shackle above door */}
      <path
        d="M11 14.5v-1.4a1 1 0 0 1 2 0v1.4"
        fill="none"
        stroke={COLORS.inactiveBg}
        strokeWidth="0.8"
      />
    </svg>
  );
}

/** Permanent observation spot — 5-pointed star (universal astronomy
 * symbol). Bold, recognizable, totally different from dome silhouettes. */
function PermanentSpotIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        d="M12 2l2.9 6.05L21.5 9.1l-4.8 4.65 1.15 6.6L12 17.2l-5.85 3.15L7.3 13.75 2.5 9.1l6.6-1.05L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Temporary spot — narrow pointed tent (steep triangle with pole). */
function TemporarySpotIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {/* Ground line */}
      <rect x="2" y="20" width="20" height="1.8" rx="0.4" fill="currentColor" />
      {/* Tent body — steeper, narrower than before */}
      <path d="M6 20L12 3l6 17H6z" fill="currentColor" />
      {/* Opening slit */}
      <path d="M12 6L9.7 20h4.6L12 6z" fill={COLORS.inactiveBg} />
    </svg>
  );
}

function StarIconBadge() {
  return (
    <svg width="6" height="6" viewBox="0 0 24 24" fill={COLORS.inactiveShape} aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/** Cluster marker — round bubble showing the count of grouped places.
 * Used by MapView when multiple markers fall within ~50 px of each
 * other at the current zoom. Larger than a single marker so the count
 * is readable. */
export function MapClusterMarker({
  count,
  hasActive,
  testid,
}: {
  count: number;
  hasActive: boolean;
  testid?: string;
}) {
  // Scale by count — small (<10), medium (10-50), large (50+)
  const size = count >= 50 ? 38 : count >= 10 ? 32 : 26;
  // Follow the same scheme as single markers: pastel green when any
  // contained place has a check-in, near-white/near-black neutral
  // otherwise so a screen full of clusters stays readable.
  const bg = hasActive ? COLORS.activeBg : COLORS.inactiveBg;
  const text = hasActive ? COLORS.activeShape : COLORS.inactiveShape;
  const ring = hasActive ? COLORS.activeRing : COLORS.inactiveRing;
  return (
    <div
      data-testid={testid}
      role="button"
      aria-label={`${count} places`}
      title={`${count} míst v této oblasti — přibližte pro detail`}
      className="relative cursor-pointer select-none"
      style={{ width: size, height: size }}
    >
      {hasActive && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: COLORS.haloRing, opacity: 0.75 }}
        />
      )}
      <div
        className="absolute inset-0 flex items-center justify-center rounded-full shadow-md font-bold"
        style={{
          background: bg,
          color: text,
          fontSize: count >= 100 ? 11 : count >= 10 ? 13 : 14,
          boxShadow: `0 0 0 1px ${ring}, 0 1px 2px rgba(0,0,0,0.4)`,
        }}
      >
        {count}
      </div>
    </div>
  );
}
