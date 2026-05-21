import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import { useTranslation } from "react-i18next";
import { geocoding, places, type Place } from "../lib/api";

/**
 * Three-mode location picker:
 *   1. "place"   — dropdown of existing Astrozor places (FK).
 *   2. "address" — text search via geocoding, returns lat/lon + display.
 *   3. "map"     — interactive map; clicking sets lat/lon (no address).
 *
 * Used by EventEditor. Persisted shape is intentionally a flat object so
 * the caller can drop it into both EventCreateIn (place_slug or
 * external_address/lat/lon) and the patch endpoint.
 */
export type LocationValue = {
  mode: "place" | "address" | "map";
  place_slug: string;            // mode=place
  external_address: string;       // mode=address
  external_lat: number | null;    // mode=address|map
  external_lon: number | null;    // mode=address|map
};

export const EMPTY_LOCATION: LocationValue = {
  mode: "place",
  place_slug: "",
  external_address: "",
  external_lat: null,
  external_lon: null,
};

export function LocationPicker({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {(["place", "address", "map"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...value, mode: m })}
            data-testid={`loc-mode-${m}`}
            className={`text-xs px-3 py-1.5 rounded-md ring-1 transition ${
              value.mode === m
                ? "bg-indigo-600 ring-indigo-500 text-white"
                : "bg-slate-950 ring-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {t(`events.location.mode.${m}`)}
          </button>
        ))}
      </div>

      {value.mode === "place" && (
        <PlaceDropdown value={value.place_slug} onChange={(slug) => onChange({ ...value, place_slug: slug })} />
      )}
      {value.mode === "address" && (
        <AddressGeocoder
          address={value.external_address}
          lat={value.external_lat}
          lon={value.external_lon}
          onPick={(addr, lat, lon) =>
            onChange({ ...value, external_address: addr, external_lat: lat, external_lon: lon })
          }
        />
      )}
      {value.mode === "map" && (
        <MapPointPicker
          lat={value.external_lat}
          lon={value.external_lon}
          onPick={(lat, lon) =>
            onChange({ ...value, external_lat: lat, external_lon: lon })
          }
        />
      )}
    </div>
  );
}

// ---- Mode 1: Astrozor place dropdown ----

function PlaceDropdown({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["places"], queryFn: () => places.list() });
  const items: Place[] = q.data?.items ?? [];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="loc-place-select"
      className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 text-sm outline-none"
    >
      <option value="">— {t("events.location.placePlaceholder")} —</option>
      {items.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.name} {p.address && `· ${p.address}`}
        </option>
      ))}
    </select>
  );
}

// ---- Mode 2: address search with Nominatim geocoding ----

function AddressGeocoder({
  address,
  lat,
  lon,
  onPick,
}: {
  address: string;
  lat: number | null;
  lon: number | null;
  onPick: (addr: string, lat: number | null, lon: number | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(address);
  const [debounced, setDebounced] = useState(address);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(id);
  }, [query]);

  const q = useQuery({
    queryKey: ["geocode", debounced],
    queryFn: () => geocoding.search(debounced, 6),
    enabled: debounced.length >= 3,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("events.location.addressPlaceholder")}
        data-testid="loc-address-input"
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 text-sm outline-none"
      />
      {q.isLoading && debounced.length >= 3 && (
        <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <ul className="bg-slate-950 ring-1 ring-slate-800 rounded-md max-h-48 overflow-y-auto divide-y divide-slate-800">
          {q.data.items.map((hit) => {
            const selected =
              lat !== null && lon !== null &&
              Math.abs(parseFloat(hit.lat) - lat) < 1e-5 &&
              Math.abs(parseFloat(hit.lon) - lon) < 1e-5;
            return (
              <li key={hit.place_id}>
                <button
                  type="button"
                  onClick={() => onPick(hit.display_name, parseFloat(hit.lat), parseFloat(hit.lon))}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-900 ${
                    selected ? "bg-indigo-950/40 text-indigo-200" : "text-slate-300"
                  }`}
                >
                  {hit.display_name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lat !== null && lon !== null && (
        <p className="text-[11px] text-slate-500 font-mono">
          📍 {lat.toFixed(5)}, {lon.toFixed(5)}
          {address && (
            <span className="ml-2 text-slate-400 font-sans">{address}</span>
          )}
        </p>
      )}
    </div>
  );
}

// ---- Mode 3: map click picker ----

function MapPointPicker({
  lat,
  lon,
  onPick,
}: {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<MapRef | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="h-64 rounded-md ring-1 ring-slate-700 overflow-hidden bg-slate-950">
        <Map
          ref={ref}
          initialViewState={{
            longitude: lon ?? 15.4,
            latitude: lat ?? 49.8,
            zoom: lat !== null ? 11 : 6.5,
          }}
          mapStyle={{
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          }}
          onClick={(e) => {
            onPick(e.lngLat.lat, e.lngLat.lng);
          }}
          style={{ width: "100%", height: "100%" }}
        >
          {lat !== null && lon !== null && (
            <Marker longitude={lon} latitude={lat} anchor="bottom">
              <span className="text-2xl">📍</span>
            </Marker>
          )}
        </Map>
      </div>
      <p className="text-[11px] text-slate-500">
        {lat !== null && lon !== null ? (
          <span className="font-mono">📍 {lat.toFixed(5)}, {lon.toFixed(5)}</span>
        ) : (
          t("events.location.mapHint")
        )}
      </p>
    </div>
  );
}
