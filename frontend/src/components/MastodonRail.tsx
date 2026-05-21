import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { mastodon, type Me } from "../lib/api";

// The Astrozor community Mastodon instance. Public timeline + hashtag
// endpoints work without auth — Mastodon serves them CORS-open by design
// so any origin can hit them directly from a browser. "Home" mode goes
// through the Astrozor backend so it can attach the user's OAuth token.
const COMMUNITY_INSTANCE = "https://space.robozor.cz";
const TIMELINE_LIMIT = 20;

type Kind = "local" | "hashtag" | "home";

type CommunityToot = {
  id: string;
  url: string;
  created_at: string;
  content: string;
  account: {
    acct: string;
    display_name: string;
    avatar: string;
    url: string;
  };
  media_attachments: {
    type: string;
    url: string;
    preview_url: string;
    description?: string;
  }[];
  card: {
    image?: string | null;
    title?: string;
    description?: string;
  } | null;
  tags: { name: string }[];
};

type DirectoryAccount = {
  id: string;
  acct: string;
  username: string;
  display_name: string;
  avatar: string;
  url: string;
};

async function fetchLocalDirectory(): Promise<DirectoryAccount[]> {
  // Mastodon Directory endpoint — returns local accounts ordered by
  // most-recently-active. `local=true` restricts to the instance's own
  // users (excludes federated remote accounts that happen to be seen
  // here). Limit 80 is the API hard cap.
  const res = await fetch(
    `${COMMUNITY_INSTANCE}/api/v1/directory?local=true&limit=80&order=active`,
    { credentials: "omit" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DirectoryAccount[];
}

async function fetchPublicLocal(): Promise<CommunityToot[]> {
  const res = await fetch(
    `${COMMUNITY_INSTANCE}/api/v1/timelines/public?local=true&limit=${TIMELINE_LIMIT}`,
    { credentials: "omit" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CommunityToot[];
}

async function fetchHashtag(tags: string[]): Promise<CommunityToot[]> {
  const clean = tags
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
  if (clean.length === 0) return [];
  // Mastodon hashtag endpoint: base path is one primary tag, ?any[]= for
  // additional OR tags. So `/tag/nasa?any[]=astronomy&any[]=astrophoto`
  // returns statuses tagged with nasa OR astronomy OR astrophoto.
  const [primary, ...rest] = clean;
  const params = new URLSearchParams();
  params.set("limit", String(TIMELINE_LIMIT));
  for (const t of rest) params.append("any[]", t);
  const res = await fetch(
    `${COMMUNITY_INSTANCE}/api/v1/timelines/tag/${encodeURIComponent(primary)}?${params.toString()}`,
    { credentials: "omit" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CommunityToot[];
}

/**
 * Right-rail Mastodon feed for the Articles page. Three timeline modes:
 *
 *   - Local (default) — public local timeline of space.robozor.cz,
 *     direct CORS fetch, works for anyone.
 *   - Hashtag — user types a hashtag, hashtag timeline from
 *     space.robozor.cz, direct CORS fetch.
 *   - Home — the authed user's home timeline on their connected
 *     Mastodon instance. Goes through Astrozor backend so the OAuth
 *     token stays server-side. Disabled when no connected identity.
 *
 * Both Local and Home modes accept an optional author filter that
 * narrows the loaded statuses to a single account.
 */
export function MastodonRail({ me }: { me?: Me | null }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("local");
  const [tagInput, setTagInput] = useState("astronomy");
  // activeTags holds the parsed list of hashtags currently filtering
  // the hashtag-mode timeline. Stored as an array so the rail can OR
  // them via Mastodon's any[] parameter, and the chips render as
  // "#nasa #astronomy".
  const [activeTags, setActiveTags] = useState<string[]>(["astronomy"]);
  const [authorFilter, setAuthorFilter] = useState("");

  // Reset author filter when leaving a mode where it doesn't make sense.
  // Hashtag timelines are tag-scoped — author filter still works but
  // we drop it for clarity when switching modes.
  useEffect(() => {
    setAuthorFilter("");
  }, [kind]);

  // Anon users can't reach the Home timeline (no OAuth token).
  const homeAvailable = !!me;

  const localQ = useQuery({
    queryKey: ["mastodon-rail", "local"],
    queryFn: fetchPublicLocal,
    enabled: kind === "local",
    staleTime: 2 * 60_000,
  });
  // Directory: all local users of the instance, ordered by recent
  // activity. Populates the Local-mode author filter dropdown so users
  // appear even when they haven't posted in the last 20 toots.
  // Loaded only when the user is in Local mode to keep traffic low.
  const directoryQ = useQuery({
    queryKey: ["mastodon-rail", "directory"],
    queryFn: fetchLocalDirectory,
    enabled: kind === "local",
    staleTime: 10 * 60_000,
  });
  const hashtagQ = useQuery({
    // Key includes the sorted tag list so changing order doesn't trigger
    // a refetch (Mastodon returns the same set regardless of any[] order).
    queryKey: ["mastodon-rail", "hashtag", [...activeTags].sort()],
    queryFn: () => fetchHashtag(activeTags),
    enabled: kind === "hashtag" && activeTags.length > 0,
    staleTime: 2 * 60_000,
  });
  const homeQ = useQuery({
    queryKey: ["mastodon-rail", "home"],
    queryFn: () => mastodon.timeline("home"),
    enabled: kind === "home" && homeAvailable,
    staleTime: 2 * 60_000,
  });

  // Normalize all three sources to the same shape. Backend returns
  // statuses with content_html (renamed) but we re-use the raw `content`
  // field for now since direct-fetched Mastodon also provides it.
  const items: CommunityToot[] = (() => {
    if (kind === "local") return localQ.data ?? [];
    if (kind === "hashtag") return hashtagQ.data ?? [];
    if (kind === "home") {
      const raw = homeQ.data?.items ?? [];
      return raw.map((s) => ({
        id: s.id,
        url: s.url,
        created_at: s.created_at,
        content: s.content_html,
        account: {
          acct: s.account.acct,
          display_name: s.account.display_name,
          avatar: s.account.avatar,
          url: s.account.url,
        },
        media_attachments: s.media.map((m) => ({
          type: m.type,
          url: m.url,
          preview_url: m.preview_url,
          description: m.description,
        })),
        card: s.card
          ? {
              image: s.card.image,
              title: s.card.title,
              description: s.card.description,
            }
          : null,
        tags: (s.tags ?? []).map((name) => ({ name })),
      }));
    }
    return [];
  })();

  // Author dropdown. In Local mode we merge the instance's directory
  // (all local users) with the authors of currently-loaded statuses;
  // in Home mode we only know about accounts that have posted in the
  // user's feed (no equivalent directory exists for personal home).
  const authors = useMemo(() => {
    const m = new Map<string, CommunityToot["account"]>();
    for (const s of items) {
      if (!m.has(s.account.acct)) m.set(s.account.acct, s.account);
    }
    if (kind === "local") {
      for (const u of directoryQ.data ?? []) {
        if (!m.has(u.acct)) {
          m.set(u.acct, {
            acct: u.acct,
            display_name: u.display_name,
            avatar: u.avatar,
            url: u.url,
          });
        }
      }
    }
    return [...m.values()].sort((a, b) =>
      (a.display_name || a.acct)
        .toLowerCase()
        .localeCompare((b.display_name || b.acct).toLowerCase()),
    );
  }, [items, directoryQ.data, kind]);

  const visible = useMemo(() => {
    if (!authorFilter) return items;
    return items.filter((s) => s.account.acct === authorFilter);
  }, [items, authorFilter]);

  const isLoading =
    (kind === "local" && localQ.isLoading) ||
    (kind === "hashtag" && hashtagQ.isLoading) ||
    (kind === "home" && homeQ.isLoading);
  const error =
    (kind === "local" && localQ.error) ||
    (kind === "hashtag" && hashtagQ.error) ||
    (kind === "home" && homeQ.error);

  return (
    <aside className="flex flex-col" data-testid="mastodon-rail">
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
          <span aria-hidden>🐘</span>
          {t("articles.mastoRail.title")}
        </h3>
        <a
          href={COMMUNITY_INSTANCE}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[11px] text-slate-500 hover:text-indigo-300 transition"
        >
          {t("articles.mastoRail.openInstance")} ↗
        </a>
      </header>

      {/* Mode switcher — same shape as the original MastodonFeedPage
          segmented control, scoped to the rail. */}
      <div className="flex gap-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-1 mb-3">
        <ModeButton
          active={kind === "local"}
          onClick={() => setKind("local")}
          testid="masto-rail-kind-local"
        >
          {t("articles.mastoRail.kindLocal")}
        </ModeButton>
        <ModeButton
          active={kind === "hashtag"}
          onClick={() => setKind("hashtag")}
          testid="masto-rail-kind-hashtag"
        >
          {t("articles.mastoRail.kindHashtag")}
        </ModeButton>
        <ModeButton
          active={kind === "home"}
          onClick={() => homeAvailable && setKind("home")}
          disabled={!homeAvailable}
          testid="masto-rail-kind-home"
          title={
            homeAvailable
              ? undefined
              : t("articles.mastoRail.homeRequiresAuth")
          }
        >
          {t("articles.mastoRail.kindHome")}
        </ModeButton>
      </div>

      {kind === "hashtag" && (
        <div className="mb-3">
          <form
            className="flex gap-1.5 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveTags(parseHashtags(tagInput));
            }}
          >
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={t("articles.mastoRail.hashtagPlaceholder")}
              data-testid="masto-rail-tag-input"
              className="flex-1 bg-slate-950 ring-1 ring-slate-800 focus:ring-slate-600 rounded-md px-2.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-600"
            />
            <button
              type="submit"
              data-testid="masto-rail-tag-go"
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 ring-1 ring-slate-700 px-2.5 py-1 rounded-md transition"
            >
              {t("articles.mastoRail.go")}
            </button>
          </form>
          <p className="text-[10px] text-slate-500 mt-1">
            {t("articles.mastoRail.hashtagHint")}
          </p>
          {activeTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2" data-testid="masto-rail-active-tags">
              {activeTags.map((tg) => (
                <span
                  key={tg}
                  className="text-[10px] font-mono text-indigo-300 bg-indigo-950/40 ring-1 ring-indigo-900/60 rounded px-1.5 py-0.5"
                >
                  #{tg}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* User filter — shown in Local (with directory) and Home (with
          loaded statuses). Always visible in Local mode while the
          directory is loading so the box is predictable. */}
      {(kind === "local" || (kind === "home" && authors.length > 0)) && (
        <div className="flex gap-1.5 items-center mb-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">
            {t("articles.mastoRail.author")}
          </span>
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            data-testid="masto-rail-author-filter"
            className="flex-1 min-w-0 bg-slate-950 ring-1 ring-slate-800 focus:ring-slate-600 rounded-md px-2 py-1 text-xs text-slate-200 outline-none"
          >
            <option value="">{t("articles.mastoRail.allAuthors")}</option>
            {authors.map((a) => (
              <option key={a.acct} value={a.acct}>
                {a.display_name || a.acct} (@{a.acct})
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading && (
        <p className="text-xs text-slate-500 italic">{t("common.loading")}</p>
      )}
      {error && (
        <p className="text-xs text-rose-400">{t("articles.mastoRail.error")}</p>
      )}
      {!isLoading && !error && visible.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          {t("articles.mastoRail.empty")}
        </p>
      )}
      <ul className="space-y-3">
        {visible.map((toot) => (
          <MastodonCard key={toot.id} toot={toot} />
        ))}
      </ul>
    </aside>
  );
}

function ModeButton({
  active,
  onClick,
  children,
  testid,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testid?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      title={title}
      className={`flex-1 text-xs px-2.5 py-1.5 rounded-md transition ${
        active
          ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
          : disabled
            ? "text-slate-600 cursor-not-allowed"
            : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function MastodonCard({ toot }: { toot: CommunityToot }) {
  const { t } = useTranslation();
  const mediaImage = toot.media_attachments?.find(
    (m) => m.type === "image",
  )?.preview_url;
  const cover = mediaImage || toot.card?.image || "";
  const date = new Date(toot.created_at).toLocaleDateString();
  const plain = stripHtml(toot.content).trim();
  const title = firstLine(plain, 80);
  const summary = plain.length > title.length ? plain.slice(title.length).trim() : "";
  const tags = (toot.tags ?? []).slice(0, 5).map((t) => t.name);

  return (
    <li>
      <a
        href={toot.url}
        target="_blank"
        rel="noreferrer noopener"
        data-testid={`masto-rail-card-${toot.id}`}
        className="group block bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-600 rounded-xl overflow-hidden transition"
      >
        <div className="relative aspect-[16/9] bg-slate-900 overflow-hidden">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-950/40 via-slate-900 to-slate-950 flex items-center justify-center text-5xl text-slate-700">
              🐘
            </div>
          )}
          <div className="absolute bottom-2 left-2">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-fuchsia-900/80 text-fuchsia-100 px-2 py-0.5 rounded-full backdrop-blur-sm">
              🐘 Mastodon
            </span>
          </div>
        </div>
        <div className="p-3.5 flex flex-col">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            <span>{date}</span>
          </div>
          <p className="text-sm font-semibold leading-snug text-slate-100 group-hover:text-white transition line-clamp-2 mb-1.5">
            {title}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1.5">
            {toot.account.avatar && (
              <img
                src={toot.account.avatar}
                alt=""
                className="w-4 h-4 rounded-full ring-1 ring-slate-700"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="truncate text-slate-300">
              {toot.account.display_name || toot.account.acct}
            </span>
            <span className="font-mono text-slate-500 truncate">
              @{toot.account.acct}
            </span>
          </div>
          {summary && (
            <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
              {summary}
            </p>
          )}
          {tags.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-800/60 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] text-slate-500 font-mono"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </a>
      <span className="sr-only">{t("articles.mastoRail.opensOnMastodon")}</span>
    </li>
  );
}

// Split "nasa, astronomy #astrophoto" → ["nasa", "astronomy", "astrophoto"].
// Accepts comma, semicolon, or whitespace as separators; strips leading
// "#" if user typed it; dedupes while preserving order; trims to <=10
// to avoid hammering the Mastodon any[] limit (~10 in practice).
function parseHashtags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const t = part.replace(/^#+/, "").trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

function stripHtml(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, "");
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

function firstLine(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const dot = s.slice(0, maxLen).search(/[.!?]\s/);
  if (dot > 20) return s.slice(0, dot + 1);
  const space = s.lastIndexOf(" ", maxLen);
  return (space > 30 ? s.slice(0, space) : s.slice(0, maxLen)) + "…";
}
