import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layer,
  Map,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
  type MapStyle,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

// Register pmtiles:// protocol once, globally. Lets MapLibre fetch
// vector/raster tiles directly from a .pmtiles archive served over HTTP.
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
import {
  auth,
  clouds,
  events as eventsApi,
  geocoding,
  mapConfig,
  places,
  subscriptions,
  ApiError,
  type CloudFramesOut,
  type Event,
  type GeocodeHit,
  type MapPreferences,
  type Me,
  type Place,
} from "../lib/api";
import { MapClusterMarker, MapMarker } from "./MapMarker";
import { PlaceDetailPanel } from "./PlaceDetailPanel";
import { PlaceFormModal } from "./PlaceFormModal";
import { EventMarker } from "./EventMarker";
import { EventDetailPanel } from "./EventDetailPanel";

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

/**
 * Build a vector MapStyle backed by a Protomaps PMTiles archive.
 * Theme-aware (dark/light) — colors come from `palette` so we can swap
 * the whole color set without duplicating the layer scaffolding. Uses
 * the Protomaps Basemaps schema (https://docs.protomaps.com/basemaps/layers)
 * which exposes layers: earth, natural, landuse, water, roads, buildings,
 * boundaries, places, pois, transit, physical_*.
 *
 * Roads + boundaries + places have a `kind` discriminator we filter
 * on so higher-class features (highway, country) render bigger and
 * brighter than minor roads or village labels.
 *
 * Place labels use `zoom + 2 >= feature.min_zoom` so settlements appear
 * ~2 zoom levels earlier than Protomaps' built-in recommendation, with
 * symbol-sort-key by min_zoom so important cities win label collisions.
 */
type PmtilesTheme = "dark" | "light";

// Hard-coded city allowlists — used as a fallback when the PMTiles
// archive's `min_zoom`/`population`/`population_rank` attributes don't
// reliably flag importance. Allows us to guarantee Praha/Brno render
// big regardless of schema surprises.
const MEGA_CITY_NAMES: string[] = [
  "Praha", "Prague", "Wien", "Vienna", "Vídeň",
  "Berlin", "München", "Munich", "Hamburg",
  "Warszawa", "Warsaw", "Kraków",
  "Bratislava", "Budapest", "Budapešť",
  "Paris", "Paříž", "London", "Londýn",
  "Madrid", "Rome", "Roma", "Řím",
  "Amsterdam", "Brussels", "Bruxelles",
  "Moscow", "Moskva", "Kyiv", "Kiev",
];

const BIG_CITY_NAMES: string[] = [
  "Brno", "Ostrava", "Plzeň", "Pilsen",
  "Liberec", "Olomouc", "České Budějovice",
  "Hradec Králové", "Pardubice", "Zlín", "Jihlava",
  "Salzburg", "Linz", "Graz", "Innsbruck",
  "Dresden", "Leipzig", "Nürnberg", "Wrocław",
  "Košice",
];

// Tier classifier expressions — reused for both `text-size` (so font
// scales per tier) and `symbol-sort-key` (so collision priority matches
// importance). Mega beats big beats regular in collisions.
// Typed as `any` so MapLibre style expression types accept them.
const MEGA_MATCH: any = [
  "any",
  ["<=", ["coalesce", ["get", "min_zoom"], 99], 7],
  [">=", ["coalesce", ["get", "population"], 0], 500000],
  ["<=", ["coalesce", ["get", "population_rank"], 999], 50],
  ["in", ["coalesce", ["get", "name"], ""], ["literal", MEGA_CITY_NAMES]],
];

const BIG_MATCH: any = [
  "any",
  ["<=", ["coalesce", ["get", "min_zoom"], 99], 9],
  [">=", ["coalesce", ["get", "population"], 0], 100000],
  ["<=", ["coalesce", ["get", "population_rank"], 999], 200],
  ["in", ["coalesce", ["get", "name"], ""], ["literal", BIG_CITY_NAMES]],
];

const PMTILES_PALETTES = {
  dark: {
    background: "#020617", // slate-950
    earth: "#0f172a",      // slate-900
    landuseUrban: "#1e293b", // slate-800
    forest: "#14532d",     // green-900
    park: "#166534",       // green-800
    wetland: "#0e3a3a",    // teal-dark
    recreation: "#15803d", // green-700
    institutional: "#27272a", // zinc-800 — schools/hospitals area
    military: "#3f1d1d",   // red-dark
    quarry: "#3f3526",     // brown-dark
    runway: "#1f2937",     // gray-800
    glacier: "#e2e8f0",
    farmland: "#1c1917",   // stone-900 — barely-there warm tint
    pedestrian: "#1e293b", // slate-800
    cemetery: "#172024",
    sand: "#44403c",       // stone-700
    water: "#1e3a8a",      // blue-900
    waterOutline: "#1e40af", // blue-800 — slightly lighter than fill
    // Roads tuned dark on purpose — earlier values (slate-400/300) made
    // rural minor roads dominate the visual hierarchy at zoom ~10,
    // drowning out city labels. Now roads are subtle texture; labels
    // pop. Highway keeps amber so it still pops where it matters.
    pathLine: "#1e293b",   // slate-800
    minorRoad: "#334155",  // slate-700
    mediumRoad: "#475569", // slate-600
    majorRoad: "#64748b",  // slate-500
    highwayCasing: "#0f172a",
    highway: "#fbbf24",    // amber-400
    rail: "#a78bfa",       // violet-400
    building: "#334155",   // slate-700
    boundaryRegion: "#475569",
    boundaryCountry: "#94a3b8",
    textCountry: "#cbd5e1",
    textCity: "#ffffff",   // pure white — must beat road texture
    textTown: "#e2e8f0",   // slate-200
    textVillage: "#cbd5e1", // slate-300 — was slate-400, too dim
    textPeak: "#fbbf24",
    textPoi: "#cbd5e1",    // slate-300 — generic POI labels
    textHalo: "#020617",
  },
  light: {
    background: "#f8fafc", // slate-50
    earth: "#f1f5f9",      // slate-100
    landuseUrban: "#e2e8f0", // slate-200
    forest: "#86efac",     // green-300
    park: "#bbf7d0",       // green-200
    wetland: "#a7f3d0",    // emerald-200
    recreation: "#bef264", // lime-300
    institutional: "#e7e5e4", // stone-200 — schools/hospitals area
    military: "#fecaca",   // red-200
    quarry: "#d6d3d1",     // stone-300
    runway: "#a8a29e",     // stone-400
    glacier: "#ffffff",
    farmland: "#fef3c7",   // amber-100
    pedestrian: "#e7e5e4", // stone-200
    cemetery: "#d6d3d1",   // stone-300
    sand: "#fde68a",       // amber-200
    water: "#93c5fd",      // blue-300
    waterOutline: "#60a5fa", // blue-400 — visible against light fill
    pathLine: "#94a3b8",
    minorRoad: "#94a3b8",
    mediumRoad: "#64748b",
    majorRoad: "#334155",
    highwayCasing: "#fbbf24",
    highway: "#f59e0b",    // amber-500
    rail: "#7c3aed",       // violet-600
    building: "#cbd5e1",   // slate-300
    boundaryRegion: "#94a3b8",
    boundaryCountry: "#475569",
    textCountry: "#1e293b",
    textCity: "#0f172a",
    textTown: "#1e293b",
    textVillage: "#475569",
    textPeak: "#b45309",   // amber-700
    textPoi: "#475569",    // slate-600
    textHalo: "#ffffff",
  },
} as const;

function pmtilesStyle(absoluteOrRelativeUrl: string, theme: PmtilesTheme = "dark"): MapStyle {
  const url = absoluteOrRelativeUrl.startsWith("http")
    ? `pmtiles://${absoluteOrRelativeUrl}`
    : `pmtiles://${window.location.origin}${absoluteOrRelativeUrl}`;
  const p = PMTILES_PALETTES[theme];
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      pmtiles: {
        type: "vector",
        url,
        attribution:
          '© <a href="https://protomaps.com">Protomaps</a> · © OpenStreetMap contributors',
      },
    },
    layers: [
      // ---- Backdrop / land / vegetation ----
      {
        id: "background",
        type: "background",
        paint: { "background-color": p.background },
      },
      {
        id: "earth",
        type: "fill",
        source: "pmtiles",
        "source-layer": "earth",
        paint: { "fill-color": p.earth },
      },
      {
        id: "landuse-farmland",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 8,
        filter: ["match", ["get", "kind"], ["farmland", "vineyard", "orchard", "plant_nursery"], true, false],
        paint: { "fill-color": p.farmland, "fill-opacity": 0.5 },
      },
      {
        id: "landuse-urban",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "kind"], ["urban_area", "residential", "industrial", "commercial"], true, false],
        paint: { "fill-color": p.landuseUrban, "fill-opacity": 0.45 },
      },
      {
        id: "landuse-pedestrian",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 13,
        filter: ["match", ["get", "kind"], ["pedestrian", "footway", "plaza", "platform"], true, false],
        paint: { "fill-color": p.pedestrian, "fill-opacity": 0.6 },
      },
      {
        id: "landuse-cemetery",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 12,
        filter: ["match", ["get", "kind"], ["cemetery", "grave_yard"], true, false],
        paint: { "fill-color": p.cemetery, "fill-opacity": 0.7 },
      },
      {
        id: "natural-sand",
        type: "fill",
        source: "pmtiles",
        "source-layer": "natural",
        minzoom: 10,
        filter: ["match", ["get", "kind"], ["sand", "beach", "bare_rock"], true, false],
        paint: { "fill-color": p.sand, "fill-opacity": 0.55 },
      },
      {
        id: "natural-forest",
        type: "fill",
        source: "pmtiles",
        "source-layer": "natural",
        filter: ["match", ["get", "kind"], ["forest", "wood", "scrub", "heath", "tree_row"], true, false],
        paint: { "fill-color": p.forest, "fill-opacity": 0.7 },
      },
      // Forests are frequently tagged as `landuse=forest` in OSM rather
      // than `natural=wood`. Without this layer Czech maps look almost
      // treeless because most woods are in the `landuse` source-layer.
      {
        id: "landuse-forest",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "kind"], ["forest", "wood"], true, false],
        paint: { "fill-color": p.forest, "fill-opacity": 0.7 },
      },
      {
        id: "natural-park",
        type: "fill",
        source: "pmtiles",
        "source-layer": "natural",
        filter: ["match", ["get", "kind"], ["park", "nature_reserve", "protected_area", "grass", "grassland", "meadow"], true, false],
        paint: { "fill-color": p.park, "fill-opacity": 0.55 },
      },
      {
        id: "natural-wetland",
        type: "fill",
        source: "pmtiles",
        "source-layer": "natural",
        minzoom: 9,
        filter: ["match", ["get", "kind"], ["wetland", "marsh", "swamp", "mud", "bog"], true, false],
        paint: { "fill-color": p.wetland, "fill-opacity": 0.55 },
      },
      {
        id: "landuse-recreation",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 11,
        filter: ["match", ["get", "kind"], ["recreation_ground", "pitch", "playground", "sports_centre", "stadium", "golf_course"], true, false],
        paint: { "fill-color": p.recreation, "fill-opacity": 0.45 },
      },
      {
        id: "landuse-institutional",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 12,
        filter: ["match", ["get", "kind"], ["school", "university", "college", "hospital", "kindergarten"], true, false],
        paint: { "fill-color": p.institutional, "fill-opacity": 0.6 },
      },
      {
        id: "landuse-military",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 8,
        filter: ["==", ["get", "kind"], "military"],
        paint: { "fill-color": p.military, "fill-opacity": 0.4 },
      },
      {
        id: "landuse-quarry",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 11,
        filter: ["match", ["get", "kind"], ["quarry", "landfill", "brownfield"], true, false],
        paint: { "fill-color": p.quarry, "fill-opacity": 0.5 },
      },
      {
        id: "landuse-runway",
        type: "fill",
        source: "pmtiles",
        "source-layer": "landuse",
        minzoom: 10,
        filter: ["match", ["get", "kind"], ["runway", "taxiway", "aerodrome", "apron"], true, false],
        paint: { "fill-color": p.runway, "fill-opacity": 0.7 },
      },
      {
        id: "natural-glacier",
        type: "fill",
        source: "pmtiles",
        "source-layer": "natural",
        filter: ["match", ["get", "kind"], ["glacier", "snowfield"], true, false],
        paint: { "fill-color": p.glacier, "fill-opacity": 0.55 },
      },
      // ---- Water ----
      // Protomaps stores TWO geometries for any river that's been dammed
      // into a reservoir: (a) the original pre-dam channel as a thin
      // `kind=river` polygon following the historical river bed, and
      // (b) the modern flooded `kind=reservoir` polygon. Drawing both
      // produces "stripe" artifacts where the narrow original channel
      // visibly extends beyond the modern reservoir as a straight
      // diagonal band — most obvious near Slapy/Orlík on the Vltava.
      //
      // Workaround: render `river` polygons only at zoom ≥ 13 where
      // they fit inside the reservoir geometry. At lower zooms show
      // only true water bodies (ocean/lake/reservoir/water) which have
      // clean polygon geometry. We also drop the global outline — it
      // wasn't helping disambiguate and just added another layer of
      // glitch potential at LOD boundaries.
      {
        id: "water",
        type: "fill",
        source: "pmtiles",
        "source-layer": "water",
        filter: [
          "match",
          ["get", "kind"],
          ["ocean", "lake", "reservoir", "water"],
          true,
          false,
        ],
        paint: { "fill-color": p.water },
      },
      // Rivers intentionally NOT rendered. Protomaps stores rivers as
      // polygons whose simplification produces visible "stripe" artifacts
      // (a thin diagonal band extending beyond the actual channel) at
      // mid zoom — see git history if curious. Centerline fallback via
      // `physical_line` also had glitches. The pragmatic call: drop
      // `kind=river` entirely. Reservoirs (Slapy, Orlík, Lipno, …) keep
      // rendering because they're tagged `kind=reservoir`, so the
      // visually dominant Czech water features survive. The trade-off
      // is that the free-flowing Vltava sections between dams won't
      // appear blue; acceptable for an astronomy site planner.
      {
        id: "water-minor",
        type: "fill",
        source: "pmtiles",
        "source-layer": "water",
        minzoom: 13,
        filter: [
          "match",
          ["get", "kind"],
          ["pond", "swimming_pool", "dock", "basin"],
          true,
          false,
        ],
        paint: { "fill-color": p.water, "fill-opacity": 0.7 },
      },
      // ---- Roads (hierarchy) ----
      {
        id: "roads-path",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 13,
        filter: ["match", ["get", "kind"], ["path", "other"], true, false],
        paint: {
          "line-color": p.pathLine,
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.4, 18, 1.4],
          "line-dasharray": [2, 2],
        },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 11,
        filter: ["==", ["get", "kind"], "minor_road"],
        paint: {
          "line-color": p.minorRoad,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 18, 2.6],
        },
      },
      {
        id: "roads-medium",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 9,
        filter: ["==", ["get", "kind"], "medium_road"],
        paint: {
          "line-color": p.mediumRoad,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 18, 4],
        },
      },
      {
        id: "roads-major",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 7,
        filter: ["==", ["get", "kind"], "major_road"],
        paint: {
          "line-color": p.majorRoad,
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 18, 5],
        },
      },
      {
        id: "roads-highway-casing",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 5,
        filter: ["==", ["get", "kind"], "highway"],
        paint: {
          "line-color": p.highwayCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 18, 8],
        },
      },
      {
        id: "roads-highway",
        type: "line",
        source: "pmtiles",
        "source-layer": "roads",
        minzoom: 5,
        filter: ["==", ["get", "kind"], "highway"],
        paint: {
          "line-color": p.highway,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 18, 6],
        },
      },
      // ---- Transit (rail) ----
      {
        id: "transit-rail",
        type: "line",
        source: "pmtiles",
        "source-layer": "transit",
        minzoom: 9,
        filter: ["==", ["get", "kind"], "rail"],
        paint: {
          "line-color": p.rail,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 18, 1.5],
          "line-dasharray": [4, 2],
        },
      },
      // ---- Buildings ----
      // Fade in from zoom 13; lower threshold than Protomaps default so
      // settlements have visible structure at typical browse zoom (~14).
      {
        id: "buildings",
        type: "fill",
        source: "pmtiles",
        "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-color": p.building,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.75],
        },
      },
      // ---- Admin boundaries ----
      {
        id: "boundaries-region",
        type: "line",
        source: "pmtiles",
        "source-layer": "boundaries",
        filter: ["==", ["get", "kind"], "region"],
        paint: {
          "line-color": p.boundaryRegion,
          "line-width": 0.5,
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "boundaries-country",
        type: "line",
        source: "pmtiles",
        "source-layer": "boundaries",
        filter: ["==", ["get", "kind"], "country"],
        paint: {
          "line-color": p.boundaryCountry,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 12, 1.8],
        },
      },
      // ---- Place labels ----
      // Protomaps `places` features carry a `min_zoom` attribute per
      // population/importance. We use `zoom + 2 >= min_zoom` so labels
      // appear ~2 zoom levels earlier than recommended (user-visible
      // tradeoff: more labels visible sooner; collision detection +
      // symbol-sort-key by min_zoom keeps important cities winning).
      // Font sizes intentionally larger than Protomaps defaults — this
      // map is consumed at desktop sizes, not mobile pinch-zoom.
      {
        id: "places-country",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "places",
        maxzoom: 9,
        filter: ["==", ["get", "kind"], "country"],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 20, 5, 30, 8, 42],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.3,
          "symbol-sort-key": 0, // always win against cities
        },
        paint: {
          "text-color": p.textCountry,
          "text-halo-color": p.textHalo,
          "text-halo-width": 3,
        },
      },
      // Single city layer, defensive about which Protomaps attributes
      // actually carry the importance signal in the user's PMTiles
      // archive. Different Protomaps builds populate one of:
      //   - `min_zoom`        (per-feature recommended display zoom)
      //   - `population`      (raw population)
      //   - `population_rank` (1 = largest)
      // We compute a "mega-ness" flag from any of these signals AND a
      // hard-coded name allowlist for the cities we MUST display large
      // regardless of what the tile schema looks like (Praha, Wien,
      // Berlin, Brno, …). This guarantees Praha/Brno look right even
      // if the archive has surprises.
      {
        id: "places-city",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "places",
        minzoom: 1,
        // Schema-defensive: Protomaps Daily v3+ uses kind="locality"
        // + kind_detail="city" while older builds (and our hand-written
        // expectation) use kind="city" directly. Match either.
        filter: [
          "any",
          ["==", ["get", "kind"], "city"],
          ["==", ["get", "kind_detail"], "city"],
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            2,  ["case", MEGA_MATCH, 14, BIG_MATCH, 11, 10],
            6,  ["case", MEGA_MATCH, 22, BIG_MATCH, 17, 13],
            10, ["case", MEGA_MATCH, 32, BIG_MATCH, 24, 18],
            14, ["case", MEGA_MATCH, 40, BIG_MATCH, 30, 22],
          ],
          // Sort-key uses the same tier logic as size so collision
          // priority matches importance. Mega = 1 (always wins), big
          // = 2, regular falls back to feature attributes.
          "symbol-sort-key": [
            "case",
            MEGA_MATCH, 1,
            BIG_MATCH, 2,
            ["coalesce", ["get", "min_zoom"], ["get", "population_rank"], 99],
          ],
        },
        paint: {
          "text-color": p.textCity,
          "text-halo-color": p.textHalo,
          "text-halo-width": 2,
        },
      },
      {
        id: "places-town",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "places",
        minzoom: 3,
        filter: [
          "all",
          // Schema-defensive: kind="town" (old) or kind_detail="town" (v3+).
          ["any",
            ["==", ["get", "kind"], "town"],
            ["==", ["get", "kind_detail"], "town"],
          ],
          [">=", ["+", ["zoom"], 2], ["coalesce", ["get", "min_zoom"], 7]],
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 14, 14, 17],
          "symbol-sort-key": ["coalesce", ["get", "min_zoom"], 8],
        },
        paint: {
          "text-color": p.textTown,
          "text-halo-color": p.textHalo,
          "text-halo-width": 2,
        },
      },
      {
        id: "places-village",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "places",
        minzoom: 7,
        filter: [
          "all",
          // Schema-defensive: old uses kind=village/neighbourhood/suburb;
          // v3+ uses kind=locality with kind_detail=village/hamlet/etc.
          // Crucially we do NOT match bare kind=locality here — that
          // pre-v3 catch-all gets matched by places-city if kind_detail
          // says it's a city; if neither layer wants it, it stays
          // unlabeled rather than getting the village treatment for
          // what might be Vienna.
          ["any",
            ["match", ["get", "kind"], ["village", "neighbourhood", "suburb", "hamlet"], true, false],
            ["match", ["get", "kind_detail"], ["village", "hamlet", "neighbourhood", "suburb"], true, false],
          ],
          [">=", ["+", ["zoom"], 2], ["coalesce", ["get", "min_zoom"], 11]],
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 14, 14],
          "symbol-sort-key": ["coalesce", ["get", "min_zoom"], 12],
        },
        paint: {
          "text-color": p.textVillage,
          "text-halo-color": p.textHalo,
          "text-halo-width": 1.8,
        },
      },
      // ---- POIs (selected useful categories) ----
      // Generic POI labels for transport, education, healthcare,
      // worship — anything that helps orientation. We avoid restaurants
      // /shops/etc. which clutter the map and aren't useful for
      // astronomy planning. Sort key by min_zoom so the most important
      // POI in a tile wins collision.
      {
        id: "poi-important",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "pois",
        minzoom: 12,
        filter: [
          "match",
          ["get", "kind"],
          [
            // Transport hubs
            "train_station", "subway_station", "bus_station",
            "airport", "aerodrome", "ferry_terminal",
            // Healthcare
            "hospital", "clinic", "pharmacy",
            // Education
            "university", "college", "school",
            // Religion & culture
            "place_of_worship", "church", "monastery",
            "townhall", "library", "museum", "theatre", "gallery",
            "castle", "fort", "ruins", "archaeological_site",
            // Public services
            "fire_station", "police", "post_office",
            // Astronomy-relevant: dark-sky locations, viewpoints, lodging
            "viewpoint", "camp_site", "caravan_site",
            "wilderness_hut", "alpine_hut", "shelter",
            "information", "picnic_site",
            // Mountain features
            "saddle", "volcano",
          ],
          true,
          false,
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 12],
          "text-offset": [0, 0.6],
          "text-optional": true,
          "symbol-sort-key": ["coalesce", ["get", "min_zoom"], 14],
        },
        paint: {
          "text-color": p.textPoi,
          "text-halo-color": p.textHalo,
          "text-halo-width": 1.2,
        },
      },
      // ---- Mountain peaks (relevant for astronomers — dark-sky sites) ----
      {
        id: "poi-peaks",
        type: "symbol",
        source: "pmtiles",
        "source-layer": "physical_point",
        minzoom: 9,
        filter: ["==", ["get", "kind"], "peak"],
        layout: {
          "text-field": ["coalesce", ["get", "name:cs"], ["get", "name"]],
          "text-font": ["Noto Sans Italic"],
          "text-size": 11,
          "text-offset": [0, 0.8],
        },
        paint: {
          "text-color": p.textPeak,
          "text-halo-color": p.textHalo,
          "text-halo-width": 1.2,
        },
      },
    ],
  };
}

type StyleKey = "osm" | "dark" | "satellite" | "topo";
const STYLES: Record<StyleKey, MapStyle> = {
  osm: STYLE_OSM,
  dark: STYLE_CARTO_DARK,
  satellite: STYLE_SATELLITE,
  topo: STYLE_TOPO,
};

// Per-style maximum zoom matching each tile provider's hard ceiling.
// MapLibre clamps user zoom to this value, so the map stops responding
// to further wheel-in / pinch instead of issuing requests for tiles
// that don't exist (which would 404 → fall back to OSM and break the
// user's "I'm on satellite" expectation).
//   - OSM tile servers serve up to z19 in most regions
//   - CARTO Dark Matter: z19
//   - ESRI World Imagery: z19 in most areas (rural may stop earlier;
//     the server's response wins server-side regardless)
//   - OpenTopoMap: hard ceiling at z17 (the SRTM contour rendering
//     simply doesn't produce z18+ tiles)
const STYLE_MAX_ZOOM: Record<StyleKey, number> = {
  osm: 19,
  dark: 19,
  satellite: 19,
  topo: 17,
};

const ALL_KINDS: Place["kind"][] = [
  "observatory_public",
  "observatory_private",
  "spot_permanent",
  "spot_temporary",
];

type StateFilter = "all" | "active" | "subscribed";


export function MapView({
  me,
  onRequireLogin: _onRequireLogin,
}: {
  me?: Me | null;
  onRequireLogin?: () => void;
} = {}) {
  // _onRequireLogin reserved for future anon-gated map actions (check-in,
  // edit place); read-only browsing already works without auth.
  const mapRef = useRef<MapRef | null>(null);
  const placesQuery = useQuery({ queryKey: ["places"], queryFn: () => places.list() });
  const cfgQuery = useQuery({ queryKey: ["map-config"], queryFn: () => mapConfig.get() });
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

  // If admin has configured PMTiles as the default tile backend, swap
  // it in as a fifth option and pre-select it. Otherwise OSM stays.
  const pmtilesUrl = cfgQuery.data?.pmtiles_url;
  const prefs: MapPreferences = me?.profile?.map_preferences ?? {};
  // PMTiles theme is a separate axis from styleKey so we don't pollute
  // the OSM/Dark/Satellite/Topo selector with two PMTiles entries.
  // Persisted in localStorage too so it survives across logins/guests.
  const [pmtilesTheme, setPmtilesTheme] = useState<PmtilesTheme>(() => {
    if (prefs.pmtiles_theme) return prefs.pmtiles_theme;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("astrozor.pmtilesTheme") : null;
    return stored === "light" ? "light" : "dark";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("astrozor.pmtilesTheme", pmtilesTheme);
    }
  }, [pmtilesTheme]);
  const styles = useMemo<Record<StyleKey, MapStyle>>(() => {
    if (!pmtilesUrl) return STYLES;
    return {
      ...STYLES,
      osm: pmtilesStyle(pmtilesUrl, pmtilesTheme),
    };
  }, [pmtilesUrl, pmtilesTheme]);

  const [styleKey, setStyleKey] = useState<StyleKey>(prefs.style_key ?? "osm");
  const [tileWarning, setTileWarning] = useState<string | null>(null);
  // Track per-style error counts so we don't fall back on a single hiccup
  const errorCountRef = useRef<Record<StyleKey, number>>({
    osm: 0,
    dark: 0,
    satellite: 0,
    topo: 0,
  });
  const [enabledKinds, setEnabledKinds] = useState<Set<Place["kind"]>>(
    () =>
      prefs.enabled_kinds && prefs.enabled_kinds.length > 0
        ? new Set(prefs.enabled_kinds.filter((k) => ALL_KINDS.includes(k as Place["kind"])) as Place["kind"][])
        : new Set(ALL_KINDS),
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>(prefs.state_filter ?? "all");
  const [lpEnabled, setLpEnabled] = useState(prefs.lp_enabled ?? false);
  // Events overlay — off by default. When enabled, fetches /events
  // and renders pin markers for any event that's still "open" (status
  // not finished/cancelled, ends_at in future or unset). Persisted to
  // map_preferences so user's choice survives a session.
  const [eventsEnabled, setEventsEnabled] = useState(prefs.events_enabled ?? false);
  const [selectedEventSlug, setSelectedEventSlug] = useState<string | null>(null);

  const eventsQuery = useQuery({
    queryKey: ["events", "map"],
    queryFn: () => eventsApi.list(),
    enabled: eventsEnabled,
  });

  const openEvents = useMemo<Array<Event & { _lat: number; _lon: number }>>(() => {
    if (!eventsEnabled) return [];
    const items = eventsQuery.data ?? [];
    const now = Date.now();
    return items.flatMap((e) => {
      // "open" = not finished, not cancelled, and not past its end_at.
      if (e.status === "finished" || e.status === "cancelled") return [];
      if (e.ends_at && new Date(e.ends_at).getTime() < now) return [];
      // Resolve coords: Astrozor place wins over external.
      const lat = e.place_lat ?? e.external_lat;
      const lon = e.place_lon ?? e.external_lon;
      if (lat === null || lon === null) return [];
      return [{ ...e, _lat: lat, _lon: lon }];
    });
  }, [eventsEnabled, eventsQuery.data]);
  const [lpOpacity, setLpOpacity] = useState(prefs.lp_opacity ?? 0.4);

  // Cloud cover overlay — off by default. When enabled, fetch the
  // provider's frame list (1..N tiles depending on provider). Multi-
  // frame providers (EUMETSAT) get a play button + scrubber for a
  // pseudo-animation; single-frame providers (OpenWeatherMap) just
  // render the one frame. Auto-refresh fires at half the cache TTL so
  // the overlay stays current without spamming the upstream.
  const [cloudsEnabled, setCloudsEnabled] = useState(prefs.clouds_enabled ?? false);
  // OpenWeatherMap clouds_new tiles are semi-transparent white — on
  // OSM's busy background they wash out at lower opacity. Default 0.85
  // makes the layer pop without fully hiding the base map; user can
  // dial down with the slider for subtle Dark-style maps.
  const [cloudsOpacity, setCloudsOpacity] = useState(prefs.clouds_opacity ?? 0.85);
  const [cloudsFrameIndex, setCloudsFrameIndex] = useState(0);
  const [cloudsPlaying, setCloudsPlaying] = useState(true);

  // Query runs unconditionally so the controls panel knows whether the
  // admin activated a provider — the toggle should appear before the
  // user clicks, not after. Backend keeps the response cheap when the
  // feature is disabled. The auto-refresh interval only kicks in once
  // the user actually enabled the overlay.
  const cloudsQuery = useQuery({
    queryKey: ["clouds-frames"],
    queryFn: () => clouds.frames(),
    refetchInterval: (q) => {
      const d = q.state.data as CloudFramesOut | undefined;
      if (!cloudsEnabled || !d || d.frames.length === 0) return false;
      return Math.max(60, d.cache_ttl_seconds / 2) * 1000;
    },
    refetchOnWindowFocus: false,
  });
  const cloudFrames = cloudsQuery.data?.frames ?? [];
  const activeCloudFrame =
    cloudFrames.length > 0
      ? cloudFrames[Math.min(cloudsFrameIndex, cloudFrames.length - 1)]
      : null;

  // Re-clamp the frame index whenever the frame list shrinks (e.g.
  // provider switched). Otherwise we'd render a stale frame.
  useEffect(() => {
    if (cloudFrames.length === 0) {
      setCloudsFrameIndex(0);
    } else if (cloudsFrameIndex >= cloudFrames.length) {
      setCloudsFrameIndex(cloudFrames.length - 1);
    }
  }, [cloudFrames.length, cloudsFrameIndex]);

  // Animation loop — only relevant for multi-frame providers. Cycle
  // forward every ~700 ms; pauses when user toggles play/pause or
  // scrubs the slider.
  useEffect(() => {
    if (!cloudsEnabled || !cloudsPlaying || cloudFrames.length < 2) return;
    const id = window.setInterval(() => {
      setCloudsFrameIndex((i) => (i + 1) % cloudFrames.length);
    }, 700);
    return () => window.clearInterval(id);
  }, [cloudsEnabled, cloudsPlaying, cloudFrames.length]);

  const [addPlaceMode, setAddPlaceMode] = useState(false);
  const [draftPlace, setDraftPlace] = useState<{ lat: number; lon: number } | null>(null);

  // After successful delete from PlaceDetailPanel, close the panel so
  // the user doesn't see a marker-less detail.
  useEffect(() => {
    function onDeleted(e: globalThis.Event) {
      const ev = e as CustomEvent<{ slug: string }>;
      if (selected && ev.detail.slug === selected.slug) setSelected(null);
    }
    window.addEventListener("astrozor:place-deleted", onDeleted as EventListener);
    return () => window.removeEventListener("astrozor:place-deleted", onDeleted as EventListener);
  }, [selected]);

  // Same pattern for events. EventDetailPanel emits this after the
  // owner confirms deletion so the panel disappears without us having
  // to thread an onClose callback through the React tree.
  useEffect(() => {
    function onDeleted(e: globalThis.Event) {
      const ev = e as CustomEvent<{ slug: string }>;
      if (selectedEventSlug && ev.detail.slug === selectedEventSlug) {
        setSelectedEventSlug(null);
      }
    }
    window.addEventListener("astrozor:event-deleted", onDeleted as EventListener);
    return () => window.removeEventListener("astrozor:event-deleted", onDeleted as EventListener);
  }, [selectedEventSlug]);

  // Keep `selected` in sync with the latest places query data. PlaceDetailPanel
  // receives `place` as a prop; without this, mutations like "add manual
  // Bortle reading" that invalidate ["places"] would refresh the list but
  // the detail panel would still show the stale snapshot it was opened with.
  // The Object.is check avoids needless re-renders when the same row is
  // returned (React Query is referentially stable per item).
  useEffect(() => {
    if (!selected) return;
    const fresh = placesQuery.data?.items.find((p) => p.slug === selected.slug);
    if (fresh && !Object.is(fresh, selected)) {
      setSelected(fresh);
    }
  }, [placesQuery.data, selected]);

  // Controlled view state — keeps camera position across mapStyle
  // changes. Without this, switching e.g. OSM → Satellite resets the
  // map to the initial view (regression: user lost their location).
  // Initial center is CR; saved map_preferences could later override.
  // (Declared above visiblePlaces/clustered so they can read it.)
  const [viewState, setViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  }>({ longitude: 15.4, latitude: 49.8, zoom: 6.5 });

  // Filter places before rendering
  const visiblePlaces = useMemo(() => {
    const items = placesQuery.data?.items ?? [];
    return items.filter((p) => {
      if (!enabledKinds.has(p.kind)) return false;
      if (stateFilter === "active" && p.active_checkin_count <= 0) return false;
      if (stateFilter === "subscribed" && !subscribedIds.has(p.slug)) return false;
      return true;
    });
  }, [placesQuery.data, enabledKinds, stateFilter, subscribedIds]);

  // Grid clustering — group nearby places into a single bubble when
  // they fall in the same ~50 px screen cell at the current zoom.
  // Recomputed when viewState (zoom/pan) or visiblePlaces change.
  // For ~hundreds of places this O(n) bucketing is fast enough; we
  // could swap in supercluster later if the dataset grows.
  const clustered = useMemo<Array<
    | { type: "place"; place: Place }
    | { type: "cluster"; lon: number; lat: number; places: Place[] }
  >>(() => {
    const map = mapRef.current?.getMap();
    if (!map || visiblePlaces.length === 0) {
      // Until the map is ready we just render every place ungrouped.
      return visiblePlaces.map((p) => ({ type: "place" as const, place: p }));
    }
    const CELL_PX = 50;
    const buckets: Record<string, Place[]> = {};
    for (const p of visiblePlaces) {
      const { x, y } = map.project([p.lon, p.lat]);
      const cellX = Math.floor(x / CELL_PX);
      const cellY = Math.floor(y / CELL_PX);
      const key = `${cellX}:${cellY}`;
      if (buckets[key]) buckets[key].push(p);
      else buckets[key] = [p];
    }
    const out: Array<
      | { type: "place"; place: Place }
      | { type: "cluster"; lon: number; lat: number; places: Place[] }
    > = [];
    for (const places of Object.values(buckets)) {
      if (places.length === 1) {
        out.push({ type: "place", place: places[0]! });
      } else {
        // Cluster center = centroid of contained places (simple mean of
        // lon/lat — fine for cells <~50 km wide; we never cluster
        // across continental gaps because they wouldn't share a cell).
        const lon = places.reduce((s, p) => s + p.lon, 0) / places.length;
        const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
        out.push({ type: "cluster", lon, lat, places });
      }
    }
    return out;
    // viewState is intentionally in deps so panning/zooming re-buckets.
  }, [visiblePlaces, viewState.longitude, viewState.latitude, viewState.zoom]);

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

  // Reset error count + warning when user manually picks a new style.
  // Also clamp the current zoom down to the new style's max — if the
  // user was at z18 on satellite (max 19) and switches to topo (max 17),
  // we drop to z17 so the topo tile server doesn't get hit with
  // out-of-range requests.
  const handleStyleChange = (k: StyleKey) => {
    errorCountRef.current[k] = 0;
    setTileWarning(null);
    setStyleKey(k);
    const cap = STYLE_MAX_ZOOM[k];
    setViewState((v) =>
      v.zoom > cap ? { ...v, zoom: cap } : v,
    );
  };

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-xl overflow-hidden ring-1 ring-slate-700">
      <Map
        ref={mapRef}
        mapStyle={styles[styleKey]}
        maxZoom={STYLE_MAX_ZOOM[styleKey]}
        {...viewState}
        onMove={(evt) =>
          setViewState({
            longitude: evt.viewState.longitude,
            latitude: evt.viewState.latitude,
            zoom: evt.viewState.zoom,
          })
        }
        style={{
          width: "100%",
          height: "100%",
          cursor: addPlaceMode ? "crosshair" : undefined,
        }}
        onClick={(e) => {
          if (!addPlaceMode || !me) return;
          setDraftPlace({ lat: e.lngLat.lat, lon: e.lngLat.lng });
          setAddPlaceMode(false);
        }}
      >
        <NavigationControl position="top-right" />
        {lpEnabled && cfgQuery.data?.light_pollution?.tile_url_template && (
          <Source
            id="light-pollution"
            key={cfgQuery.data.light_pollution.tile_url_template /* re-mount source when source changes */}
            type="raster"
            tiles={[cfgQuery.data.light_pollution.tile_url_template]}
            tileSize={256}
            attribution={
              cfgQuery.data.light_pollution.attribution ||
              "Night lights: NASA VIIRS DNB"
            }
          >
            <Layer
              id="light-pollution-layer"
              type="raster"
              paint={{ "raster-opacity": lpOpacity }}
            />
          </Source>
        )}
        {cloudsEnabled && activeCloudFrame && (
          /* Re-keyed per active frame URL so MapLibre tears down the
             prior raster source and fetches the new tiles when the
             animation steps forward. The source ID stays constant so
             the Layer reference doesn't break. `raster-contrast` boost
             makes OpenWeatherMap's washed-out semi-transparent clouds
             pop on busy backgrounds (OSM in particular); harmless for
             EUMETSAT IR which is already high-contrast. */
          <Source
            id="clouds"
            key={activeCloudFrame.tile_url_template}
            type="raster"
            tiles={[activeCloudFrame.tile_url_template]}
            tileSize={256}
            attribution={cloudsQuery.data?.attribution || ""}
          >
            <Layer
              id="clouds-layer"
              type="raster"
              paint={{
                "raster-opacity": cloudsOpacity,
                "raster-contrast": 0.4,
                "raster-saturation": 0.1,
              }}
            />
          </Source>
        )}
        {clustered.map((item, i) => {
          if (item.type === "cluster") {
            const hasActive = item.places.some((p) => p.active_checkin_count > 0);
            return (
              <Marker
                key={`cluster-${i}`}
                longitude={item.lon}
                latitude={item.lat}
                anchor="center"
                onClick={(e) => {
                  // Clicking a cluster zooms in by 2 levels at the
                  // cluster centroid — at higher zoom the same items
                  // spread across multiple cells and stop clustering.
                  e.originalEvent.stopPropagation();
                  mapRef.current?.flyTo({
                    center: [item.lon, item.lat],
                    zoom: Math.min(18, viewState.zoom + 2),
                    duration: 400,
                  });
                }}
              >
                <MapClusterMarker
                  count={item.places.length}
                  hasActive={hasActive}
                  testid={`cluster-${item.places.length}`}
                />
              </Marker>
            );
          }
          const p = item.place;
          return (
            <Marker
              key={p.id}
              longitude={p.lon}
              latitude={p.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                // Mutually exclusive panels: opening a place closes any
                // open event panel (and vice versa for events). They
                // share the same right-side slot, so showing both
                // overlapped would just hide the older one anyway.
                setSelectedEventSlug(null);
                setSelected(p);
              }}
            >
              <MapMarker
                kind={p.kind}
                active={p.active_checkin_count > 0}
                subscribed={subscribedIds.has(p.slug)}
                testid={`marker-${p.slug}`}
                ariaLabel={p.name}
              />
            </Marker>
          );
        })}
        {openEvents.map((ev) => (
          <Marker
            key={`event-${ev.id}`}
            longitude={ev._lon}
            latitude={ev._lat}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(null);
              setSelectedEventSlug(ev.slug);
            }}
          >
            <EventMarker
              event={ev}
              onClick={() => {
                setSelected(null);
                setSelectedEventSlug(ev.slug);
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
        pmtilesAvailable={!!pmtilesUrl}
        pmtilesTheme={pmtilesTheme}
        onPmtilesThemeChange={setPmtilesTheme}
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
        lpEnabled={lpEnabled}
        onLpToggle={() => setLpEnabled((v) => !v)}
        eventsEnabled={eventsEnabled}
        onEventsToggle={() => setEventsEnabled((v) => !v)}
        lpOpacity={lpOpacity}
        onLpOpacityChange={setLpOpacity}
        lightPollutionSource={cfgQuery.data?.light_pollution?.source ?? ""}
        lightPollutionDate={cfgQuery.data?.light_pollution?.dnb_date ?? ""}
        cloudsAvailable={!!cloudsQuery.data?.enabled}
        cloudsEnabled={cloudsEnabled}
        onCloudsToggle={() => setCloudsEnabled((v) => !v)}
        cloudsOpacity={cloudsOpacity}
        onCloudsOpacityChange={setCloudsOpacity}
        cloudsFrames={cloudFrames}
        cloudsFrameIndex={cloudsFrameIndex}
        onCloudsFrameChange={(i) => {
          setCloudsPlaying(false);
          setCloudsFrameIndex(i);
        }}
        cloudsPlaying={cloudsPlaying}
        onCloudsPlayToggle={() => setCloudsPlaying((v) => !v)}
        cloudsAttribution={cloudsQuery.data?.attribution ?? ""}
        cloudsProvider={cloudsQuery.data?.provider ?? "disabled"}
        onFly={handleFly}
        currentPrefs={
          me
            ? {
                style_key: styleKey,
                enabled_kinds: Array.from(enabledKinds),
                state_filter: stateFilter,
                lp_enabled: lpEnabled,
                lp_opacity: lpOpacity,
                pmtiles_theme: pmtilesTheme,
                events_enabled: eventsEnabled,
                clouds_enabled: cloudsEnabled,
                clouds_opacity: cloudsOpacity,
              }
            : null
        }
        canAddPlace={!!me}
        addPlaceMode={addPlaceMode}
        onToggleAddPlace={() => setAddPlaceMode((v) => !v)}
      />

      {draftPlace && me && (
        <PlaceFormModal
          mode="create"
          initial={{ lat: draftPlace.lat, lon: draftPlace.lon }}
          me={me}
          onClose={() => setDraftPlace(null)}
          onSaved={(p) => {
            setDraftPlace(null);
            setSelected(p);
          }}
        />
      )}
      {selectedEventSlug && (
        <EventDetailPanel
          slug={selectedEventSlug}
          me={me ?? null}
          onClose={() => setSelectedEventSlug(null)}
        />
      )}
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
  pmtilesAvailable,
  pmtilesTheme,
  onPmtilesThemeChange,
  enabledKinds,
  onKindToggle,
  stateFilter,
  onStateChange,
  lpEnabled,
  onLpToggle,
  eventsEnabled,
  onEventsToggle,
  lpOpacity,
  onLpOpacityChange,
  lightPollutionSource,
  lightPollutionDate,
  cloudsAvailable,
  cloudsEnabled,
  onCloudsToggle,
  cloudsOpacity,
  onCloudsOpacityChange,
  cloudsFrames,
  cloudsFrameIndex,
  onCloudsFrameChange,
  cloudsPlaying,
  onCloudsPlayToggle,
  cloudsAttribution,
  cloudsProvider,
  onFly,
  currentPrefs,
  canAddPlace,
  addPlaceMode,
  onToggleAddPlace,
}: {
  visibleCount: number;
  totalCount: number;
  loading: boolean;
  styleKey: StyleKey;
  onStyleChange: (k: StyleKey) => void;
  pmtilesAvailable: boolean;
  pmtilesTheme: PmtilesTheme;
  onPmtilesThemeChange: (t: PmtilesTheme) => void;
  enabledKinds: Set<Place["kind"]>;
  onKindToggle: (k: Place["kind"]) => void;
  stateFilter: StateFilter;
  onStateChange: (s: StateFilter) => void;
  lpEnabled: boolean;
  onLpToggle: () => void;
  eventsEnabled: boolean;
  onEventsToggle: () => void;
  lpOpacity: number;
  onLpOpacityChange: (v: number) => void;
  /** Active light-pollution engine — ``viirs_dnb_latest`` shows the
   *  daily VIIRS DNB composite, anything else falls back to the
   *  Black Marble 2016 baseline. Passed in from the parent so we
   *  don't re-fetch the map config inside ControlPanel. */
  lightPollutionSource: string;
  lightPollutionDate: string;
  /** Whether the admin has configured a clouds provider — when false
   *  the toggle is hidden so we don't show a feature the user can't
   *  use. */
  cloudsAvailable: boolean;
  cloudsEnabled: boolean;
  onCloudsToggle: () => void;
  cloudsOpacity: number;
  onCloudsOpacityChange: (v: number) => void;
  cloudsFrames: CloudFramesOut["frames"];
  cloudsFrameIndex: number;
  onCloudsFrameChange: (i: number) => void;
  cloudsPlaying: boolean;
  onCloudsPlayToggle: () => void;
  cloudsAttribution: string;
  cloudsProvider: string;
  onFly: (lat: number, lon: number, zoom?: number) => void;
  currentPrefs: MapPreferences | null;
  canAddPlace: boolean;
  addPlaceMode: boolean;
  onToggleAddPlace: () => void;
}) {
  const { t } = useTranslation();
  // Initialize collapsed so the map dominates on first paint. Users
  // expand the controls panel on demand; expansion state isn't
  // persisted between sessions intentionally — every page load starts
  // clean with the full map visible.
  const [open, setOpen] = useState(false);

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

        {canAddPlace && (
          <button
            type="button"
            onClick={onToggleAddPlace}
            data-testid="mapctl-add-place"
            className={`w-full px-2 py-1.5 rounded transition ${
              addPlaceMode
                ? "bg-emerald-600 hover:bg-emerald-500 text-white ring-1 ring-emerald-500"
                : "bg-slate-950 ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {addPlaceMode ? t("map.ctl.addPlaceCancel") : "+ " + t("map.ctl.addPlace")}
          </button>
        )}

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
            {/* Events sit here next to place kinds — all markers
                in one toggle group, since events are markers too. */}
            <li>
              <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={eventsEnabled}
                  onChange={onEventsToggle}
                  className="accent-indigo-500"
                  data-testid="mapctl-events-toggle"
                />
                <span className="text-sm" aria-hidden>📍</span>
                <span>{t("map.ctl.events")}</span>
              </label>
            </li>
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
          {pmtilesAvailable && styleKey === "osm" && (
            <div className="mt-2">
              <div className="text-[10px] text-slate-500 mb-1">
                {t("map.ctl.pmtilesTheme.label")}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(["dark", "light"] as PmtilesTheme[]).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => onPmtilesThemeChange(th)}
                    data-testid={`mapctl-pmtiles-theme-${th}`}
                    className={`px-2 py-1 rounded ring-1 transition ${
                      pmtilesTheme === th
                        ? "bg-indigo-600 ring-indigo-500 text-white"
                        : "bg-slate-950 ring-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {t(`map.ctl.pmtilesTheme.${th}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t("map.ctl.overlays")}
          </h3>
          <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
            <input
              type="checkbox"
              checked={lpEnabled}
              onChange={onLpToggle}
              className="accent-indigo-500"
              data-testid="mapctl-lp-toggle"
            />
            <span>{t("map.ctl.lightPollution")}</span>
          </label>
          {lpEnabled && (
            <div className="mt-2">
              <label className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                <span>{t("map.ctl.opacity")}</span>
                <span className="font-mono">{Math.round(lpOpacity * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={lpOpacity}
                onChange={(e) => onLpOpacityChange(Number(e.target.value))}
                className="w-full accent-indigo-500"
                data-testid="mapctl-lp-opacity"
              />
              {/* Show the engine that is actually active. The admin
                  may switch between Black Marble (2016 baseline) and
                  VIIRS DNB latest, so we read it from props (set by
                  the parent's map-config query). */}
              <p className="text-[10px] text-slate-500 mt-1">
                {lightPollutionSource === "viirs_dnb_latest"
                  ? t("map.ctl.lightPollutionHint.viirs_dnb_latest", {
                      date: lightPollutionDate || "?",
                    })
                  : t("map.ctl.lightPollutionHint.black_marble_2016")}
              </p>
            </div>
          )}

          {/* Cloud cover overlay — visible only when the admin has
              activated a provider on the backend. Otherwise hidden, so
              a regular user doesn't see a toggle that does nothing. */}
          {cloudsAvailable && (
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={cloudsEnabled}
                  onChange={onCloudsToggle}
                  className="accent-indigo-500"
                  data-testid="mapctl-clouds-toggle"
                />
                <span>{t("map.ctl.clouds")}</span>
              </label>
              {cloudsEnabled && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>{t("map.ctl.opacity")}</span>
                      <span className="font-mono">
                        {Math.round(cloudsOpacity * 100)}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={cloudsOpacity}
                      onChange={(e) =>
                        onCloudsOpacityChange(Number(e.target.value))
                      }
                      className="w-full accent-indigo-500"
                      data-testid="mapctl-clouds-opacity"
                    />
                  </div>
                  {cloudsFrames.length > 1 && (
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <button
                          type="button"
                          onClick={onCloudsPlayToggle}
                          className="text-slate-300 hover:text-slate-100"
                          data-testid="mapctl-clouds-play"
                        >
                          {cloudsPlaying ? "⏸" : "▶"}{" "}
                          {cloudsPlaying
                            ? t("map.ctl.cloudsPause")
                            : t("map.ctl.cloudsPlay")}
                        </button>
                        <span className="font-mono">
                          {cloudsFrameIndex + 1} / {cloudsFrames.length}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={cloudsFrames.length - 1}
                        step={1}
                        value={cloudsFrameIndex}
                        onChange={(e) =>
                          onCloudsFrameChange(Number(e.target.value))
                        }
                        className="w-full accent-indigo-500"
                        data-testid="mapctl-clouds-scrubber"
                      />
                      <p className="text-[10px] text-slate-500 mt-1 font-mono">
                        {new Date(
                          (cloudsFrames[cloudsFrameIndex]?.time ?? 0) * 1000,
                        ).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {cloudsFrames.length === 1 && (
                    <p className="text-[10px] text-slate-500">
                      {t("map.ctl.cloudsSingleFrame")}
                    </p>
                  )}
                  {styleKey === "osm" && (
                    <p className="text-[10px] text-amber-300/80">
                      {t("map.ctl.cloudsOsmHint")}
                    </p>
                  )}
                  {cloudsAttribution && (
                    <p className="text-[10px] text-slate-600">
                      {cloudsAttribution}
                    </p>
                  )}
                  {cloudsEnabled && cloudsFrames.length === 0 && (
                    <p className="text-[10px] text-amber-300">
                      {t("map.ctl.cloudsEmpty", { provider: cloudsProvider })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="px-3 py-2 border-t border-slate-800 text-[11px] text-slate-500 space-y-2">
        <div>
          {loading
            ? t("common.loading")
            : `${visibleCount} / ${totalCount} ${t("places.countSuffix")}`}
        </div>
        {currentPrefs && <SaveMapPrefsButton prefs={currentPrefs} />}
      </footer>
    </div>
  );
}

function SaveMapPrefsButton({ prefs }: { prefs: MapPreferences }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => auth.patchProfile({ map_preferences: prefs }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <button
      type="button"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      data-testid="mapctl-save-prefs"
      className="w-full px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-50 text-[11px]"
    >
      {mut.isPending
        ? t("common.loading")
        : mut.isSuccess
          ? "✓ " + t("map.ctl.savePrefsDone")
          : t("map.ctl.savePrefs")}
    </button>
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
      setQ(h.display_name.split(",")[0] ?? "");
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
