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
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

// ---- Typed endpoints ----

export type User = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  created_at: string;
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
  storage_used_bytes: number;
  storage_quota_bytes: number;
  onboarding_completed: boolean;
};

export type Identity = {
  id: string;
  provider: "github" | "google" | "mastodon";
  provider_user_id: string;
  provider_username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  has_token: boolean;
  last_login_at: string | null;
  created_at: string;
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
  patchProfile: (patch: ProfilePatch) => api.patch<Me>("/accounts/profile", patch),
  listIdentities: () => api.get<Identity[]>("/accounts/identities"),
  disconnectIdentity: (id: string) => api.del<void>(`/accounts/identities/${id}`),
};

export const meta = {
  healthz: () => api.get<{ status: string; version: string; database: string }>("/healthz"),
  readyz: () => api.get<{ status: string; version: string; database: string }>("/readyz"),
};

// ---- Places ----

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
  bortle_class: number | null;
  valid_from: string | null;
  valid_to: string | null;
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
};
