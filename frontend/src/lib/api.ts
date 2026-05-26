/**
 * Astrozor API client.
 * Uses fetch with credentials: 'include' so the session cookie travels on
 * every request (same-origin via Caddy proxy).
 */

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`API ${status}: ${detail}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const detail =
      json &&
      typeof json === "object" &&
      json !== null &&
      "detail" in json &&
      typeof (json as { detail: unknown }).detail === "string"
        ? (json as { detail: string }).detail
        : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

// ---- Typed endpoints ----

export type User = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  is_staff: boolean;
  created_at: string;
};

export type MapPreferences = {
  style_key?: "osm" | "dark" | "satellite" | "topo";
  enabled_kinds?: string[];
  state_filter?: "all" | "active" | "subscribed";
  lp_enabled?: boolean;
  lp_opacity?: number;
  pmtiles_theme?: "dark" | "light";
  events_enabled?: boolean;
  clouds_enabled?: boolean;
  clouds_opacity?: number;
};

export type Profile = {
  display_name: string;
  bio: string;
  avatar_url: string;
  club: string;
  equipment: string;
  language: string;
  timezone_name: string;
  location_lat: number | null;
  location_lon: number | null;
  location_label: string;
  location_visibility: "precise" | "region" | "hidden";
  discord_webhook_url: string;
  has_zenodo_token: boolean;
  zenodo_use_sandbox: boolean;
  mastodon_autopost_checkin: boolean;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  onboarding_completed: boolean;
  map_preferences: MapPreferences;
  // Timezone display preferences — every datetime in the UI can render
  // up to 3 lines (UTC / local-to-the-entity / user's own TZ).
  // `timezone_name` is the IANA name of the user's preferred TZ.
  show_utc: boolean;
  show_local: boolean;
  show_user: boolean;
};

export type Identity = {
  id: string;
  provider: "github" | "google" | "mastodon" | "discord" | "gitlab" | "facebook";
  provider_user_id: string;
  provider_username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  has_token: boolean;
  last_login_at: string | null;
  created_at: string;
  // Only populated for Discord — the server (guild) the user installed
  // the Astrozor Events bot into during the combined OAuth flow.
  discord_guild_id: string;
  discord_guild_name: string;
};

export type Me = { user: User; profile: Profile };

export type ProfilePatch = Partial<Profile> & {
  zenodo_token?: string;
};

export const auth = {
  signup: (email: string, password: string, display_name = "") =>
    api.post<User>("/auth/signup", { email, password, display_name }),
  login: (email: string, password: string) => api.post<User>("/auth/login", { email, password }),
  logout: () => api.post<{ status: string }>("/auth/logout"),
  me: () => api.get<Me>("/auth/me"),
  magicLink: (email: string) =>
    api.post<{ status: string; detail: string }>("/auth/magic-link", { email }),
  resendVerification: () =>
    api.post<{ status: string; detail: string }>("/auth/resend-verification"),
  oauthProviders: () =>
    api.get<{
      github: boolean;
      google: boolean;
      gitlab: boolean;
      facebook: boolean;
      discord: boolean;
      zooniverse: boolean;
      mastodon: boolean;
    }>("/auth/providers"),
  registerMastodon: (instanceUrl: string) =>
    api.post<{ instance_url: string; name: string; start_url: string }>(
      "/auth/mastodon/register",
      { instance_url: instanceUrl },
    ),
  patchProfile: (patch: ProfilePatch) => api.patch<Me>("/accounts/profile", patch),
  listIdentities: () => api.get<Identity[]>("/accounts/identities"),
  disconnectIdentity: (id: string) => api.del<void>(`/accounts/identities/${id}`),
};

// ---- Public profile lookup (any authenticated user → read-only modal) ----

export type PublicProfile = {
  id: string;
  display_name: string;
  bio: string;
  club: string;
  equipment: string;
  avatar_url: string;
  language: string;
  location_label: string;
  location_visibility: "precise" | "region" | "hidden";
  created_at: string;
};

export type UserListItem = {
  email: string;
  display_name: string;
  avatar_url: string;
};

export const users = {
  profileByEmail: (email: string) =>
    api.get<PublicProfile>(`/users/profile/${encodeURIComponent(email)}`),
  /**
   * Compact list of active users for owner-managed allowlist pickers
   * (Place / Event editors). Server caps at 500. `q` is a case-
   * insensitive substring match across email + display name.
   */
  list: (q: string = "") => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return api.get<UserListItem[]>(`/users${qs}`);
  },
};

// ---- API tokens (for RStudio addin / VS Code extension / CLI) ----

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ApiTokenCreated = ApiToken & {
  token: string; // plaintext — shown once on creation only
};

export const apiTokens = {
  list: () => api.get<ApiToken[]>("/accounts/tokens"),
  create: (name: string, scopes: string[] = ["publish:articles"]) =>
    api.post<ApiTokenCreated>("/accounts/tokens", { name, scopes }),
  revoke: (id: string) => api.del<void>(`/accounts/tokens/${id}`),
};

// ---- Quarto bundle import (browser fallback when no RStudio) ----

export type QuartoPublishResult = {
  article_slug: string;
  article_id: string;
  status: string;
  url: string;
  asset_url: string;
};

export type RPackageInfo = {
  package: string;
  version: string;
  repos_url: string;
  install_command: string;
};

export const rPackage = {
  info: () => api.get<RPackageInfo>("/r-pkg/info"),
};

export type VscodeExtensionInfo = {
  name: string;
  version: string;
  vsix_latest_url: string;
  vsix_versioned_url: string;
  install_command: string;
};

export const vscodeExtension = {
  info: () => api.get<VscodeExtensionInfo>("/vscode-pkg/info"),
};

export type DocPageMeta = {
  slug: string;
  lang: string;
  title: string;
  section: string;
  order: number;
  icon: string;
};

export type DocsList = {
  lang: string;
  available_langs: string[];
  pages: DocPageMeta[];
};

export type DocPage = DocPageMeta & {
  content_html: string;
  fallback_used: boolean;
};

export const docs = {
  list: (lang: string) =>
    api.get<DocsList>(`/help?lang=${encodeURIComponent(lang)}`),
  get: (slug: string, lang: string) =>
    api.get<DocPage>(`/help/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`),
};

export async function publishQuartoBundle(opts: {
  bundle: File;
  title: string;
  slug?: string | undefined;
  summary?: string | undefined;
  language?: string | undefined;
  engine?: "quarto" | "rmarkdown" | "jupyter" | undefined;
  license?: string | undefined;
}): Promise<QuartoPublishResult> {
  // Browser flow uses the SESSION cookie, not a token — so the same
  // endpoint must accept either auth scheme. Today /publish/quarto uses
  // token_auth only; for the browser fallback we POST via fetch with
  // credentials. (If the server returns 401 we tell the user to log
  // in.) Token flow remains the primary RStudio path.
  const fd = new FormData();
  fd.append("bundle", opts.bundle);
  fd.append("title", opts.title);
  if (opts.slug) fd.append("slug", opts.slug);
  if (opts.summary) fd.append("summary", opts.summary);
  if (opts.language) fd.append("language", opts.language);
  if (opts.engine) fd.append("engine", opts.engine);
  if (opts.license) fd.append("license", opts.license);
  fd.append("published_via", "web");
  const res = await fetch(BASE + "/publish/quarto", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const detail =
      parsed &&
      typeof parsed === "object" &&
      parsed !== null &&
      "detail" in parsed &&
      typeof (parsed as { detail: unknown }).detail === "string"
        ? (parsed as { detail: string }).detail
        : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return parsed as QuartoPublishResult;
}

// ---- Uploads ----

export type UploadResult = {
  id: string;
  url: string;
  size_bytes: number;
  mime: string;
};

async function _uploadFile(endpoint: string, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(BASE + endpoint, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not json
  }
  if (!res.ok) {
    const detail =
      parsed &&
      typeof parsed === "object" &&
      parsed !== null &&
      "detail" in parsed &&
      typeof (parsed as { detail: unknown }).detail === "string"
        ? (parsed as { detail: string }).detail
        : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return parsed as UploadResult;
}

export const uploads = {
  /**
   * Upload an image. Returns the public URL the editor (or any other
   * caller) can embed. Multipart form-data; the session cookie travels
   * via `credentials: include` automatically.
   */
  image: (file: File) => _uploadFile("/uploads/image", file),
  /**
   * Upload an image or short video (≤50 MiB for video) as a media
   * attachment. The returned URL is what the chat attaches.
   */
  media: (file: File) => _uploadFile("/uploads/media", file),
  /**
   * Upload an article cover. Server resizes to max 1600 px wide and
   * re-encodes as JPEG. URL goes into `article.cover_image_url`.
   */
  articleCover: (file: File) => _uploadFile("/uploads/article-cover", file),
};

// ---- Geocoding (Nominatim proxy) ----

export type GeocodeHit = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  type?: string;
};

export type GeocodeResponse = {
  items: GeocodeHit[];
  cached: boolean;
  detail?: string;
};

export const geocoding = {
  search: (q: string, limit = 6, lang = "cs,en") => {
    const search = new URLSearchParams({
      q,
      limit: String(limit),
      lang,
    });
    return api.get<GeocodeResponse>(`/geocode?${search.toString()}`);
  },
  /** SRTM-30m elevation in meters for a GPS coord. Server proxies +
   * caches open-elevation.com so the browser never hits the upstream. */
  elevation: (lat: number, lon: number) =>
    api.get<{ elevation_m: number; cached: boolean }>(
      `/geocode/elevation?lat=${lat}&lon=${lon}`,
    ),
};

// ---- Admin: self-hosted map infra ----

export type MapInfraStatus = "idle" | "running" | "error";

export type MapInfraOut = {
  pmtiles: {
    path: string;
    source_url: string;
    size_bytes: number;
    last_update: string | null;
    status: MapInfraStatus;
    status_message: string;
    job_id: string;
    available: boolean;
    live_progress: {
      bytes_written: number;
      total_bytes: number;
    } | null;
    latest: {
      url: string;
      key: string;
      size_bytes: number;
      uploaded: string | null;
    } | null;
  };
  photon: {
    url: string;
    last_import: string | null;
    status: MapInfraStatus;
    status_message: string;
    imported_size_mb: number;
    available: boolean;
    live_progress: {
      phase: "downloading" | "extracting" | "ready" | "running" | "stopped";
      label: string;
      bytes_written?: number;
      total_bytes?: number;
      eta?: string;
    } | null;
  };
  tile_backend: "osm" | "pmtiles";
  search_backend: "nominatim" | "photon";
  chat: {
    text_max_length: number;
  };
  light_pollution: {
    source: "black_marble_2016" | "viirs_dnb_latest";
    dnb_date: string;
    last_check: string | null;
    status_message: string;
    tile_url_template: string;
    black_marble: {
      status: MapInfraStatus;
      status_message: string;
      tile_count: number;
      size_bytes: number;
      last_update: string | null;
      cached: boolean;
    };
    viirs_dnb: {
      status: MapInfraStatus;
      status_message: string;
      tile_count: number;
      size_bytes: number;
      last_update: string | null;
      cached: boolean;
      cached_date: string;
    };
  };
  updated_at: string;
};

export type MapConfig = {
  tile_backend: "osm" | "pmtiles";
  search_backend: "nominatim" | "photon";
  pmtiles_url: string | null;
  photon_url: string | null;
  light_pollution: {
    source: "black_marble_2016" | "viirs_dnb_latest";
    dnb_date: string;
    tile_url_template: string;
    attribution: string;
  };
};

export const admin = {
  getMapInfra: () => api.get<MapInfraOut>("/admin/map-infra"),
  triggerPmtilesDownload: (source_url?: string) =>
    api.post<{ job_id: string; status: string }>("/admin/map-infra/pmtiles/download", {
      source_url: source_url ?? null,
    }),
  probePhoton: () =>
    api.post<{ job_id: string; status: string }>("/admin/map-infra/photon/probe"),
  switchBackends: (data: {
    tile_backend?: "osm" | "pmtiles";
    search_backend?: "nominatim" | "photon";
  }) => api.post<MapInfraOut>("/admin/map-infra/switch", data),
  setLightPollutionSource: (source: "black_marble_2016" | "viirs_dnb_latest") =>
    api.post<MapInfraOut>("/admin/map-infra/light-pollution/source", { source }),
  refreshLightPollutionLatest: () =>
    api.post<MapInfraOut>("/admin/map-infra/light-pollution/refresh", {}),
  estimateLpDownloadSize: (source: "black_marble_2016" | "viirs_dnb_latest") =>
    api.get<{
      source: string;
      bbox: number[];
      zoom_min: number;
      zoom_max: number;
      total_tiles: number;
      total_bytes_estimate: number;
      per_zoom: { zoom: number; tiles: number; avg_tile_bytes: number; total_bytes_est: number }[];
    }>(`/admin/map-infra/light-pollution/${source}/estimate-size`),
  triggerLpDownload: (source: "black_marble_2016" | "viirs_dnb_latest") =>
    api.post<{ job_id: string; status: string }>(
      `/admin/map-infra/light-pollution/${source}/download`,
      {},
    ),
  deletePmtiles: () =>
    api.del<{ deleted: boolean; bytes_freed: number }>("/admin/map-infra/pmtiles"),
  deletePhoton: () =>
    api.del<{ reset: boolean; detail: string }>("/admin/map-infra/photon"),
  deleteLpTiles: (source: "black_marble_2016" | "viirs_dnb_latest") =>
    api.del<{ deleted: boolean; bytes_freed: number }>(
      `/admin/map-infra/light-pollution/${source}`,
    ),
  updateChatSettings: (text_max_length: number) =>
    api.patch<MapInfraOut>("/admin/map-infra/chat/settings", { text_max_length }),
  listPlaces: (q = "") =>
    api.get<AdminPlace[]>(`/admin/places${q ? "?q=" + encodeURIComponent(q) : ""}`),
  /** Returns a CSV blob URL ready for download. */
  exportPlacesCsvUrl: () => `${BASE}/admin/places/export.csv`,
  importPlacesPreview: async (file: File): Promise<ImportPreviewOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE}/admin/places/import-preview`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new ApiError(res.status, (parsed && parsed.detail) || res.statusText);
    }
    return parsed as ImportPreviewOut;
  },
  importPlacesCommit: (rows: ImportRowDecision[]) =>
    api.post<{ created: string[]; failed: { row_index: number; error: string }[]; created_count: number }>(
      "/admin/places/import-commit",
      { rows },
    ),
};

export type AdminPlace = {
  id: string;
  slug: string;
  name: string;
  kind: Place["kind"];
  status: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  bortle_class_manual: number | null;
  bortle_class_map: number | null;
  owner_email: string;
  created_at: string;
};

export type ImportPreviewRow = {
  row_index: number;
  name: string;
  kind: string;
  lat: number | null;
  lon: number | null;
  description: string;
  address: string;
  website: string;
  elevation_m: number | null;
  bortle_manual: number | null;
  owner_email: string;
  duplicates: { slug: string; name: string; distance_m: number }[];
  errors: string[];
};

export type ImportPreviewOut = {
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    new: number;
    duplicates: number;
    errors: number;
    duplicate_radius_m: number;
  };
};

export type ImportRowDecision = {
  row_index: number;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  description?: string;
  address?: string;
  website?: string;
  contact?: string;
  opening_hours?: string;
  elevation_m?: number | null;
  bortle_manual?: number | null;
  owner_email?: string;
};

export const mapConfig = {
  get: () => api.get<MapConfig>("/map/config"),
};

// ---- Clouds overlay (provider-agnostic) ----

export type CloudFrame = {
  time: number;
  tile_url_template: string;
};

export type CloudFramesOut = {
  enabled: boolean;
  provider: "disabled" | "openweathermap" | "eumetsat";
  frames: CloudFrame[];
  attribution: string;
  opacity_default: number;
  fetched_at: number;
  cache_ttl_seconds: number;
};

export type CloudsAdminOut = {
  enabled: boolean;
  provider: "disabled" | "openweathermap" | "eumetsat";
  provider_choices: { value: string; label: string }[];
  frame_count: number;
  cache_ttl_seconds: number;
  opacity_default: number;
  openweathermap_api_key_set: boolean;
  eumetsat_consumer_key_set: boolean;
  eumetsat_consumer_secret_set: boolean;
};

export type CloudsAdminPatch = Partial<{
  enabled: boolean;
  provider: "disabled" | "openweathermap" | "eumetsat";
  frame_count: number;
  cache_ttl_seconds: number;
  opacity_default: number;
  openweathermap_api_key: string;
  eumetsat_consumer_key: string;
  eumetsat_consumer_secret: string;
}>;

export const clouds = {
  frames: () => api.get<CloudFramesOut>("/clouds/frames"),
};

export const adminClouds = {
  get: () => api.get<CloudsAdminOut>("/admin/clouds"),
  patch: (data: CloudsAdminPatch) => api.patch<CloudsAdminOut>("/admin/clouds", data),
};

// ---- Admin: user management ----

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
  is_superuser: boolean;
  is_active: boolean;
  email_verified: boolean;
  last_login: string | null;
  last_login_ip: string;
  last_login_country: string;
  last_login_country_code: string;
  last_login_city: string;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  created_at: string;
};

export const adminUsers = {
  list: (q = "") => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return api.get<AdminUser[]>(`/admin/users${qs}`);
  },
  patch: (id: string, data: { is_active?: boolean; is_staff?: boolean }) =>
    api.patch<AdminUser>(`/admin/users/${id}`, data),
};

// ---- Discord notification preferences ----

export type DiscordPrefKind =
  | "place_followed_checkin"
  | "place_any_checkin"
  | "article_published"
  | "event_status_changed"
  | "project_lifecycle"
  | "campaign_status_changed";

export type DiscordPref = {
  id: string;
  kind: DiscordPrefKind;
  enabled: boolean;
  filters: Record<string, unknown>;
  updated_at: string;
};

export type LookupUser = { email: string; display_name: string };
export type LookupTitled = { slug: string; title: string; status: string };

export const discordPrefs = {
  list: () => api.get<DiscordPref[]>("/notifications/discord-prefs"),
  upsert: (kind: DiscordPrefKind, data: { enabled: boolean; filters: Record<string, unknown> }) =>
    api.put<DiscordPref>(`/notifications/discord-prefs/${kind}`, data),
  remove: (kind: DiscordPrefKind) => api.del<void>(`/notifications/discord-prefs/${kind}`),
};

export const lookups = {
  users: (q = "", limit = 20) => {
    const search = new URLSearchParams({ q, limit: String(limit) });
    return api.get<LookupUser[]>(`/lookup/users?${search.toString()}`);
  },
  events: (q = "", limit = 20) => {
    const search = new URLSearchParams({ q, limit: String(limit) });
    return api.get<LookupTitled[]>(`/lookup/events?${search.toString()}`);
  },
  campaigns: (q = "", limit = 20) => {
    const search = new URLSearchParams({ q, limit: String(limit) });
    return api.get<LookupTitled[]>(`/lookup/campaigns?${search.toString()}`);
  },
};

// ---- Mastodon timeline ----

export type MastoStatus = {
  id: string;
  url: string;
  created_at: string;
  content_text: string;
  content_html: string;
  spoiler_text: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  tags: string[];
  media: {
    url: string;
    preview_url: string;
    type: string;
    description: string;
  }[];
  card: {
    url: string;
    title: string;
    description: string;
    image: string | null;
    provider_name: string;
    author_name: string;
    type: string;
  } | null;
  account: {
    acct: string;
    display_name: string;
    avatar: string;
    url: string;
  };
  // Set when this entry was a reblog (boost) by another account — the
  // payload has already been unwrapped server-side to the original
  // toot's content. The field carries who boosted so the UI can show
  // "🔁 Boosted by X" above the original.
  boosted_by: {
    acct: string;
    display_name: string;
    avatar: string;
  } | null;
};

export type MastoTimeline = {
  items: MastoStatus[];
  instance?: string;
  detail?: string;
};

export type MastoPostResult = {
  url: string;
  id: string;
  created_at: string;
};

export const mastodon = {
  timeline: (kind: "home" | "hashtag" | "public" = "home", tag = "", limit = 20) => {
    const search = new URLSearchParams({
      kind,
      tag,
      limit: String(limit),
    });
    return api.get<MastoTimeline>(`/mastodon/timeline?${search.toString()}`);
  },
  post: (data: {
    status: string;
    visibility?: "public" | "unlisted" | "private" | "direct";
    spoiler_text?: string;
  }) => api.post<MastoPostResult>("/mastodon/post", data),
};

export const meta = {
  healthz: () => api.get<{ status: string; version: string; database: string }>("/healthz"),
  readyz: () => api.get<{ status: string; version: string; database: string }>("/readyz"),
};

// ---- Places ----

export type OpeningDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type OpeningSchedule = Partial<
  Record<
    OpeningDayKey,
    {
      intervals: [string, string][]; // [["08:00","12:00"], ["13:00","17:00"]]
      auto_checkin: boolean;
    }
  >
>;

export type Place = {
  id: string;
  slug: string;
  name: string;
  kind:
    | "observatory_public"
    | "observatory_private"
    | "spot_permanent"
    | "spot_temporary";
  status: string;
  description: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  address: string;
  website: string;
  contact: string;
  opening_hours: string;
  bortle_class: number | null;  // deprecated — use bortle_class_manual / bortle_class_map
  bortle_class_manual: number | null;
  bortle_class_map: number | null;
  bortle_class_map_source: string;
  bortle_class_map_updated_at: string | null;
  opening_hours_schedule: OpeningSchedule;
  valid_from: string | null;
  valid_to: string | null;
  owner_email: string;
  active_checkin_count: number;
  // Visibility — see apps/core/visibility.py for the 4-level system.
  // `discussion_visibility` empty string means "inherit from visibility".
  visibility: VisibilityLevel;
  allowed_user_emails: string[];
  discussion_visibility: "" | VisibilityLevel;
  discussion_allowed_user_emails: string[];
  // IANA timezone resolved from lat/lon (e.g. "Europe/Prague").
  // Empty when coordinates are missing. Used for the "Local time"
  // display in TimeDisplay component.
  timezone: string;
};

// Shared visibility enum — reused by Place, Event (and Project/Campaign
// once those agendas adopt the same permission system).
export type VisibilityLevel = "public" | "members" | "allowlist" | "private";

export type PlaceCreateIn = {
  name: string;
  kind: Place["kind"];
  description?: string;
  lat: number;
  lon: number;
  elevation_m?: number | null;
  address?: string;
  website?: string;
  contact?: string;
  opening_hours?: string;
  opening_hours_schedule?: OpeningSchedule;
  bortle_class?: number | null;
  valid_to?: string | null;
  visibility?: VisibilityLevel;
  allowed_user_emails?: string[];
  discussion_visibility?: "" | VisibilityLevel;
  discussion_allowed_user_emails?: string[];
};

export type PlacePatchIn = Partial<PlaceCreateIn>;

export type BortleEstimate = {
  bortle_class: number;
  luminance: number;
  source: string;
};

export type BortleHistoryItem = {
  id: string;
  value: number;
  source: "manual" | "viirs_black_marble" | "viirs_dnb_latest";
  measured_at: string;
  notes: string;
  luminance: number | null;
  submitted_by_email: string;
  created_at: string;
};

export type BortleHistoryOut = {
  active: number | null;
  items: BortleHistoryItem[];
};

export const places = {
  list: (params?: { bbox?: string; kind?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.bbox) search.set("bbox", params.bbox);
    if (params?.kind) search.set("kind", params.kind);
    if (params?.q) search.set("q", params.q);
    const qs = search.toString();
    return api.get<{ count: number; items: Place[] }>(`/places${qs ? "?" + qs : ""}`);
  },
  get: (slug: string) => api.get<Place>(`/places/${slug}`),
  create: (body: PlaceCreateIn) => api.post<Place>("/places", body),
  patch: (slug: string, body: PlacePatchIn) => api.patch<Place>(`/places/${slug}`, body),
  remove: (slug: string) => api.del<void>(`/places/${slug}`),
  /** Estimate Bortle from a free-form GPS coord without touching any place. */
  estimateBortle: (lat: number, lon: number) =>
    api.post<BortleEstimate>("/places/estimate-bortle", { lat, lon }),
  /** Estimate Bortle for an existing place and persist it on the row. */
  estimateBortleForPlace: (slug: string) =>
    api.post<Place>(`/places/${slug}/estimate-bortle`, {}),
  /** Read the Bortle measurement history for a place. */
  bortleHistory: (slug: string) =>
    api.get<BortleHistoryOut>(`/places/${slug}/bortle`),
  /** Submit a manual Bortle reading for a place. */
  addBortleManual: (
    slug: string,
    body: { value: number; measured_at?: string; notes?: string },
  ) => api.post<BortleHistoryItem>(`/places/${slug}/bortle`, body),
};

// ---- Chat (per-place REST + client polling) ----

export type ZooniverseSubjectMedia = {
  url: string;
  mime: string;
};

export type ChatAttachment = {
  kind: "image" | "video" | "youtube" | "zoo_subject";
  url: string;
  mime?: string;
  title?: string;
  video_id?: string;
  // zoo_subject only
  subject_id?: string;
  project_zid?: number;
  /** New canonical shape — each item carries its MIME so the
   *  renderer can pick <img>/<video>/<audio>. */
  media?: ZooniverseSubjectMedia[];
  /** Legacy / fallback URL list (existing stored attachments may
   *  not have MIME). Frontend guesses from extension. */
  locations?: string[];
  classify_url?: string;
  talk_url?: string;
};

export type ChatMessage = {
  id: string;
  /** Exactly one of {place_slug, sprint_slug, (repo_id+issue_number)}
   *  is non-empty. */
  place_slug: string;
  sprint_slug: string;
  repo_id: string;
  issue_number: number | null;
  parent_id: string | null;
  user_display_name: string;
  user_email: string;
  text: string;
  attachments: ChatAttachment[];
  created_at: string;
  /** Non-null when the owner has edited this message at least once. */
  edited_at: string | null;
};

export type ChatPostBody = {
  text?: string;
  attachments?: ChatAttachment[];
  parent_id?: string | null;
};

export const chat = {
  list: (placeSlug: string) =>
    api.get<{ count: number; items: ChatMessage[] }>(`/places/${placeSlug}/chat`),
  post: (placeSlug: string, body: ChatPostBody) =>
    api.post<ChatMessage>(`/places/${placeSlug}/chat`, body),
  /** Owner-only edit. Works for both place and sprint scopes — the
   *  message ID alone identifies the scope. */
  edit: (id: string, body: { text?: string; attachments?: ChatAttachment[] }) =>
    api.patch<ChatMessage>(`/messages/${id}`, body),
  remove: (id: string) => api.del<void>(`/messages/${id}`),
};

// ---- Presence (check-ins) ----

export type Checkin = {
  id: string;
  user_email: string | null;
  display_name: string;
  comment: string;
  anonymous: boolean;
  /** True when the check-in belongs to the requesting user. Set even
   *  for `anonymous=true` rows so the owner sees the End button on
   *  their own anonymous check-in. */
  is_mine: boolean;
  place_slug: string;
  created_at: string;
  expires_at: string;
};

export const presence = {
  get: (placeSlug: string) =>
    api.get<{ place_slug: string; count: number; checkins: Checkin[] }>(
      `/places/${placeSlug}/presence`,
    ),
  checkin: (
    placeSlug: string,
    opts?: { comment?: string; anonymous?: boolean; expires_in_hours?: number },
  ) =>
    api.post<Checkin>(`/places/${placeSlug}/checkin`, {
      comment: opts?.comment ?? "",
      anonymous: opts?.anonymous ?? false,
      expires_in_hours: opts?.expires_in_hours ?? 4,
    }),
  end: (id: string) => api.del<void>(`/checkins/${id}`),
};

// ---- Articles ----

export type ArticleListItem = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  engine: "markdown" | "quarto" | "rmarkdown" | "jupyter";
  language: string;
  status: string;
  author_display_name: string;
  author_email: string;
  doi: string;
  published_at: string | null;
  created_at: string;
  tags: string[];
  cover_image_url: string;
  visibility: "public" | "members";
  reading_minutes: number;
};

export type Article = ArticleListItem & {
  engine: string;
  author_email: string;
  license: string;
  content_md: string;
  content_html: string;
  // Empty for inline-markdown articles. For pre-rendered Quarto/RMarkdown
  // /Jupyter bundles this is the iframe src — e.g. "/media/quarto/<u>/<s>/index.html".
  asset_url: string;
  published_via: "web" | "rstudio" | "vscode" | "api";
  updated_at: string;
  tags: string[];
};

export type Comment = {
  id: string;
  article_slug: string;
  parent_id: string | null;
  user_display_name: string;
  user_email: string;
  text: string;
  attachments: ChatAttachment[];
  created_at: string;
};

export type CommentPostBody = {
  text?: string;
  attachments?: ChatAttachment[];
  parent_id?: string | null;
};

export const articles = {
  list: (params?: { language?: string; author?: string }) => {
    const search = new URLSearchParams();
    if (params?.language) search.set("language", params.language);
    if (params?.author) search.set("author", params.author);
    const qs = search.toString();
    return api.get<{ count: number; items: ArticleListItem[] }>(
      `/articles${qs ? "?" + qs : ""}`,
    );
  },
  get: (slug: string) => api.get<Article>(`/articles/${slug}`),
  create: (data: {
    title: string;
    summary?: string;
    content_md: string;
    language?: string;
    tags?: string[];
    cover_image_url?: string;
    visibility?: "public" | "members";
  }) => api.post<Article>("/articles", data),
  patch: (
    slug: string,
    data: Partial<{
      title: string;
      summary: string;
      content_md: string;
      language: string;
      tags: string[];
      cover_image_url: string;
      visibility: "public" | "members";
    }>,
  ) => api.patch<Article>(`/articles/${slug}`, data),
  publish: (slug: string, options?: { mint_doi?: boolean }) =>
    api.post<Article>(`/articles/${slug}/publish`, { mint_doi: !!options?.mint_doi }),
  remove: (slug: string) => api.del<void>(`/articles/${slug}`),
  comments: (slug: string) =>
    api.get<{ count: number; items: Comment[] }>(`/articles/${slug}/comments`),
  postComment: (slug: string, body: CommentPostBody) =>
    api.post<Comment>(`/articles/${slug}/comments`, body),
  deleteComment: (id: string) => api.del<void>(`/comments/${id}`),
};

// ---- Notifications ----

export type Notification = {
  id: string;
  kind: string;
  source_kind: string;
  source_id: string;
  title: string;
  body: string;
  link: string;
  created_at: string;
  read_at: string | null;
};

export type NotificationList = {
  count: number;
  unread_count: number;
  items: Notification[];
};

export type Subscription = {
  id: string;
  kind: string;
  target_id: string;
  created_at: string;
};

export const notifications = {
  list: (params?: { only_unread?: boolean; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.only_unread) search.set("only_unread", "true");
    if (params?.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return api.get<NotificationList>(`/notifications${qs ? "?" + qs : ""}`);
  },
  markRead: (id: string) => api.post<Notification>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ marked: number }>("/notifications/read-all"),
};

export const subscriptions = {
  list: () => api.get<Subscription[]>("/subscriptions"),
  create: (target_id: string, kind = "place") =>
    api.post<Subscription>("/subscriptions", { kind, target_id }),
  remove: (id: string) => api.del<void>(`/subscriptions/${id}`),
};

// ---- Projects ----

export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "private" | "internal";
  status: string;
  language: string;
  created_by_email: string;
  member_count: number;
  repo_count: number;
  created_at: string;
  tags: string[];
  /** True when the caller is in the project's Membership table. */
  is_member: boolean;
  /** True when the caller can edit (creator or staff). */
  can_edit: boolean;
};

export type ProjectMember = {
  user_email: string;
  user_display_name: string;
  avatar_url: string;
  role: "owner" | "maintainer" | "contributor" | "observer";
  joined_at: string;
  is_creator: boolean;
};

export type GHContributor = {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
};

export type GHRepo = {
  id: string;
  project_slug: string;
  full_name: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  open_issues: number;
  default_branch: string;
  last_commit_at: string | null;
  html_url: string;
  last_fetched_at: string | null;
  last_status: string;
  last_release_tag: string;
  last_release_name: string;
  last_release_at: string | null;
  last_release_url: string;
  top_contributors: GHContributor[];
  topics: string[];
};

export type GHIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  comments: number;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string; html_url: string }[];
  created_at: string;
  updated_at: string;
};

export type GHUser = {
  login: string;
  avatar_url: string;
  html_url: string;
};

export type GHIssueComment = {
  id: number;
  body_html: string;
  user: GHUser;
  created_at: string | null;
  updated_at: string | null;
  html_url: string;
};

export type GHIssueDetail = {
  status: string;
  number: number;
  title: string;
  state: string;
  body_html: string;
  html_url: string;
  user: GHUser;
  labels: { name: string; color: string }[];
  assignees: GHUser[];
  milestone: string;
  created_at: string | null;
  updated_at: string | null;
  comments_count: number;
  comments: GHIssueComment[];
};

export type GHActivityBucket = { date: string; count: number };

export type GHActivity = {
  days: number;
  total_commits: number;
  buckets: GHActivityBucket[];
};

/** User-facing ticket kind for "open new issue" form. Backend
 *  translates this into the appropriate GitHub labels. */
export type GHIssueType = "bug" | "feature" | "task";

/** Response from POST /repos/{id}/issues — ``status`` mirrors what
 *  GitHub returned (``ok`` / ``no_token`` / ``http_NNN`` / ``error``)
 *  so the dialog can show a connect-GH prompt when relevant. */
export type GHIssueCreateResult = {
  status: string;
  number?: number;
  html_url?: string;
  detail?: string;
};

/** Response from POST /repos/{id}/issues/{n}/assign. Status values:
 *  - ok: the caller is now in the issue's assignees list
 *  - not_collaborator: GH accepted the call but dropped the assignee
 *    (caller doesn't have write access to the repo)
 *  - no_token / no_identity: caller hasn't connected GitHub
 *  - http_NNN / error: GitHub HTTP failure */
export type GHIssueAssignResult = {
  status: string;
  assignees?: string[];
  detail?: string;
};

/** One row of the GH user open-issue leaderboard, joined with
 *  Astrozor identities when present. */
export type IssueLeaderboardEntry = {
  gh_login: string;
  gh_avatar: string;
  gh_html_url: string;
  astrozor_display_name: string;
  astrozor_email: string;
  open_issue_count: number;
};

export type GHIssueClaim = {
  status: string;
  html_url?: string;
  detail?: string;
};

export const projects = {
  list: () => api.get<Project[]>("/projects"),
  get: (slug: string) => api.get<Project>(`/projects/${slug}`),
  create: (data: {
    name: string;
    description?: string;
    visibility?: "public" | "private" | "internal";
    language?: string;
    tags?: string[];
  }) => api.post<Project>("/projects", data),
  patch: (
    slug: string,
    data: Partial<{
      name: string;
      description: string;
      visibility: "public" | "private" | "internal";
      language: string;
      status: string;
      tags: string[];
    }>,
  ) => api.patch<Project>(`/projects/${slug}`, data),
  remove: (slug: string) => api.del<void>(`/projects/${slug}`),
  members: (slug: string) =>
    api.get<ProjectMember[]>(`/projects/${slug}/members`),
  join: (slug: string) => api.post<Project>(`/projects/${slug}/join`),
  leave: (slug: string) => api.post<Project>(`/projects/${slug}/leave`),
  repos: (slug: string) => api.get<GHRepo[]>(`/projects/${slug}/repos`),
  addRepo: (slug: string, full_name: string) =>
    api.post<GHRepo>(`/projects/${slug}/repos`, { full_name }),
  refreshRepo: (repoId: string) => api.post<GHRepo>(`/repos/${repoId}/refresh`),
  removeRepo: (repoId: string) => api.del<void>(`/repos/${repoId}`),
  issues: (repoId: string) => api.get<GHIssue[]>(`/repos/${repoId}/issues`),
  issueDetail: (repoId: string, issueNumber: number) =>
    api.get<GHIssueDetail>(`/repos/${repoId}/issues/${issueNumber}`),
  /** Post a GH comment using the caller's connected GH OAuth token.
   *  Unified comment surface — replaces the previous parallel
   *  Astrozor chat for issues. Returns ``{status, html_url}`` from
   *  GitHub; ``status="no_token"`` when the user hasn't connected
   *  their GH account in Astrozor. */
  commentIssue: (repoId: string, issueNumber: number, body: string) =>
    api.post<GHIssueClaim>(
      `/repos/${repoId}/issues/${issueNumber}/comments`,
      { body },
    ),
  claimIssue: (repoId: string, issueNumber: number, body?: string) =>
    api.post<GHIssueClaim>(`/repos/${repoId}/issues/${issueNumber}/claim`, {
      body: body ?? "",
    }),
  /** Add the caller as a GH assignee on the issue. Requires the
   *  caller to be a repo collaborator with write access — non-
   *  collaborators get ``status="not_collaborator"`` and the UI
   *  hints them to ask the owner for access. */
  assignIssueToSelf: (repoId: string, issueNumber: number) =>
    api.post<GHIssueAssignResult>(
      `/repos/${repoId}/issues/${issueNumber}/assign`,
    ),
  /** Remove the caller from the issue's GH assignees list. Other
   *  assignees on the same issue are left untouched. */
  unassignIssueFromSelf: (repoId: string, issueNumber: number) =>
    api.del<GHIssueAssignResult>(
      `/repos/${repoId}/issues/${issueNumber}/assign`,
    ),
  /** GH user → open-issue-count leaderboard across all linked repos
   *  the caller can see. ``astrozor_*`` fields are empty for users
   *  who don't have a connected Astrozor account. */
  issueLeaderboard: (limit = 20) =>
    api.get<IssueLeaderboardEntry[]>(
      `/issues/leaderboard?limit=${limit}`,
    ),
  /** Open a new GitHub issue (bug / feature / task) on the linked repo
   *  using the caller's connected GH OAuth token. Backend maps
   *  ``type`` to GH labels (bug → ``bug``, feature → ``enhancement``,
   *  task → no extra label) and always tacks on ``astrozor`` so the
   *  issue is identifiable as raised from our UI. */
  createIssue: (
    repoId: string,
    payload: { title: string; body: string; type: GHIssueType },
  ) =>
    api.post<GHIssueCreateResult>(`/repos/${repoId}/issues`, payload),
  activity: (slug: string, days = 365) =>
    api.get<GHActivity>(`/projects/${slug}/activity?days=${days}`),
  /** Render markdown to sanitised HTML for the composer preview.
   *  Matches the pipeline used by issue body / comment rendering
   *  so what-you-see is what-you-get after posting. */
  previewMarkdown: (body: string) =>
    api.post<{ html: string }>("/markdown/preview", { body }),
};

// ---- Events ----

export type Event = {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  language: string;
  status:
    | "draft"
    | "announced"
    | "registration_open"
    | "registration_closed"
    | "in_progress"
    | "finished"
    | "cancelled";
  place_slug: string | null;
  place_name: string;
  place_lat: number | null;
  place_lon: number | null;
  place_elevation_m: number | null;
  place_bortle: number | null;
  external_address: string;
  external_lat: number | null;
  external_lon: number | null;
  meeting_url: string;
  // Optional secondary "feature" links surfaced in the list as
  // dim/lit icons. Set when the organizer has configured the relevant
  // channel for the event.
  discord_url: string;
  geocache_url: string;
  radio_frequency: string;
  starts_at: string;
  ends_at: string | null;
  capacity: number;
  organizer_email: string;
  organizer_display_name: string;
  registration_count: number;
  created_at: string;
  tags: string[];
  visibility: VisibilityLevel;
  allowed_user_emails: string[];
  discussion_visibility: "" | VisibilityLevel;
  discussion_allowed_user_emails: string[];
  // IANA timezone from event's GPS (place coords if linked, otherwise
  // external_lat/lon). Empty when coordinates are missing.
  timezone: string;
};

export type Registration = {
  id: string;
  event_slug: string;
  user_email: string;
  user_display_name: string;
  status: "confirmed" | "waitlisted" | "cancelled";
  created_at: string;
};

export const events = {
  list: (params?: { kind?: string; status?: string; place_slug?: string }) => {
    const search = new URLSearchParams();
    if (params?.kind) search.set("kind", params.kind);
    if (params?.status) search.set("status", params.status);
    if (params?.place_slug) search.set("place_slug", params.place_slug);
    const qs = search.toString();
    return api.get<Event[]>(`/events${qs ? "?" + qs : ""}`);
  },
  get: (slug: string) => api.get<Event>(`/events/${slug}`),
  create: (data: {
    title: string;
    description?: string | undefined;
    kind?: string | undefined;
    language?: string | undefined;
    place_slug?: string | undefined;
    external_address?: string | undefined;
    external_lat?: number | null | undefined;
    external_lon?: number | null | undefined;
    meeting_url?: string | undefined;
    discord_url?: string | undefined;
    geocache_url?: string | undefined;
    radio_frequency?: string | undefined;
    starts_at: string;
    ends_at?: string | undefined;
    capacity?: number | undefined;
    tags?: string[] | undefined;
    visibility?: VisibilityLevel | undefined;
    allowed_user_emails?: string[] | undefined;
    discussion_visibility?: "" | VisibilityLevel | undefined;
    discussion_allowed_user_emails?: string[] | undefined;
  }) => api.post<Event>("/events", data),
  patch: (slug: string, data: Partial<Event>) => api.patch<Event>(`/events/${slug}`, data),
  remove: (slug: string) => api.del<void>(`/events/${slug}`),
  transition: (slug: string, status: Event["status"]) =>
    api.post<Event>(`/events/${slug}/transition`, { status }),
  /**
   * Auto-provision a Discord channel + invite link in the organizer's
   * connected server. Requires the organizer to have linked Discord
   * via the combined OAuth (identity + bot install). Server writes
   * the resulting invite URL into event.discord_url.
   */
  createDiscordChannel: (slug: string) =>
    api.post<Event>(`/events/${slug}/discord-channel`),
  register: (slug: string) => api.post<Registration>(`/events/${slug}/register`),
  cancelRegistration: (slug: string) => api.del<void>(`/events/${slug}/register`),
  registrations: (slug: string) =>
    api.get<Registration[]>(`/events/${slug}/registrations`),
  icalUrl: (slug: string) => `${BASE}/events/${slug}/ical`,
  // Event discussion — backend mirrors the chat / article-comment shape
  // so the same ThreadedDiscussion React component handles all three.
  comments: (slug: string) =>
    api.get<{ count: number; items: Comment[] }>(`/events/${slug}/comments`),
  postComment: (slug: string, body: CommentPostBody) =>
    api.post<Comment>(`/events/${slug}/comments`, body),
  deleteComment: (id: string) => api.del<void>(`/events/comments/${id}`),
};

// ---- Citizen science ----

export type Campaign = {
  id: string;
  project_slug: string;
  slug: string;
  title: string;
  description: string;
  methodology: string;
  kind: string;
  status: "draft" | "open" | "paused" | "closed" | "completed" | "archived";
  coordinator_email: string;
  starts_at: string | null;
  ends_at: string | null;
  contribution_schema: Record<string, unknown>;
  contribution_count: number;
  accepted_count: number;
  created_at: string;
  tags: string[];
  // Zooniverse linkage — present when the campaign is a time-boxed
  // sprint around a Zooniverse project.
  zooniverse_project_zid: number | null;
  zooniverse_project_title: string;
  zooniverse_project_slug: string;
  zooniverse_project_avatar_url: string;
  zooniverse_workflow_id: number | null;
  zooniverse_workflow_name: string;
};

export type Contribution = {
  id: string;
  campaign_slug: string;
  user_email: string;
  user_display_name: string;
  title: string;
  data: Record<string, unknown>;
  comment: string;
  status: "submitted" | "accepted" | "rejected" | "needs_revision";
  review_comment: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export const campaigns = {
  list: (params?: { project_slug?: string; status?: string }) => {
    const search = new URLSearchParams();
    if (params?.project_slug) search.set("project_slug", params.project_slug);
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    return api.get<Campaign[]>(`/campaigns${qs ? "?" + qs : ""}`);
  },
  get: (slug: string) => api.get<Campaign>(`/campaigns/${slug}`),
  create: (data: {
    project_slug: string;
    title: string;
    description?: string;
    methodology?: string;
    kind?: string;
    starts_at?: string | null;
    ends_at?: string | null;
    contribution_schema?: Record<string, unknown>;
    tags?: string[];
    zooniverse_project_zid?: number | null;
    zooniverse_workflow_id?: number | null;
  }) => api.post<Campaign>("/campaigns", data),
  patch: (
    slug: string,
    data: Partial<{
      title: string;
      description: string;
      methodology: string;
      kind: string;
      status: Campaign["status"];
      starts_at: string | null;
      ends_at: string | null;
      contribution_schema: Record<string, unknown>;
      tags: string[];
      zooniverse_project_zid: number | null;
      zooniverse_workflow_id: number | null;
    }>,
  ) => api.patch<Campaign>(`/campaigns/${slug}`, data),
  contributions: (slug: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get<Contribution[]>(`/campaigns/${slug}/contributions${qs}`);
  },
  submit: (slug: string, data: { title: string; data: Record<string, unknown>; comment?: string }) =>
    api.post<Contribution>(`/campaigns/${slug}/contributions`, data),
  review: (
    contributionId: string,
    payload: { status: "accepted" | "rejected" | "needs_revision"; review_comment?: string },
  ) => api.post<Contribution>(`/contributions/${contributionId}/review`, payload),
};

// ---- Sprints (Zooniverse-linked time-boxed campaigns) ----

export type Sprint = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: Campaign["status"];
  coordinator_email: string;
  coordinator_display_name: string;
  starts_at: string | null;
  ends_at: string | null;
  closed_at: string | null;
  workflow_id: number | null;
  workflow_name: string;
  workflow_classify_url: string;
  participant_count: number;
  /** Does the current user have an active SprintParticipant row? */
  is_joined: boolean;
  /** Coordinator or staff — controls Close/Edit/Delete buttons. */
  can_manage: boolean;
  created_at: string;
  /** Zooniverse project ID the sprint is tied to — used by the
   *  subject picker to default-filter favorites/collections. */
  zooniverse_project_zid: number | null;
};

export type SprintStats = {
  sprint_slug: string;
  starts_at: string | null;
  ends_at: string | null;
  is_open: boolean;
  total_classifications: number;
  active_users: number;
  time_spent_s: number | null;
  top_contributors: ZooniverseContributor[];
  participants: number;
  fetched_at: string | null;
};

// ---- Zooniverse (Citizen Science integration) ----

export type ZooniverseWorkflow = {
  id: number;
  display_name: string;
  active: boolean;
  completeness: number;
  /** Direct ``/projects/<slug>/classify/workflow/<id>`` URL — lands
   *  in the classifier interface, not on the workflow picker. */
  classify_url: string;
  /** First-task question, e.g. "What features do you see?" Used as
   *  a sub-label under the workflow name. */
  description: string;
};

export type ZooniverseProject = {
  id: string;
  zooniverse_id: number;
  slug: string;
  title: string;
  owner_login: string;
  description: string;
  introduction: string;
  avatar_url: string;
  background_url: string;
  primary_language: string;
  state: string;
  classifications_count: number;
  is_featured: boolean;
  tags: string[];
  zooniverse_url: string;
  last_synced_at: string | null;
  group_contribution_count: number | null;
  /** Active workflows only. Multiple = project runs several parallel
   *  classification tasks (e.g. Galaxy Zoo's "JWST COSMOS" + "DECaLS"). */
  workflows: ZooniverseWorkflow[];
  launch_approved: boolean;
  beta_approved: boolean;
  subjects_count: number;
  /** Derived server-side: ``launch_approved=false`` AND every active
   *  workflow has near-zero completeness, meaning ``/classify`` will
   *  render blank because the subject sets are effectively empty. */
  zombie: boolean;
};

export type ZooniverseMembership = {
  linked: boolean;
  in_group: boolean;
  zooniverse_user_id: number | null;
  zooniverse_login: string;
  join_url: string;
  group_public_url: string;
  member_count: number;
  last_synced_at: string | null;
};

export type ZooniverseContributor = {
  zooniverse_user_id: number;
  login: string;
  display_name: string;
  avatar_url: string;
  count: number;
  time_spent_s: number | null;
  astrozor_email: string | null;
};

export type ZooniverseGroupDashboard = {
  group_id: number;
  name: string;
  member_count: number;
  total_classifications: number;
  time_spent_s: number | null;
  active_users: number;
  top_contributors: ZooniverseContributor[];
  last_synced_at: string | null;
};

export type ZooniverseProjectSeries = {
  zooniverse_id: number;
  period: string;
  data: { date: string; count: number }[];
};

export type ZooniverseSearchResult = {
  zooniverse_id: number;
  slug: string;
  title: string;
  description: string;
  avatar_url: string;
  classifications_count: number;
  state: string;
  primary_language: string;
  already_in_catalogue: boolean;
  launch_approved: boolean;
};

export type ZooniverseDisconnectSprintRef = {
  slug: string;
  title: string;
  status: Campaign["status"];
  starts_at: string | null;
  ends_at: string | null;
  participant_count: number;
};

/** What will be deleted if the admin confirms disconnecting a
 *  Zooniverse project from Astrozor. Read-only — the actual delete
 *  happens via ``adminRemove``. */
export type ZooniverseDisconnectPreview = {
  zooniverse_id: number;
  title: string;
  avatar_url: string;
  sprints: ZooniverseDisconnectSprintRef[];
  sprint_count: number;
  participant_count: number;
  stats_snapshot_count: number;
  has_downstream: boolean;
};

export type ZooniverseDisconnectResult = {
  zooniverse_id: number;
  deleted_project: boolean;
  deleted_sprints: number;
  deleted_participants: number;
  deleted_snapshots: number;
};

/** Dry-run snapshot used by the import review modal — server-side
 *  computed without persisting anything. The admin sees the full
 *  picture before committing the project to our catalogue. */
export type ZooniverseProjectPreview = {
  zooniverse_id: number;
  slug: string;
  title: string;
  owner_login: string;
  description: string;
  introduction: string;
  avatar_url: string;
  background_url: string;
  primary_language: string;
  state: string;
  classifications_count: number;
  subjects_count: number;
  launch_approved: boolean;
  beta_approved: boolean;
  private: boolean;
  workflows: ZooniverseWorkflow[];
  zombie: boolean;
  already_in_catalogue: boolean;
};

export const zooniverse = {
  listProjects: (featured_only = true) =>
    api.get<ZooniverseProject[]>(`/zooniverse/projects?featured_only=${featured_only}`),
  getProject: (zid: number) => api.get<ZooniverseProject>(`/zooniverse/projects/zid/${zid}`),
  projectSeries: (zid: number, days = 30) =>
    api.get<ZooniverseProjectSeries>(`/zooniverse/projects/zid/${zid}/series?days=${days}`),
  campaignsForProject: (zid: number, activeOnly = false) =>
    api.get<Campaign[]>(
      `/zooniverse/projects/zid/${zid}/campaigns?active_only=${activeOnly}`,
    ),
  listSprints: (zid: number) =>
    api.get<Sprint[]>(`/zooniverse/projects/zid/${zid}/sprints`),
  createSprint: (
    zid: number,
    data: {
      title: string;
      description?: string;
      workflow_id?: number | null;
      starts_at?: string | null;
      ends_at?: string | null;
    },
  ) => api.post<Sprint>(`/zooniverse/projects/zid/${zid}/sprints`, data),
  patchSprint: (
    slug: string,
    data: Partial<{
      title: string;
      description: string;
      workflow_id: number | null;
      starts_at: string | null;
      ends_at: string | null;
    }>,
  ) => api.patch<Sprint>(`/zooniverse/sprints/${slug}`, data),
  closeSprint: (slug: string) =>
    api.post<Sprint>(`/zooniverse/sprints/${slug}/close`),
  removeSprint: (slug: string) => api.del<void>(`/zooniverse/sprints/${slug}`),
  joinSprint: (slug: string) =>
    api.post<Sprint>(`/zooniverse/sprints/${slug}/join`),
  leaveSprint: (slug: string) =>
    api.post<Sprint>(`/zooniverse/sprints/${slug}/leave`),
  sprintStats: (slug: string) =>
    api.get<SprintStats>(`/zooniverse/sprints/${slug}/stats`),
  dashboard: () => api.get<ZooniverseGroupDashboard>("/zooniverse/dashboard"),
  membership: () => api.get<ZooniverseMembership>("/zooniverse/membership"),
  refreshMembership: () => api.post<ZooniverseMembership>("/zooniverse/membership/refresh", {}),
  adminAdd: (zooniverse_id_or_url: string) =>
    api.post<ZooniverseProject>("/zooniverse/admin/projects", { zooniverse_id_or_url }),
  adminPreview: (zooniverse_id_or_url: string) =>
    api.get<ZooniverseProjectPreview>(
      `/zooniverse/admin/projects/preview?zooniverse_id_or_url=${encodeURIComponent(zooniverse_id_or_url)}`,
    ),
  adminSearch: (params: { q?: string; tags?: string; state?: string; page?: number }) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.tags !== undefined) search.set("tags", params.tags);
    if (params.state) search.set("state", params.state);
    if (params.page) search.set("page", String(params.page));
    const qs = search.toString();
    return api.get<ZooniverseSearchResult[]>(`/zooniverse/admin/projects/search${qs ? "?" + qs : ""}`);
  },
  adminPatch: (zid: number, payload: { is_featured?: boolean; tags?: string[] }) =>
    api.patch<ZooniverseProject>(`/zooniverse/admin/projects/${zid}`, payload),
  adminDisconnectPreview: (zid: number) =>
    api.get<ZooniverseDisconnectPreview>(
      `/zooniverse/admin/projects/${zid}/disconnect-preview`,
    ),
  adminRemove: (zid: number) =>
    api.del<ZooniverseDisconnectResult>(`/zooniverse/admin/projects/${zid}`),

  // ---- Sprint chat (members-only discussion) ----
  listSprintChat: (slug: string) =>
    api.get<{ count: number; items: ChatMessage[] }>(
      `/zooniverse/sprints/${slug}/chat`,
    ),
  postSprintChat: (slug: string, body: ChatPostBody) =>
    api.post<ChatMessage>(`/zooniverse/sprints/${slug}/chat`, body),

  // Resolve a Zooniverse subject id/URL → ready-to-use attachment.
  resolveSubject: (q: string) =>
    api.get<ZooniverseSubjectResolved>(
      `/zooniverse/subjects/resolve?q=${encodeURIComponent(q)}`,
    ),

  // Per-workflow classification activity for the current user (used
  // to badge workflow CTA cards with "Aktivní"). linked=false when
  // the user hasn't connected their Zooniverse account.
  myWorkflowActivity: (zid: number) =>
    api.get<ZooniverseWorkflowActivity>(
      `/zooniverse/projects/zid/${zid}/my-workflow-activity`,
    ),

  // Read-only proxy of Zooniverse Talk boards for the widget on
  // the project detail page.
  talkBoards: (zid: number) =>
    api.get<ZooniverseTalkBoards>(
      `/zooniverse/projects/zid/${zid}/talk/boards`,
    ),
  talkDiscussions: (boardId: number, page = 1, pageSize = 20) =>
    api.get<ZooniverseTalkDiscussionList>(
      `/zooniverse/talk/boards/${boardId}/discussions?page=${page}&page_size=${pageSize}`,
    ),
  talkDiscussion: (discussionId: number, page = 1, pageSize = 30) =>
    api.get<ZooniverseTalkDiscussionDetail>(
      `/zooniverse/talk/discussions/${discussionId}?page=${page}&page_size=${pageSize}`,
    ),
  talkSubject: (subjectId: number | string) =>
    api.get<ZooniverseTalkSubjectView>(
      `/zooniverse/talk/subjects/${subjectId}`,
    ),
  myFavoriteSubjects: (page = 1, pageSize = 24, projectZid?: number) => {
    const q = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (projectZid) q.set("project_zid", String(projectZid));
    return api.get<ZooniverseSubjectList>(
      `/zooniverse/my-favorites?${q.toString()}`,
    );
  },
  myCollections: (projectZid?: number) => {
    const q = new URLSearchParams();
    if (projectZid) q.set("project_zid", String(projectZid));
    const qs = q.toString();
    return api.get<ZooniverseCollectionList>(
      `/zooniverse/my-collections${qs ? "?" + qs : ""}`,
    );
  },
  collectionSubjects: (collectionId: number, page = 1, pageSize = 24) =>
    api.get<ZooniverseSubjectList>(
      `/zooniverse/collections/${collectionId}/subjects?page=${page}&page_size=${pageSize}`,
    ),
  myRecentClassifications: (projectZid?: number, limit = 24) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (projectZid) q.set("project_zid", String(projectZid));
    return api.get<ZooniverseSubjectList>(
      `/zooniverse/my-recent-classifications?${q.toString()}`,
    );
  },
};

export type ZooniverseTalkBoard = {
  id: number;
  title: string;
  description: string;
  discussions_count: number;
  comments_count: number;
  /** True for the special "Notes" board where per-subject discussions
   *  live. We highlight it on the widget because it's the busiest. */
  subject_default: boolean;
  talk_url: string;
};

export type ZooniverseTalkBoards = {
  project_zid: number;
  talk_url: string;
  boards: ZooniverseTalkBoard[];
};

export type ZooniverseSubjectResolved = {
  subject_id: string;
  project_zid: number;
  media: ZooniverseSubjectMedia[];
  locations: string[];
  classify_url: string;
  talk_url: string;
  title: string;
};

export type ZooniverseCollection = {
  id: number;
  display_name: string;
  favorite: boolean;
  private: boolean;
  subjects_count: number;
  preview_url: string;
};

export type ZooniverseSubjectList = {
  items: ZooniverseSubjectResolved[];
  page: number;
  page_size: number;
  total: number;
  /** True when the user's Zoo Identity row exists but has no usable
   *  OAuth tokens — typically a legacy row from before refresh_token
   *  storage. UI prompts the user to disconnect + reconnect. */
  needs_reconnect: boolean;
};

export type ZooniverseCollectionList = {
  items: ZooniverseCollection[];
  needs_reconnect: boolean;
};

export type ZooniverseTalkDiscussion = {
  id: number;
  title: string;
  board_id: number;
  user_id: number;
  user_login: string;
  comments_count: number;
  users_count: number;
  last_comment_created_at: string;
  created_at: string;
  sticky: boolean;
  locked: boolean;
  focus_id: number;
  focus_type: string;
  talk_url: string;
  latest_comment_excerpt: string;
};

export type ZooniverseTalkDiscussionList = {
  items: ZooniverseTalkDiscussion[];
  page: number;
  page_size: number;
  page_count: number;
  total: number;
};

export type ZooniverseTalkComment = {
  id: number;
  body_html: string;
  user_id: number;
  user_login: string;
  user_display_name: string;
  created_at: string;
  upvotes: number;
  is_deleted: boolean;
  reply_id: number;
};

export type ZooniverseTalkDiscussionDetail = {
  id: number;
  title: string;
  board_id: number;
  board_title: string;
  focus_id: number;
  focus_type: string;
  locked: boolean;
  sticky: boolean;
  user_login: string;
  created_at: string;
  talk_url: string;
  comments: ZooniverseTalkComment[];
  comments_page: number;
  comments_page_size: number;
  comments_page_count: number;
  comments_total: number;
};

export type ZooniverseTalkSubjectView = {
  subject: ZooniverseSubjectResolved;
  discussions: ZooniverseTalkDiscussion[];
  discussions_total: number;
};

export type ZooniverseWorkflowActivity = {
  linked: boolean;
  workflows: { workflow_id: number; classified_count: number }[];
};
