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
  oauthProviders: () =>
    api.get<{ github: boolean; google: boolean; mastodon: boolean }>("/auth/providers"),
  registerMastodon: (instanceUrl: string) =>
    api.post<{ instance_url: string; name: string; start_url: string }>(
      "/auth/mastodon/register",
      { instance_url: instanceUrl },
    ),
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
  active_checkin_count: number;
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

// ---- Chat (per-place REST + client polling) ----

export type ChatMessage = {
  id: string;
  place_slug: string;
  user_display_name: string;
  user_email: string;
  text: string;
  created_at: string;
};

export const chat = {
  list: (placeSlug: string) =>
    api.get<{ count: number; items: ChatMessage[] }>(`/places/${placeSlug}/chat`),
  post: (placeSlug: string, text: string) =>
    api.post<ChatMessage>(`/places/${placeSlug}/chat`, { text }),
  remove: (id: string) => api.del<void>(`/messages/${id}`),
};

// ---- Presence (check-ins) ----

export type Checkin = {
  id: string;
  user_email: string | null;
  display_name: string;
  comment: string;
  anonymous: boolean;
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
  language: string;
  status: string;
  author_display_name: string;
  doi: string;
  published_at: string | null;
  created_at: string;
};

export type Article = ArticleListItem & {
  engine: string;
  author_email: string;
  license: string;
  content_html: string;
  updated_at: string;
};

export type Comment = {
  id: string;
  article_slug: string;
  user_display_name: string;
  text: string;
  created_at: string;
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
  create: (data: { title: string; summary?: string; content_md: string; language?: string }) =>
    api.post<Article>("/articles", data),
  patch: (slug: string, data: Partial<{ title: string; summary: string; content_md: string }>) =>
    api.patch<Article>(`/articles/${slug}`, data),
  publish: (slug: string) => api.post<Article>(`/articles/${slug}/publish`),
  remove: (slug: string) => api.del<void>(`/articles/${slug}`),
  comments: (slug: string) =>
    api.get<{ count: number; items: Comment[] }>(`/articles/${slug}/comments`),
  postComment: (slug: string, text: string) =>
    api.post<Comment>(`/articles/${slug}/comments`, { text }),
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
  }) => api.post<Project>("/projects", data),
  remove: (slug: string) => api.del<void>(`/projects/${slug}`),
  repos: (slug: string) => api.get<GHRepo[]>(`/projects/${slug}/repos`),
  addRepo: (slug: string, full_name: string) =>
    api.post<GHRepo>(`/projects/${slug}/repos`, { full_name }),
  refreshRepo: (repoId: string) => api.post<GHRepo>(`/repos/${repoId}/refresh`),
  removeRepo: (repoId: string) => api.del<void>(`/repos/${repoId}`),
  issues: (repoId: string) => api.get<GHIssue[]>(`/repos/${repoId}/issues`),
  claimIssue: (repoId: string, issueNumber: number, body?: string) =>
    api.post<GHIssueClaim>(`/repos/${repoId}/issues/${issueNumber}/claim`, {
      body: body ?? "",
    }),
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
    | "planned"
    | "registration_open"
    | "registration_closed"
    | "happening"
    | "done"
    | "cancelled";
  place_slug: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number;
  organizer_email: string;
  registration_count: number;
  created_at: string;
};

export type Registration = {
  id: string;
  event_slug: string;
  user_email: string;
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
    description?: string;
    kind?: string;
    language?: string;
    place_slug?: string;
    starts_at: string;
    ends_at?: string;
    capacity?: number;
  }) => api.post<Event>("/events", data),
  patch: (slug: string, data: Partial<Event>) => api.patch<Event>(`/events/${slug}`, data),
  transition: (slug: string, status: Event["status"]) =>
    api.post<Event>(`/events/${slug}/transition`, { status }),
  register: (slug: string) => api.post<Registration>(`/events/${slug}/register`),
  cancelRegistration: (slug: string) => api.del<void>(`/events/${slug}/register`),
  icalUrl: (slug: string) => `${BASE}/events/${slug}/ical`,
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
  status: "draft" | "open" | "closed" | "archived";
  coordinator_email: string;
  starts_at: string | null;
  ends_at: string | null;
  contribution_schema: Record<string, unknown>;
  contribution_count: number;
  accepted_count: number;
  created_at: string;
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
    starts_at?: string;
    ends_at?: string;
    contribution_schema?: Record<string, unknown>;
  }) => api.post<Campaign>("/campaigns", data),
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
