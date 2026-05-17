import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mastodon, type MastoStatus, type Me } from "../lib/api";

type Kind = "home" | "hashtag" | "public";

export function MastodonFeedPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("home");
  const [tagInput, setTagInput] = useState("astronomy");
  const [activeTag, setActiveTag] = useState("astronomy");
  // Author filter is only relevant for Local — reset when leaving that tab.
  const [authorFilter, setAuthorFilter] = useState<string>("");
  useEffect(() => {
    if (kind !== "public") setAuthorFilter("");
  }, [kind]);

  const timeline = useQuery({
    queryKey: ["mastodon-timeline", kind, kind === "hashtag" ? activeTag : ""],
    queryFn: () => mastodon.timeline(kind, kind === "hashtag" ? activeTag : ""),
    refetchInterval: 60_000,
  });

  // Unique accounts present in the currently-loaded statuses; surface
  // them as a dropdown on Local. Sorted by display name (case-insensitive).
  const localAuthors = useMemo(() => {
    if (kind !== "public" || !timeline.data) return [];
    const byAcct = new Map<string, MastoStatus["account"]>();
    for (const s of timeline.data.items) {
      if (!byAcct.has(s.account.acct)) byAcct.set(s.account.acct, s.account);
    }
    return [...byAcct.values()].sort((a, b) =>
      (a.display_name || a.acct)
        .toLowerCase()
        .localeCompare((b.display_name || b.acct).toLowerCase()),
    );
  }, [timeline.data, kind]);

  const visibleItems = useMemo(() => {
    if (!timeline.data) return [];
    if (kind !== "public" || !authorFilter) return timeline.data.items;
    return timeline.data.items.filter((s) => s.account.acct === authorFilter);
  }, [timeline.data, kind, authorFilter]);

  void me;

  return (
    <section data-testid="mastodon-feed" className="space-y-4">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">{t("mastodon.title")}</h2>
          {timeline.data?.instance && (
            <p className="text-xs text-slate-500 font-mono mt-1">
              {timeline.data.instance}
            </p>
          )}
        </div>
        <div className="flex gap-1 bg-slate-950 rounded-lg p-1 ring-1 ring-slate-800">
          {(["home", "hashtag", "public"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              data-testid={`masto-kind-${k}`}
              className={`text-xs px-3 py-1.5 rounded-md transition ${
                kind === k
                  ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t(`mastodon.kind.${k}`)}
            </button>
          ))}
        </div>
      </header>

      {kind === "hashtag" && (
        <form
          className="flex gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setActiveTag(tagInput.trim().replace(/^#/, ""));
          }}
        >
          <span className="text-slate-400">#</span>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder={t("mastodon.tagPlaceholder")}
            className="flex-1 max-w-xs bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-3 py-1.5 text-sm text-slate-100 outline-none"
            data-testid="masto-tag-input"
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md"
          >
            {t("mastodon.applyTag")}
          </button>
        </form>
      )}

      {kind === "public" && localAuthors.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-400 text-xs" htmlFor="masto-author">
            {t("mastodon.filterAuthor")}
          </label>
          <select
            id="masto-author"
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            data-testid="masto-author-select"
            className="bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-2 py-1.5 text-slate-100 outline-none text-sm min-w-[14rem]"
          >
            <option value="">
              {t("mastodon.allAuthors")} ({localAuthors.length})
            </option>
            {localAuthors.map((a) => (
              <option key={a.acct} value={a.acct}>
                {(a.display_name || a.acct).slice(0, 40)} (@{a.acct})
              </option>
            ))}
          </select>
          {authorFilter && (
            <button
              type="button"
              onClick={() => setAuthorFilter("")}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
      )}

      {timeline.isLoading && (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      )}
      {timeline.isError && (
        <p className="text-rose-400 text-sm">
          {(timeline.error as Error).message}
        </p>
      )}
      {timeline.isSuccess && timeline.data.detail && (
        <p className="text-amber-300 text-xs bg-amber-950/40 ring-1 ring-amber-900/50 rounded-md px-3 py-2">
          ⚠ {timeline.data.detail}
        </p>
      )}
      {timeline.isSuccess && timeline.data.items.length === 0 && !timeline.data.detail && (
        <p className="text-slate-500 text-sm">{t("mastodon.empty")}</p>
      )}
      {kind === "public" &&
        authorFilter &&
        visibleItems.length === 0 &&
        timeline.data &&
        timeline.data.items.length > 0 && (
          <p className="text-slate-500 text-sm">{t("mastodon.noByAuthor")}</p>
        )}

      <ul className="space-y-3">
        {visibleItems.map((s) => (
          <StatusCard key={s.id} status={s} />
        ))}
      </ul>
    </section>
  );
}

function StatusCard({ status }: { status: MastoStatus }) {
  return (
    <li
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-2"
      data-testid={`masto-status-${status.id}`}
    >
      <header className="flex items-center gap-3 text-xs text-slate-400">
        {status.account.avatar && (
          <img
            src={status.account.avatar}
            alt=""
            className="w-7 h-7 rounded-full ring-1 ring-slate-700"
            loading="lazy"
          />
        )}
        <div className="min-w-0 flex-1">
          <a
            href={status.account.url}
            target="_blank"
            rel="noopener"
            className="text-slate-100 font-medium hover:text-indigo-300 truncate"
          >
            {status.account.display_name || status.account.acct}
          </a>
          <span className="ml-2 text-slate-500 font-mono">
            @{status.account.acct}
          </span>
        </div>
        <a
          href={status.url}
          target="_blank"
          rel="noopener"
          className="text-slate-500 hover:text-slate-300 shrink-0 font-mono"
        >
          {new Date(status.created_at).toLocaleString()}
        </a>
      </header>

      {status.spoiler_text && (
        <p className="text-xs text-amber-300 italic">⚠ {status.spoiler_text}</p>
      )}

      {/* Mastodon returns sanitized HTML in content_html — render it via
          dangerouslySetInnerHTML.  Server-side it already comes through
          Mastodon's own sanitizer, but we wrap in `.masto-content` so any
          future global CSS rule could re-sanitize visually. */}
      <div
        className="text-sm text-slate-200 masto-content"
        dangerouslySetInnerHTML={{ __html: status.content_html }}
      />

      {status.media.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {status.media.slice(0, 4).map((m) => (
            <a
              key={m.url}
              href={m.url}
              target="_blank"
              rel="noopener"
              className="block rounded-md overflow-hidden ring-1 ring-slate-800"
            >
              <img
                src={m.preview_url || m.url}
                alt={m.description}
                className="w-full h-auto object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {status.card && status.media.length === 0 && (
        <a
          href={status.card.url}
          target="_blank"
          rel="noopener"
          className="block rounded-md overflow-hidden ring-1 ring-slate-800 hover:ring-slate-700 transition"
          data-testid="masto-card"
        >
          {status.card.image && (
            <img
              src={status.card.image}
              alt=""
              className="w-full max-h-80 object-cover bg-slate-900"
              loading="lazy"
            />
          )}
          <div className="p-3 bg-slate-900/60">
            {status.card.provider_name && (
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                {status.card.provider_name}
              </p>
            )}
            <p className="text-sm font-medium text-slate-100 mt-0.5">
              {status.card.title}
            </p>
            {status.card.description && (
              <p className="text-xs text-slate-400 mt-1 line-clamp-3">
                {status.card.description}
              </p>
            )}
          </div>
        </a>
      )}

      <div className="flex gap-4 text-xs text-slate-500">
        <span>↻ {status.reblogs_count}</span>
        <span>★ {status.favourites_count}</span>
        <span>💬 {status.replies_count}</span>
      </div>
    </li>
  );
}
