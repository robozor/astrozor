import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError, docs, type DocPageMeta } from "../lib/api";
import { useUrlParam } from "../lib/urlParam";

const DEFAULT_SLUG = "introduction";

export function DocsPage() {
  const { i18n, t } = useTranslation();
  const lang = i18n.language.startsWith("cs") ? "cs" : "en";
  const [slug, setSlug] = useUrlParam("d");
  const activeSlug = slug || DEFAULT_SLUG;

  const list = useQuery<unknown, ApiError, ReturnType<typeof groupBySection>>({
    queryKey: ["docs-list", lang],
    queryFn: async () => {
      const data = await docs.list(lang);
      return groupBySection(data.pages);
    },
  });

  const page = useQuery({
    queryKey: ["docs-page", activeSlug, lang],
    queryFn: () => docs.get(activeSlug, lang),
  });

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6 min-h-0 flex-1">
      <aside className="md:w-72 md:shrink-0 md:max-h-[calc(100vh-160px)] md:overflow-y-auto md:sticky md:top-0">
        <DocsSidebar
          groups={list.data ?? []}
          activeSlug={activeSlug}
          onSelect={(next) => setSlug(next === DEFAULT_SLUG ? null : next)}
          loading={list.isPending}
        />
      </aside>
      <article className="flex-1 min-w-0">
        {page.isPending && (
          <p className="text-slate-400 text-sm">{t("docs.loading")}</p>
        )}
        {page.isError && (
          <p className="text-rose-300 text-sm">
            {(page.error as ApiError | undefined)?.detail ?? t("docs.notFound")}
          </p>
        )}
        {page.data && (
          <DocsContent
            html={page.data.content_html}
            title={page.data.title}
            fallbackUsed={page.data.fallback_used}
            onSlugClick={(next) => setSlug(next === DEFAULT_SLUG ? null : next)}
          />
        )}
      </article>
    </div>
  );
}

type Group = { section: string; pages: DocPageMeta[] };

function groupBySection(pages: DocPageMeta[]): Group[] {
  const map = new Map<string, DocPageMeta[]>();
  for (const p of pages) {
    const arr = map.get(p.section) ?? [];
    arr.push(p);
    map.set(p.section, arr);
  }
  // Preserve the order in which sections first appear (the backend
  // already returns pages sorted by section + order).
  const ordered: Group[] = [];
  for (const p of pages) {
    if (!ordered.find((g) => g.section === p.section)) {
      ordered.push({ section: p.section, pages: map.get(p.section)! });
    }
  }
  return ordered;
}

function DocsSidebar({
  groups,
  activeSlug,
  onSelect,
  loading,
}: {
  groups: Group[];
  activeSlug: string;
  onSelect: (slug: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <p className="text-slate-500 text-xs">{t("docs.loading")}</p>;
  }
  return (
    <nav className="space-y-5">
      {groups.map((g) => (
        <div key={g.section}>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1.5 px-2">
            {g.section}
          </h3>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const isActive = p.slug === activeSlug;
              return (
                <li key={p.slug}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.slug)}
                    className={`w-full text-left text-sm px-2 py-1.5 rounded transition flex items-center gap-2 ${
                      isActive
                        ? "bg-indigo-950/50 text-indigo-100 ring-1 ring-indigo-900/60"
                        : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                    }`}
                  >
                    {p.icon && (
                      <span className="text-base shrink-0" aria-hidden>
                        {p.icon}
                      </span>
                    )}
                    <span className="truncate">{p.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DocsContent({
  html,
  title,
  fallbackUsed,
  onSlugClick,
}: {
  html: string;
  title: string;
  fallbackUsed: boolean;
  onSlugClick: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Reset scroll when navigating to a different doc page.
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [title]);

  // Intercept clicks on relative anchors inside the rendered HTML so
  // they navigate within the docs SPA (update ?d=) instead of reloading
  // the page. External links (http/https) keep their default behaviour.
  const onClick = useMemo(
    () => (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Skip absolute URLs, fragments, and hash-only links.
      if (href.startsWith("http://") || href.startsWith("https://")) return;
      if (href.startsWith("#")) return;
      // Skip downloads (/samples/* are downloads, /vscode-extension/* too).
      if (href.startsWith("/samples/") || href.startsWith("/vscode-extension/")) {
        return;
      }
      // Anything else is a doc slug (`first-steps`, `publish-vscode`…)
      event.preventDefault();
      onSlugClick(href.replace(/^\/+/, "").replace(/\.md$/, ""));
    },
    [onSlugClick],
  );

  return (
    <div ref={containerRef}>
      {fallbackUsed && (
        <div className="mb-4 text-xs text-amber-300 bg-amber-950/40 ring-1 ring-amber-900/60 rounded px-3 py-2">
          {t("docs.fallbackBanner")}
        </div>
      )}
      <div
        className="docs-prose"
        onClick={onClick}
        // markdown-it + bleach output is server-sanitized; we trust the
        // backend to strip <script> and inline handlers.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
