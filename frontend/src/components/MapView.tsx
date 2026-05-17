import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Map, Marker, type MapStyle } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { places, type Me, type Place } from "../lib/api";
import { PlaceDetailPanel } from "./PlaceDetailPanel";

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

export function MapView({ me }: { me?: Me | null } = {}) {
  const placesQuery = useQuery({ queryKey: ["places"], queryFn: () => places.list() });
  const [selected, setSelected] = useState<Place | null>(null);

  // Center of CR by default
  const initialViewState = useMemo(
    () => ({ longitude: 15.4, latitude: 49.8, zoom: 6.5 }),
    [],
  );

  return (
    <div className="relative w-full h-[65vh] rounded-xl overflow-hidden ring-1 ring-slate-700">
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

      {selected && (
        <PlaceDetailPanel
          place={selected}
          me={me ?? null}
          onClose={() => setSelected(null)}
        />
      )}

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
