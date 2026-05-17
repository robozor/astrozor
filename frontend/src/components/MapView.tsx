import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Map,
  Marker,
  NavigationControl,
  type MapRef,
  type MapStyle,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  geocoding,
  places,
  subscriptions,
  ApiError,
  type GeocodeHit,
  type Me,
  type Place,
} from "../lib/api";
import { MapMarker } from "./MapMarker";
import { PlaceDetailPanel } from "./PlaceDetailPanel";

// ---- Tile layer presets ----
// All sources are free public services with attribution kept intact.
// Production target = self-hosted PMTiles (ADR-005); these are dev/runtime
// presets so the user can pick the underlay that suits their session.

const STYLE_OSM: MapStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const STYLE_CARTO_DARK: MapStyle = {
  version: 8,
  sources: {
    cartodark: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://carto.com/attributions">CARTO</a> · © OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: "cartodark", type: "raster", source: "cartodark" }],
};

const STYLE_SATELLITE: MapStyle = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community",
      maxzoom: 19,
    },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

const STYLE_TOPO: MapStyle = {
  version: 8,
  sources: {
    topo: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        'Map data © OSM · SRTM · Style © <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxzoom: 17,
    },
  },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

type StyleKey = "osm" | "dark" | "satellite" | "topo";
const STYLES: Record<StyleKey, MapStyle> = {
  osm: STYLE_OSM,
  dark: STYLE_CARTO_DARK,
  satellite: STYLE_SATELLITE,
  topo: STYLE_TOPO,
};

const ALL_KINDS: Place["kind"][] = [
  "observatory_public",
  "observatory_private",
  "spot_permanent",
  "spot_temporary",
];

type StateFilter = "all" | "active" | "subscribed";


export function MapView({ me }: { me?: Me | null } = {}) {
  const mapRef = useRef<MapRef | null>(null);
  const placesQuery = useQuery({ queryKey: ["places"], queryFn: () => places.list() });
  const subsQuery = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => subscriptions.list(),
    enabled: !!me,
  });
  const subscribedIds = useMemo(
    () => new Set((subsQuery.data ?? []).filter((s) => s.kind === "place").map((s) => s.target_id)),
    [subsQuery.data],
  );
  const [selected, setSelected] = useState<Place | null>(null);

  const [styleKey, setStyleKey] = useState<StyleKey>("osm");
  const [tileWarning, setTileWarning] = useState<string | null>(null);
  // Track per-style error counts so we don't fall back on a single hiccup
  const errorCountRef = useRef<Record<StyleKey, number>>({
    osm: 0,
    dark: 0,
    satellite: 0,
    topo: 0,
  });
  const [enabledKinds, setEnabledKinds] = useState<Set<Place["kind"]>>(
    () => new Set(ALL_KINDS),
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");

  // Filter places before rendering
  const visiblePlaces = useMemo(() => {
    const items = placesQuery.data?.items ?? [];
    return items.filter((p) => {
      if (!enabledKinds.has(p.kind)) return false;
      if (stateFilter === "active" && p.active_checkin_count <= 0) return false;
      if (stateFilter === "subscribed" && !subscribedIds.has(p.id)) return false;
      return true;
    });
  }, [placesQuery.data, enabledKinds, stateFilter, subscribedIds]);

  // Center of CR by default
  const initialViewState = useMemo(
    () => ({ longitude: 15.4, latitude: 49.8, zoom: 6.5 }),
    [],
  );

  const handleFly = (lat: number, lon: number, zoom = 12) => {
    mapRef.current?.flyTo({ center: [lon, lat], zoom, duration: 1200 });
  };

  // Tile-source rate-limit guard: if MapLibre reports repeated tile fetch
  // failures (HTTP 429 / 403 / network) from the current style, switch
  // back to OSM and show a warning. MapLibre's `error` event surfaces
  // tile load failures with status codes; we count them per-style and
  // tolerate a few before reacting.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onError = (e: { error?: { status?: number; url?: string } }) => {
      const status = e.error?.status;
      if (status !== 429 && status !== 403) return;
      const k = styleKey;
      errorCountRef.current[k] = (errorCountRef.current[k] ?? 0) + 1;
      if (errorCountRef.current[k] >= 3 && k !== "osm") {
        setTileWarning(
          `${k.toUpperCase()} tile server is throttling (HTTP ${status}). Falling back to OSM.`,
        );
        setStyleKey("osm");
      }
    };
    map.on("error", onError);
    return () => {
      map.off("error", onError);
    };
  }, [styleKey]);

  // Reset error count + warning when user manually picks a new style
  const handleStyleChange = (k: StyleKey) => {
    errorCountRef.current[k] = 0;
    setTileWarning(null);
    setStyleKey(k);
  };

  return (
    <div className="relative w-full h-[calc(100vh-9rem)] min-h-[400px] rounded-xl overflow-hidden ring-1 ring-slate-700">
      <Map
        ref={mapRef}
        mapStyle={STYLES[styleKey]}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" />
        {visiblePlaces.map((p) => (
          <Marker
            key={p.id}
            longitude={p.lon}
            latitude={p.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(p);
            }}
          >
            <MapMarker
              kind={p.kind}
              active={p.active_checkin_count > 0}
              subscribed={subscribedIds.has(p.id)}
              testid={`marker-${p.slug}`}
              ariaLabel={p.name}
            />
          </Marker>
        ))}
      </Map>

      {selected && (
        <PlaceDetailPanel
          place={selected}
          me={me ?? null}
          onClose={() => setSelected(null)}
        />
      )}

      {tileWarning && (
        <div
          data-testid="map-tile-warning"
          className="absolute top-3 right-12 bg-amber-950/90 ring-1 ring-amber-700/60 rounded-md px-3 py-1.5 text-xs text-amber-200 backdrop-blur max-w-md"
          role="status"
        >
          ⚠ {tileWarning}
          <button
            type="button"
            onClick={() => setTileWarning(null)}
            aria-label="Dismiss"
            className="ml-2 text-amber-300 hover:text-amber-100"
          >
            ✕
          </button>
        </div>
      )}

      <ControlPanel
        visibleCount={visiblePlaces.length}
        totalCount={placesQuery.data?.count ?? 0}
        loading={placesQuery.isLoading}
        styleKey={styleKey}
        onStyleChange={handleStyleChange}
        enabledKinds={enabledKinds}
        onKindToggle={(k) =>
          setEnabledKinds((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          })
        }
        stateFilter={stateFilter}
        onStateChange={setStateFilter}
        onFly={handleFly}
      />
    </div>
  );
}

// ---- Control panel (left overlay) ----

function ControlPanel({
  visibleCount,
  totalCount,
  loading,
  styleKey,
  onStyleChange,
  enabledKinds,
  onKindToggle,
  stateFilter,
  onStateChange,
  onFly,
}: {
  visibleCount: number;
  totalCount: number;
  loading: boolean;
  styleKey: StyleKey;
  onStyleChange: (k: StyleKey) => void;
  enabledKinds: Set<Place["kind"]>;
  onKindToggle: (k: Place["kind"]) => void;
  stateFilter: StateFilter;
  onStateChange: (s: StateFilter) => void;
  onFly: (lat: number, lon: number, zoom?: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="mapctl-open"
        className="absolute top-3 left-3 bg-slate-900/90 hover:bg-slate-800 ring-1 ring-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-200 backdrop-blur"
        aria-label={t("map.ctl.open")}
      >
        ☰ {t("map.ctl.title")}
      </button>
    );
  }

  return (
    <div
      data-testid="mapctl-panel"
      className="absolute top-3 left-3 w-72 max-h-[calc(100%-1.5rem)] flex flex-col bg-slate-900/95 ring-1 ring-slate-700 rounded-md backdrop-blur text-slate-200 shadow-xl"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <span className="text-xs font-semibold tracking-wide text-slate-300">
          {t("map.ctl.title")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("map.ctl.close")}
          className="text-slate-400 hover:text-slate-100 text-xs"
        >
          ✕
        </button>
      </header>

      <div className="overflow-auto px-3 py-3 space-y-4 text-xs">
        <SearchBox onPick={onFly} />

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t("map.ctl.kinds")}
          </h3>
          <ul className="space-y-1">
            {ALL_KINDS.map((k) => (
              <li key={k}>
                <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
                  <input
                    type="checkbox"
                    checked={enabledKinds.has(k)}
                    onChange={() => onKindToggle(k)}
                    className="accent-indigo-500"
                    data-testid={`mapctl-kind-${k}`}
                  />
                  <KindSwatch kind={k} />
                  <span>{t(`places.kind.${k}`)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t("map.ctl.state")}
          </h3>
          <div className="flex gap-1">
            {(["all", "active", "subscribed"] as StateFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onStateChange(s)}
                data-testid={`mapctl-state-${s}`}
                className={`flex-1 px-2 py-1 rounded ring-1 transition ${
                  stateFilter === s
                    ? "bg-indigo-600 ring-indigo-500 text-white"
                    : "bg-slate-950 ring-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {t(`map.ctl.stateOpt.${s}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t("map.ctl.layer")}
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(STYLES) as StyleKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onStyleChange(k)}
                data-testid={`mapctl-style-${k}`}
                className={`px-2 py-1 rounded ring-1 transition ${
                  styleKey === k
                    ? "bg-indigo-600 ring-indigo-500 text-white"
                    : "bg-slate-950 ring-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {t(`map.ctl.layerOpt.${k}`)}
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="px-3 py-2 border-t border-slate-800 text-[11px] text-slate-500">
        {loading
          ? t("common.loading")
          : `${visibleCount} / ${totalCount} ${t("places.countSuffix")}`}
      </footer>
    </div>
  );
}

function KindSwatch({ kind }: { kind: Place["kind"] }) {
  const color: Record<Place["kind"], string> = {
    observatory_public: "#22d3ee",
    observatory_private: "#a78bfa",
    spot_permanent: "#fbbf24",
    spot_temporary: "#f472b6",
  };
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-slate-700"
      style={{ background: color[kind] }}
    />
  );
}

// ---- City search via Nominatim ----

function SearchBox({ onPick }: { onPick: (lat: number, lon: number, zoom?: number) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [rateLimitHint, setRateLimitHint] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  async function runSearch(query: string) {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setPending(true);
    setRateLimitHint(null);
    try {
      const r = await geocoding.search(query, 6, "cs,en");
      setHits(r.items);
      setOpen(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setRateLimitHint(e.detail);
        setHits([]);
      } else {
        setHits([]);
      }
    } finally {
      setPending(false);
    }
  }

  function onInput(v: string) {
    setQ(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(v), 350);
  }

  function pickHit(h: GeocodeHit) {
    const lat = parseFloat(h.lat);
    const lon = parseFloat(h.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      onPick(lat, lon, 12);
      setOpen(false);
      setQ(h.display_name.split(",")[0]);
    }
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {t("map.ctl.search")}
      </h3>
      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder={t("map.ctl.searchPlaceholder")}
          data-testid="mapctl-search"
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded px-2 py-1.5 text-slate-100 outline-none"
        />
        {pending && (
          <span className="absolute right-2 top-1.5 text-slate-500 text-xs">…</span>
        )}
        {rateLimitHint && (
          <p
            className="mt-1 text-[11px] text-amber-300"
            data-testid="mapctl-search-ratelimited"
          >
            ⚠ {rateLimitHint}
          </p>
        )}
        {open && hits.length > 0 && (
          <ul className="absolute z-10 mt-1 left-0 right-0 max-h-60 overflow-auto bg-slate-900 ring-1 ring-slate-700 rounded shadow-xl">
            {hits.map((h) => (
              <li key={h.place_id}>
                <button
                  type="button"
                  onClick={() => pickHit(h)}
                  className="w-full text-left px-2 py-1.5 hover:bg-slate-800 text-slate-100 text-xs border-b border-slate-800 last:border-b-0"
                >
                  {h.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
