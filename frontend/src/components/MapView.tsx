import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Map, Marker, type MapStyle } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { places, type Place } from "../lib/api";

// OSM raster style — dev only. Production target = self-hosted PMTiles (ADR-005).
const OSM_STYLE: MapStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const KIND_COLOR: Record<Place["kind"], string> = {
  observatory_public: "#22d3ee", // cyan
  observatory_private: "#a78bfa", // purple
  spot_permanent: "#fbbf24", // amber
  spot_temporary: "#f472b6", // pink
};

export function MapView() {
  const placesQuery = useQuery({ queryKey: ["places"], queryFn: () => places.list() });
  const [selected, setSelected] = useState<Place | null>(null);

  // Center of CR by default
  const initialViewState = useMemo(
    () => ({ longitude: 15.4, latitude: 49.8, zoom: 6.5 }),
    [],
  );

  return (
    <div className="relative w-full h-[60vh] rounded-xl overflow-hidden ring-1 ring-slate-700">
      <Map
        mapStyle={OSM_STYLE}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
      >
        {placesQuery.data?.items.map((p) => (
          <Marker
            key={p.id}
            longitude={p.lon}
            latitude={p.lat}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(p);
            }}
          >
            <div
              data-testid={`marker-${p.slug}`}
              role="button"
              aria-label={p.name}
              title={p.name}
              className="rounded-full ring-2 ring-slate-950 shadow-lg cursor-pointer"
              style={{
                width: 16,
                height: 16,
                background: KIND_COLOR[p.kind] ?? "#fff",
              }}
            />
          </Marker>
        ))}
      </Map>

      {selected && <DetailPanel place={selected} onClose={() => setSelected(null)} />}

      <PlacesCount count={placesQuery.data?.count ?? 0} loading={placesQuery.isLoading} />
    </div>
  );
}

function PlacesCount({ count, loading }: { count: number; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="absolute top-3 left-3 bg-slate-900/90 ring-1 ring-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
      {loading ? t("common.loading") : `${count} ${t("places.countSuffix")}`}
    </div>
  );
}

function DetailPanel({ place, onClose }: { place: Place; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="place-detail"
      className="absolute top-0 right-0 bottom-0 w-full sm:w-80 bg-slate-950/95 ring-1 ring-slate-800 backdrop-blur p-5 overflow-y-auto"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-100"
      >
        ✕
      </button>
      <h3 className="text-lg font-semibold pr-6">{place.name}</h3>
      <p className="text-xs text-slate-500 mt-1 font-mono">{t(`places.kind.${place.kind}`)}</p>
      {place.address && <p className="text-xs text-slate-400 mt-2">{place.address}</p>}
      {place.description && <p className="text-sm text-slate-300 mt-3">{place.description}</p>}
      <dl className="grid grid-cols-2 gap-2 mt-4 text-xs">
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
          className="inline-block mt-4 text-xs text-indigo-300 hover:text-indigo-200 underline"
        >
          {place.website}
        </a>
      )}
    </aside>
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
