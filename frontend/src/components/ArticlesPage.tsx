import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  articles,
  auth,
  publishQuartoBundle,
  uploads,
  type ArticleListItem,
  type Me,
} from "../lib/api";
import { navigateTo, useUrlParam } from "../lib/urlParam";

// Engine icon — official brand SVG inside a colored square. Sized via
// the `size` prop: "sm" (24px) for inline filter chips & list rows,
// "lg" (64px) for the prominent badge on the article cards. The SVGs
// are static assets in /icons/ (downloaded once at build time from
// simpleicons, CC0). RMarkdown borrows the R-project logo since it
// has no separate brand mark.
const ENGINE_META: Record<
  ArticleListItem["engine"],
  { icon: string; bg: string; color: string }
> = {
  markdown:  { icon: "/icons/markdown.svg", bg: "bg-slate-800",     color: "#e2e8f0" },
  quarto:    { icon: "/icons/quarto.svg",   bg: "bg-indigo-950",    color: "#75AADB" },
  rmarkdown: { icon: "/icons/r.svg",        bg: "bg-sky-950",       color: "#276DC3" },
  jupyter:   { icon: "/icons/jupyter.svg",  bg: "bg-amber-950",     color: "#F37626" },
};

function EngineIcon({
  engine,
  size = "sm",
}: {
  engine: ArticleListItem["engine"];
  size?: "sm" | "lg";
}) {
  const { t } = useTranslation();
  const m = ENGINE_META[engine] ?? ENGINE_META.markdown;
  const label = t(`articles.engine.${engine}`);
  const wrap = size === "lg" ? "w-16 h-16 rounded-lg" : "w-6 h-6 rounded";
  const inner = size === "lg" ? "w-10 h-10" : "w-3.5 h-3.5";
  return (
    <span
      title={label}
      className={`inline-flex items-center justify-center ${wrap} ${m.bg} ring-1 ring-slate-700 shrink-0`}
      aria-label={label}
    >
      {/* CSS mask-image recolors a monochrome SVG without touching its
          source — the brand-correct color shows through as a single
          fill. Way more reliable than `filter: invert/...`. */}
      <span
        className={inner}
        aria-hidden
        style={{
          backgroundColor: m.color,
          WebkitMaskImage: `url(${m.icon})`,
          maskImage: `url(${m.icon})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          display: "inline-block",
        }}
      />
    </span>
  );
}
import { MarkdownEditor } from "./MarkdownEditor";
import { MastodonRail } from "./MastodonRail";
import { MastodonShareModal } from "./MastodonShareModal";
import { ThreadedDiscussion } from "./ThreadedDiscussion";
import { TagFilter, TagInput, TagsList } from "./Tags";
import { UserNameLink } from "./UserNameLink";

/**
 * Sandboxed iframe for pre-rendered Quarto/RMarkdown/Jupyter bundles.
 * Auto-resizes by polling the iframe's scrollHeight every 500 ms — we
 * stay same-origin (Caddy serves /media/* from astrozor.localhost), so
 * direct DOM access works. `sandbox` keeps the embedded JS from making
 * top-window navigations or popups but allows plotly/leaflet scripts.
 */
function QuartoIframe({ asset_url }: { asset_url: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(720);

  useEffect(() => {
    const id = window.setInterval(() => {
      const win = ref.current?.contentWindow;
      const doc = win?.document;
      if (!doc?.body) return;
      const h = Math.max(
        doc.body.scrollHeight,
        doc.documentElement?.scrollHeight ?? 0,
      );
      if (h && Math.abs(h - height) > 4) setHeight(h);
    }, 500);
    return () => window.clearInterval(id);
  }, [height]);

  return (
    <iframe
      ref={ref}
      src={asset_url}
      title="Pre-rendered article"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      style={{ width: "100%", height: `${height}px`, border: 0 }}
      className="bg-white rounded"
    />
  );
}

type View =
  | { kind: "list" }
  | { kind: "detail"; slug: string }
  | { kind: "new" }
  | { kind: "edit"; slug: string };

export function ArticlesPage({
  me,
  onRequireLogin,
}: {
  me: Me | null;
  onRequireLogin?: () => void;
}) {
  const { i18n } = useTranslation();
  // ?a=<slug> in the URL opens the article detail. List / new / edit
  // intentionally don't get URL slots — editor state is ephemeral and
  // not shareable.
  const [articleSlug, setArticleSlug] = useUrlParam("a");
  const [view, setView] = useState<View>(() =>
    articleSlug ? { kind: "detail", slug: articleSlug } : { kind: "list" },
  );
  // Sync popstate → view (browser Back closes the detail panel).
  useEffect(() => {
    if (articleSlug && (view.kind !== "detail" || view.slug !== articleSlug)) {
      setView({ kind: "detail", slug: articleSlug });
    } else if (!articleSlug && view.kind === "detail") {
      setView({ kind: "list" });
    }
  }, [articleSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  // Wrap setView so opening / closing the detail also updates the URL.
  const navigate = (next: View) => {
    setView(next);
    if (next.kind === "detail") setArticleSlug(next.slug);
    else if (next.kind === "list") setArticleSlug(null);
    // editor states leave the URL on whatever the article slug was; not
    // bookmarkable but also not destructive.
  };

  // Filter state lives here, NOT in ArticleList. ArticleList unmounts
  // every time the user opens a detail and remounts on back, which
  // would re-initialise its useState() and reset the lang chip back
  // to the UI's current language. Lifting up keeps the user's session-
  // long choice intact across the list ↔ detail roundtrip.
  const initialLang: "all" | "cs" | "en" = i18n.language.startsWith("cs")
    ? "cs"
    : "en";
  const [searchQ, setSearchQ] = useState("");
  const [engineFilter, setEngineFilter] = useState<"all" | ArticleListItem["engine"]>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [langFilter, setLangFilter] = useState<"all" | "cs" | "en">(initialLang);
  const [mobileTab, setMobileTab] = useState<"articles" | "mastodon">("articles");

  // Anon visitors can only browse: list + detail. Any attempt to enter
  // editor / new article funnels through onRequireLogin (login modal).
  if (view.kind === "detail") {
    return (
      <ArticleDetail
        slug={view.slug}
        me={me}
        onBack={() => navigate({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", slug: view.slug })}
        onRequireLogin={onRequireLogin}
      />
    );
  }
  if (view.kind === "new" && me) {
    return (
      <ArticleEditor
        me={me}
        onDone={(slug) => navigate({ kind: "detail", slug })}
        onCancel={() => navigate({ kind: "list" })}
      />
    );
  }
  if (view.kind === "edit" && me) {
    return (
      <ArticleEditor
        me={me}
        editSlug={view.slug}
        onDone={(slug) => navigate({ kind: "detail", slug })}
        onCancel={() => navigate({ kind: "detail", slug: view.slug })}
      />
    );
  }
  return (
    <ArticleList
      isAuthed={!!me}
      me={me}
      onOpen={(slug) => navigate({ kind: "detail", slug })}
      onNew={() => {
        if (me) setView({ kind: "new" });
        else onRequireLogin?.();
      }}
      searchQ={searchQ}
      setSearchQ={setSearchQ}
      engineFilter={engineFilter}
      setEngineFilter={setEngineFilter}
      tagFilter={tagFilter}
      setTagFilter={setTagFilter}
      langFilter={langFilter}
      setLangFilter={setLangFilter}
      mobileTab={mobileTab}
      setMobileTab={setMobileTab}
    />
  );
}

// ---- CoverImage: img with smooth fallback when load fails ----
//
// Three states:
//   1. Cover URL present + loads → renders the <img>
//   2. Cover URL present + fails (404 / CORS / blocked host) → renders
//      a deterministic gradient derived from the slug. Each article
//      gets a unique-looking but reproducible color set so the magazine
//      grid never shows broken-image icons.
//   3. No cover URL at all → same gradient fallback.
//
// The fallback is an inline SVG dataURL so there's no extra network
// request. Hue is computed from a tiny string hash of the slug; the
// star glyph in the centre maintains the brand identity.
function CoverImage({
  url,
  slug,
  className = "",
}: {
  url?: string;
  slug: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = !url || failed;
  if (showFallback) {
    return (
      <div
        aria-hidden
        className={`absolute inset-0 bg-cover bg-center ${className}`}
        style={{ backgroundImage: `url("${gradientCoverDataUrl(slug)}")` }}
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={`absolute inset-0 w-full h-full object-cover ${className}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// Cheap deterministic string hash → 32-bit int. Mirrors common
// implementations (cyrb53-lite). Not crypto, just stable colour pick.
function slugHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build a base64-encoded SVG cover with two HSL stops + a centered star.
// 16:9 because both the hero and grid cards use that aspect ratio.
function gradientCoverDataUrl(slug: string): string {
  const h = slugHash(slug || "x");
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  const sat1 = 40 + (h % 25);
  const sat2 = 35 + ((h >> 8) % 30);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1}, ${sat1}%, 18%)"/>
      <stop offset="100%" stop-color="hsl(${hue2}, ${sat2}%, 9%)"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#g)"/>
  <g fill="#f1f5f9" fill-opacity="0.12">
    <circle cx="280" cy="180" r="2"/>
    <circle cx="1340" cy="240" r="3"/>
    <circle cx="800" cy="120" r="1.5"/>
    <circle cx="1100" cy="640" r="2"/>
    <circle cx="200" cy="720" r="2.5"/>
    <circle cx="540" cy="560" r="1.5"/>
    <circle cx="1480" cy="780" r="2"/>
    <circle cx="960" cy="780" r="1.5"/>
  </g>
  <path d="M800 350 l28.5 87.7 92.2 0 -74.6 54.2 28.5 87.7 -74.6 -54.2 -74.6 54.2 28.5 -87.7 -74.6 -54.2 92.2 0z"
        fill="none" stroke="#f1f5f9" stroke-width="6" stroke-opacity="0.55"
        stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
  // unescape ensures UTF-8 bytes for btoa (handles ASCII fine here).
  return `data:image/svg+xml;base64,${typeof btoa !== "undefined" ? btoa(svg) : ""}`;
}

// ---- Filter bar helpers: visually-quiet grouped chip controls ----

/**
 * Labelled cluster used inside the filter bar. The label is a small
 * uppercase caption above the chips — keeps the bar readable without
 * relying on emoji prefixes inside each chip.
 */
function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-1 flex-wrap">{children}</div>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      className={`text-xs h-7 px-2.5 rounded-md ring-1 transition ${
        active
          ? "bg-indigo-600 ring-indigo-500 text-white"
          : "bg-slate-950 ring-slate-800 text-slate-300 hover:bg-slate-900 hover:ring-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

// ---- IDEPublishingIntro: hero + 4 IDE install cards ----
// First section of the articles page. Replaces the old single-tutorial
// IntroCallout. Each card opens a docs page (publish-* slug) explaining
// how to install + use that IDE for publishing. The hero copy sells
// the headline feature: interactive content (plotly, MathJax, code-fold)
// works the same regardless of which IDE the author used to write it.
function IDEPublishingIntro() {
  const { t } = useTranslation();

  const cards = [
    {
      slug: "publish-astrozor-editor",
      icon: "✍",
      title: t("articles.publishIntro.astrozor.title"),
      desc: t("articles.publishIntro.astrozor.desc"),
      tone: "bg-slate-800/60 ring-slate-700 hover:ring-slate-500",
    },
    {
      slug: "publish-vscode",
      icon: "🅥",
      title: t("articles.publishIntro.vscode.title"),
      desc: t("articles.publishIntro.vscode.desc"),
      tone: "bg-sky-950/40 ring-sky-900/50 hover:ring-sky-700",
    },
    {
      slug: "publish-rstudio",
      icon: "Ⓡ",
      title: t("articles.publishIntro.rstudio.title"),
      desc: t("articles.publishIntro.rstudio.desc"),
      tone: "bg-indigo-950/40 ring-indigo-900/50 hover:ring-indigo-700",
    },
    {
      slug: "publish-jupyter",
      icon: "📓",
      title: t("articles.publishIntro.jupyter.title"),
      desc: t("articles.publishIntro.jupyter.desc"),
      tone: "bg-amber-950/40 ring-amber-900/50 hover:ring-amber-700",
    },
  ];

  return (
    <section
      data-testid="article-publish-intro"
      className="w-full mb-6 bg-gradient-to-br from-indigo-950/70 via-slate-900/70 to-slate-900/40 ring-1 ring-indigo-800/40 rounded-xl p-5 sm:p-6 shadow-lg shadow-indigo-950/20"
    >
      <div className="max-w-3xl">
        <p className="text-[11px] uppercase tracking-wider text-indigo-300 font-medium">
          {t("articles.publishIntro.kicker")}
        </p>
        <h2 className="text-xl sm:text-2xl font-semibold text-slate-100 mt-1">
          {t("articles.publishIntro.title")}
        </h2>
        <p className="text-sm text-slate-300 mt-2 leading-relaxed">
          {t("articles.publishIntro.body")}
        </p>
        <ul className="text-sm text-slate-300 mt-3 space-y-1 list-disc list-inside">
          <li>{t("articles.publishIntro.bullet1")}</li>
          <li>{t("articles.publishIntro.bullet2")}</li>
          <li>{t("articles.publishIntro.bullet3")}</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {cards.map((c) => (
          <button
            key={c.slug}
            type="button"
            data-testid={`ide-card-${c.slug}`}
            onClick={() => navigateTo(`/docs?d=${c.slug}`)}
            className={`text-left rounded-lg p-3 sm:p-4 ring-1 transition ${c.tone}`}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-slate-950/60 text-xl shrink-0"
                aria-hidden
              >
                {c.icon}
              </span>
              <h3 className="text-sm font-semibold text-slate-100 leading-tight">
                {c.title}
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-snug">{c.desc}</p>
            <p className="text-xs text-indigo-300 mt-2 font-medium">
              {t("articles.publishIntro.openGuide")} →
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- Quarto bundle import modal ----
// Lives next to the "New" button in the article list — fits the user's
// mental model ("I'm here to add content") better than burying it in
// account settings. Same backend endpoint as the RStudio addin, just
// via session cookie instead of bearer token.

function QuartoImportModal({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: () =>
      publishQuartoBundle({
        bundle: file!,
        title: title.trim(),
        slug: slug.trim() || undefined,
        summary,
      }),
    onSuccess: (r) => onPublished(r.article_slug),
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-xl w-full max-w-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="font-medium">{t("articles.import.modalTitle")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
          >
            ✕
          </button>
        </header>

        <div className="p-4 space-y-3">
          <p
            className="text-xs text-slate-400"
            dangerouslySetInnerHTML={{ __html: t("articles.import.intro") }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) {
                setFile(f);
                if (!title) setTitle(f.name.replace(/\.zip$/i, ""));
              }
            }}
            className={`border-2 border-dashed rounded-md p-4 text-center text-sm transition ${
              dragging
                ? "border-indigo-500 bg-indigo-950/30"
                : "border-slate-700 bg-slate-950"
            }`}
          >
            {file ? (
              <p className="text-slate-300">
                📦 <strong>{file.name}</strong>{" "}
                <span className="text-slate-500">
                  ({(file.size / 1024 / 1024).toFixed(1)} MB)
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="ml-2 text-xs text-rose-400 hover:text-rose-300"
                >
                  {t("articles.import.remove")}
                </button>
              </p>
            ) : (
              <>
                <p className="text-slate-400">{t("articles.import.dropHere")}</p>
                <label className="inline-block mt-2 cursor-pointer bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-xs">
                  {t("articles.import.pickFile")}
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFile(f);
                        if (!title) setTitle(f.name.replace(/\.zip$/i, ""));
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("articles.import.title")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("articles.import.slug")}
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="muj-clanek"
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("articles.import.summary")}
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
            />
          </div>

          {upload.isError && (
            <p className="text-xs text-rose-400">
              {(upload.error as ApiError).detail}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-400 hover:text-slate-200 px-3 py-1.5"
          >
            {t("articles.import.cancel")}
          </button>
          <button
            type="button"
            onClick={() => upload.mutate()}
            disabled={!file || !title.trim() || upload.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-1.5 rounded-md transition"
          >
            {upload.isPending ? t("articles.import.uploading") : t("articles.import.publish")}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---- List ----

function ArticleList({
  isAuthed,
  me,
  onOpen,
  onNew,
  searchQ,
  setSearchQ,
  engineFilter,
  setEngineFilter,
  tagFilter,
  setTagFilter,
  langFilter,
  setLangFilter,
  mobileTab,
  setMobileTab,
}: {
  isAuthed: boolean;
  me: Me | null;
  onOpen: (slug: string) => void;
  onNew: () => void;
  // Filter state — owned by the parent ArticlesPage so it survives the
  // list ↔ detail round-trip (otherwise opening an EN article and
  // coming back would reset the lang chip to the UI language).
  searchQ: string;
  setSearchQ: (v: string) => void;
  engineFilter: "all" | ArticleListItem["engine"];
  setEngineFilter: (v: "all" | ArticleListItem["engine"]) => void;
  tagFilter: string[];
  setTagFilter: (v: string[]) => void;
  langFilter: "all" | "cs" | "en";
  setLangFilter: (v: "all" | "cs" | "en") => void;
  mobileTab: "articles" | "mastodon";
  setMobileTab: (v: "articles" | "mastodon") => void;
}) {
  const { t } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);

  // Fetch is unfiltered (lang=undefined) so all articles arrive once.
  // Filtering is client-side — instantaneous toggling between chips.
  const list = useQuery({
    queryKey: ["articles", "all-langs"],
    queryFn: () => articles.list({}),
  });

  // Client-side filter: works against the loaded list (server returns up
  // to ~50 published articles). When the dataset grows we'll push this
  // to the API (the `q` parameter is already wired for that — see
  // backend/apps/publishing/api.py list_articles).
  const filtered = useMemo(() => {
    const items = list.data?.items ?? [];
    const needle = searchQ.trim().toLowerCase();
    return items.filter((a) => {
      if (langFilter !== "all" && a.language !== langFilter) return false;
      if (engineFilter !== "all" && a.engine !== engineFilter) return false;
      // Tag filter — every selected tag must be present (AND across tags).
      if (tagFilter.length > 0) {
        const tagSet = new Set((a.tags ?? []).map((t) => t.toLowerCase()));
        if (!tagFilter.every((t) => tagSet.has(t.toLowerCase()))) return false;
      }
      if (!needle) return true;
      const hay = `${a.title} ${a.summary} ${a.author_display_name} ${(a.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [list.data, searchQ, engineFilter, langFilter, tagFilter]);

  return (
    <section>
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-xl font-semibold">{t("nav.articles")}</h2>
        <div className="flex gap-2">
          {isAuthed && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              data-testid="article-import"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm px-3 py-1.5 rounded-md transition ring-1 ring-slate-700"
              title={t("articles.import.buttonTitle")}
            >
              {t("articles.import.button")}
            </button>
          )}
          <button
            type="button"
            onClick={onNew}
            data-testid="article-new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
          >
            {t("articles.new")}
          </button>
        </div>
      </header>

      <IDEPublishingIntro />

      {importOpen && (
        <QuartoImportModal
          onClose={() => setImportOpen(false)}
          onPublished={(slug) => {
            setImportOpen(false);
            onOpen(slug);
          }}
        />
      )}

      {/* Tab bar — only visible below the lg breakpoint (1024 px).
          On wide screens both columns show side-by-side and the tabs
          are hidden; on narrow ones only the active tab's column
          renders, so Mastodon doesn't get pushed off the screen. */}
      <div className="lg:hidden flex gap-1 mb-4 bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setMobileTab("articles")}
          data-testid="articles-tab-articles"
          className={`flex-1 text-xs px-3 py-2 rounded transition ${
            mobileTab === "articles"
              ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          📰 {t("nav.articles")}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("mastodon")}
          data-testid="articles-tab-mastodon"
          className={`flex-1 text-xs px-3 py-2 rounded transition ${
            mobileTab === "mastodon"
              ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🐘 {t("articles.mastoRail.title")}
        </button>
      </div>

      {/* Split layout: community articles 2/3, Mastodon rail 1/3 on
          wide screens. Each column owns its own filter bar — the
          filter chips only affect the column they live in. On narrow
          viewports the lg:col-span classes collapse and only the
          active tab's column is visible (mobileTab guard). */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-6">
        <div
          className={`lg:col-span-2 lg:block ${
            mobileTab === "articles" ? "block" : "hidden"
          }`}
        >
          {/* Astrozor community-article filter bar — scoped to this
              column only. Jazyk / Engine / Tagy chips. */}
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl px-3 py-2.5 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-xs min-w-[180px]">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs pointer-events-none">🔍</span>
              <input
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder={t("articles.filter.searchPlaceholder")}
                data-testid="article-search"
                className="w-full bg-slate-950 ring-1 ring-slate-800 focus:ring-slate-600 rounded-md pl-7 pr-2.5 py-1.5 text-slate-100 outline-none text-sm placeholder:text-slate-600 transition"
              />
            </div>

            <FilterGroup label={t("articles.filter.langLabel")}>
              {(["all", "cs", "en"] as const).map((key) => (
                <ChipButton
                  key={key}
                  active={langFilter === key}
                  onClick={() => setLangFilter(key)}
                  testid={`article-lang-${key}`}
                >
                  {key === "all" ? t("articles.filter.all") : key.toUpperCase()}
                </ChipButton>
              ))}
            </FilterGroup>

            <FilterGroup label={t("articles.filter.engineLabel")}>
              <ChipButton
                active={engineFilter === "all"}
                onClick={() => setEngineFilter("all")}
                testid="article-engine-all"
              >
                {t("articles.filter.all")}
              </ChipButton>
              {(["markdown", "quarto", "rmarkdown", "jupyter"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEngineFilter(e)}
                  data-testid={`article-engine-${e}`}
                  title={t(`articles.engine.${e}`)}
                  aria-label={t(`articles.engine.${e}`)}
                  aria-pressed={engineFilter === e}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-md ring-1 transition ${
                    engineFilter === e
                      ? "ring-indigo-500 bg-indigo-600/20"
                      : "ring-slate-800 bg-slate-950 hover:bg-slate-900 hover:ring-slate-700"
                  }`}
                >
                  <EngineIcon engine={e} />
                </button>
              ))}
            </FilterGroup>

            <FilterGroup label={t("articles.filter.tagLabel")}>
              <TagFilter kind="articles" selected={tagFilter} onChange={setTagFilter} />
            </FilterGroup>
          </div>

          {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
          {list.isSuccess && list.data.count === 0 && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
              <p className="text-slate-400 text-sm">{t("articles.empty")}</p>
              <p className="text-slate-500 text-xs mt-2">{t("articles.emptyHint")}</p>
            </div>
          )}
          {list.isSuccess && list.data.count > 0 && filtered.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">
              {t("articles.filter.noMatches")}
            </p>
          )}

          {/* Hero (newest) inside the column so it doesn't span past
              the 2/3 width into the Mastodon rail. Hidden when a
              filter is active because the notion of "featured" no
              longer fits a filtered subset. */}
          {filtered.length > 0 && !searchQ && engineFilter === "all" && tagFilter.length === 0 && (
            <HeroCard
              article={filtered[0]!}
              onOpen={() => onOpen(filtered[0]!.slug)}
            />
          )}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered
              .slice(searchQ || engineFilter !== "all" || tagFilter.length > 0 ? 0 : 1)
              .map((a) => (
                <ArticleCard key={a.id} article={a} onOpen={() => onOpen(a.slug)} />
              ))}
          </ul>
        </div>
        <div
          className={`lg:col-span-1 lg:block ${
            mobileTab === "mastodon" ? "block" : "hidden"
          }`}
        >
          <MastodonRail me={me} />
        </div>
      </div>
    </section>
  );
}

// Hero card — large cover image, big title, summary preview. Used for
// the newest published article when no filters are active. Click =
// open detail. Visually distinct from grid cards so it reads as
// "this week's lead story".
function HeroCard({
  article,
  onOpen,
}: {
  article: ArticleListItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString()
    : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`article-hero-${article.slug}`}
      className="group w-full text-left mb-6 bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-600 rounded-2xl overflow-hidden transition shadow-xl shadow-black/30"
    >
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr]">
        <div className="relative aspect-[16/9] md:aspect-auto md:min-h-[180px] md:max-h-[260px] bg-slate-900 overflow-hidden">
          <CoverImage
            url={article.cover_image_url}
            slug={article.slug}
            className="group-hover:scale-[1.02] transition-transform duration-500"
          />
          <div className="absolute top-3 left-3 flex gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-indigo-600/90 text-white px-2 py-1 rounded-full font-medium backdrop-blur-sm shadow">
              {t("articles.featured")}
            </span>
            {article.visibility === "members" && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-amber-600/90 text-white px-2 py-1 rounded-full font-medium backdrop-blur-sm shadow">
                {t("articles.visibility.members")}
              </span>
            )}
          </div>
        </div>
        <div className="p-5 md:p-7 flex flex-col">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-3">
            <EngineIcon engine={article.engine} />
            <span className="uppercase tracking-wider">
              {t(`articles.engine.${article.engine}`)}
            </span>
            <span>·</span>
            <span>{article.language.toUpperCase()}</span>
            {article.reading_minutes > 0 && (
              <>
                <span>·</span>
                <span>{t("articles.minRead", { count: article.reading_minutes })}</span>
              </>
            )}
          </div>
          <h3 className="text-xl md:text-2xl font-semibold leading-tight text-slate-50 group-hover:text-white transition mb-2">
            {article.title}
          </h3>
          {article.summary && (
            <p className="text-sm md:text-[15px] text-slate-300 leading-relaxed line-clamp-4 mb-4">
              {article.summary}
            </p>
          )}
          <div className="mt-auto flex items-center gap-2 flex-wrap text-xs text-slate-400">
            <UserNameLink
              email={article.author_email}
              displayName={article.author_display_name}
              className="text-slate-300"
              testid={`article-hero-author-${article.slug}`}
            />
            {date && <span>· {date}</span>}
            {article.doi && (
              <span className="font-mono text-slate-500">· DOI {article.doi}</span>
            )}
          </div>
          {article.tags && article.tags.length > 0 && (
            <div className="mt-3">
              <TagsList tags={article.tags} size="xs" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function ArticleCard({ article, onOpen }: { article: ArticleListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const date = article.published_at ? new Date(article.published_at).toLocaleDateString() : "";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`article-card-${article.slug}`}
        className="group w-full h-full text-left bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-600 rounded-xl overflow-hidden transition flex flex-col"
      >
        {/* Cover image — full-bleed top. 16:9 to stay magazine-like. */}
        <div className="relative aspect-[16/9] bg-slate-900 overflow-hidden">
          <CoverImage
            url={article.cover_image_url}
            slug={article.slug}
            className="group-hover:scale-[1.03] transition-transform duration-500"
          />
          {/* Engine badge bottom-left of the cover (small, doesn't dominate). */}
          <div className="absolute bottom-2 left-2 flex gap-1.5">
            <span className="inline-flex items-center gap-1 bg-slate-950/80 backdrop-blur-sm ring-1 ring-slate-700/80 rounded px-1.5 py-0.5">
              <EngineIcon engine={article.engine} />
            </span>
            {article.visibility === "members" && (
              <span
                className="inline-flex items-center text-[10px] uppercase tracking-wider bg-amber-600/90 text-white px-1.5 py-0.5 rounded font-medium"
                title={t("articles.visibility.membersTooltip")}
              >
                🔒 {t("articles.visibility.members")}
              </span>
            )}
          </div>
        </div>

        <div className="p-4 flex flex-col flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            <span>{article.language.toUpperCase()}</span>
            {article.reading_minutes > 0 && (
              <>
                <span>·</span>
                <span>{t("articles.minRead", { count: article.reading_minutes })}</span>
              </>
            )}
          </div>
          <h3 className="text-base font-semibold leading-snug text-slate-100 group-hover:text-white transition line-clamp-2 mb-1.5">
            {article.title}
          </h3>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap mb-2">
            <UserNameLink
              email={article.author_email}
              displayName={article.author_display_name}
              className="text-slate-300"
              testid={`article-card-author-${article.slug}`}
            />
            {date && <span>· {date}</span>}
          </div>
          {article.summary && (
            <p className="text-sm text-slate-300 line-clamp-3 leading-relaxed">
              {article.summary}
            </p>
          )}
          {article.tags && article.tags.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-800/60">
              <TagsList tags={article.tags} size="xs" />
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

// ---- Detail ----

function ArticleDetail({
  slug,
  me,
  onBack,
  onEdit,
}: {
  slug: string;
  me: Me | null;
  onBack: () => void;
  onEdit: () => void;
  onRequireLogin?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ["article", slug],
    queryFn: () => articles.get(slug),
  });
  const cmts = useQuery({
    queryKey: ["comments", slug],
    queryFn: () => articles.comments(slug),
  });

  const [shareOpen, setShareOpen] = useState(false);

  // Author / publication state — derived even before article loads.
  // Hooks must be called unconditionally on every render (React rules of
  // hooks), so we keep the useQuery here and pass an `enabled` that
  // depends on data we'll have AFTER detail resolves. While detail is
  // loading, isAuthor is false → query stays disabled, no extra fetch.
  const article = detail.data;
  const isAuthor = !!article && !!me && article.author_email === me.user.email;
  // Admins can edit any community article — matches the backend, which
  // already grants is_staff full edit/delete permission on every
  // article. Pre-rendered Quarto/RMd/Jupyter bundles stay uneditable
  // either way (the ArticleEditor blocks edit on engine != markdown).
  const canEdit = isAuthor || !!me?.user.is_staff;
  const isPublished = !!article && article.status === "published";
  const isOwnDraft = isAuthor && article && article.status !== "published";

  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: () => auth.listIdentities(),
    enabled: isAuthor && isPublished,
  });
  const canShareToMasto = !!identities.data?.some(
    (i) => i.provider === "mastodon" && i.has_token,
  );

  if (detail.isLoading) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  if (detail.isError || !article) return <p className="text-rose-400 text-sm">404</p>;

  return (
    <article>
      <div className="flex items-center justify-between mb-4 gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("articles.back")}
        </button>
        <div className="flex items-center gap-2">
          {isAuthor && isPublished && canShareToMasto && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              data-testid="article-share-masto"
              className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 text-fuchsia-100 px-3 py-1 rounded-md ring-1 ring-fuchsia-700/70 transition"
            >
              🐘 {t("articles.shareMastodon")}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              data-testid="article-edit"
              className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 px-3 py-1 rounded-md ring-1 ring-slate-700 transition"
            >
              ✎ {t("articles.editor.edit")}
            </button>
          )}
        </div>
      </div>

      {shareOpen && (
        <MastodonShareModal
          article={article}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Header: title + meta (author, date, lang, license, DOI) on one
          inline-flex line so the eye reads the article identity in two
          rows max — even on narrow viewports where the meta wraps. */}
      <header className="mb-4">
        <h2 className="text-2xl font-semibold">{article.title}</h2>
        <p className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserNameLink
            email={article.author_email}
            displayName={article.author_display_name}
            className="text-slate-400"
            testid="article-detail-author"
          />
          {article.published_at && (
            <span>· {new Date(article.published_at).toLocaleString()}</span>
          )}
          <span>· {article.language.toUpperCase()}</span>
          <span>· {article.license}</span>
          {article.doi && <span className="font-mono">· DOI {article.doi}</span>}
        </p>
        {isOwnDraft && (
          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded bg-amber-900/40 ring-1 ring-amber-700/50 text-amber-300">
            {t("articles.draftBadge")}
          </span>
        )}
      </header>

      {/* Cover image + summary in a 2-column layout. The cover stays
          on the left in a constrained box (object-contain so a 800×600
          upload isn't cropped to a strip); the summary, if present,
          fills the right column so we don't leave a black gap. When
          there's only one of the two, the present element takes the
          full row at its natural max width. The cover image is skipped
          entirely when missing — no fallback gradient banner here,
          since the giant placeholder dwarfs the article. */}
      {(article.cover_image_url || article.summary?.trim()) && (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-6">
          {article.cover_image_url && (
            <img
              src={article.cover_image_url}
              alt=""
              className="block h-48 w-auto max-w-[16rem] shrink-0 rounded-md"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
          {article.summary?.trim() && (
            <p
              className="flex-1 text-sm sm:text-[15px] text-slate-300 leading-relaxed"
              data-testid="article-detail-summary"
            >
              {article.summary}
            </p>
          )}
        </div>
      )}

      {article.asset_url ? (
        // Bust browser cache on update — `updated_at` changes on each
        // republish so the iframe reloads instead of showing the old
        // bundle (which may have stale X-Frame-Options or removed
        // asset references).
        <QuartoIframe
          asset_url={`${article.asset_url}?v=${encodeURIComponent(article.updated_at)}`}
        />
      ) : (
        <div
          className="prose prose-invert max-w-none article-html"
          dangerouslySetInnerHTML={{ __html: article.content_html }}
        />
      )}

      <section className="mt-10 pt-6 border-t border-slate-800">
        <h3 className="text-lg font-medium mb-4">
          {t("articles.comments")} ({cmts.data?.count ?? 0})
        </h3>
        {article.status === "published" ? (
          <ThreadedDiscussion
            items={cmts.data?.items ?? []}
            me={me ?? null}
            queryKey={["comments", slug]}
            onPost={(body) => articles.postComment(slug, body)}
            onDelete={(id) => articles.deleteComment(id)}
            emptyLabel={t("articles.commentsEmpty")}
            testidPrefix="article-comment"
            inline
          />
        ) : (
          <p className="text-sm text-slate-500">{t("articles.commentsDraftHint")}</p>
        )}
      </section>
    </article>
  );
}

// ---- Editor: create new + edit existing ----

function ArticleEditor({
  me,
  editSlug,
  onDone,
  onCancel,
}: {
  me: Me;
  editSlug?: string;
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isEdit = !!editSlug;
  void me;

  // When editing, fetch existing article to prefill form
  const existing = useQuery({
    queryKey: ["article", editSlug],
    queryFn: () => articles.get(editSlug!),
    enabled: isEdit,
  });

  const NEW_TEMPLATE = "# Title\n\nWrite something **in Markdown**.\n";
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [contentMd, setContentMd] = useState(isEdit ? "" : NEW_TEMPLATE);
  // Language defaults to whatever UI lang the user currently has — but
  // is now an editable field, not a silent inference. Used for both
  // create (initial setting) and patch (correct or translate).
  const [language, setLanguage] = useState<"cs" | "en">(
    i18n.language.startsWith("cs") ? "cs" : "en",
  );
  const [tags, setTags] = useState<string[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState<string>("");
  const [mintDoi, setMintDoi] = useState(false);
  const doiAvailable = me.profile.has_zenodo_token;

  // Cover upload — server resizes to 1600 px max and re-encodes as JPEG,
  // so the same URL feeds both the magazine hero (1200 px) and grid
  // thumbs (400 px). On success we store the returned URL; the editor
  // shows a preview + "remove" button immediately. Until the user
  // saves the article, the cover only lives in component state — it's
  // persisted alongside the article via create/patch payload.
  const uploadCover = useMutation({
    mutationFn: (file: File) => uploads.articleCover(file),
    onSuccess: (r) => setCoverImageUrl(r.url),
  });
  // Baseline for the Diff view — the text we started from (either the
  // template for new articles, or the last saved version for edits).
  // Captured once at hydration, never updated mid-session so the diff
  // keeps comparing against where we began.
  const [baselineMd, setBaselineMd] = useState(isEdit ? "" : NEW_TEMPLATE);
  const [hydrated, setHydrated] = useState(!isEdit);

  // Hydrate form once when the existing article arrives
  useEffect(() => {
    if (isEdit && existing.isSuccess && !hydrated) {
      const a = existing.data;
      setTitle(a.title);
      setSummary(a.summary);
      const md = a.content_md || "";
      setContentMd(md);
      setBaselineMd(md);
      if (a.language === "cs" || a.language === "en") setLanguage(a.language);
      setTags(a.tags ?? []);
      setCoverImageUrl(a.cover_image_url || "");
      setHydrated(true);
    }
  }, [isEdit, existing.isSuccess, existing.data, hydrated]);

  const create = useMutation({
    mutationFn: () =>
      articles.create({
        title,
        summary,
        content_md: contentMd,
        language,
        tags,
        cover_image_url: coverImageUrl,
      }),
    onSuccess: (a) => onDone(a.slug),
  });
  const createAndPublish = useMutation({
    mutationFn: async () => {
      const a = await articles.create({
        title,
        summary,
        content_md: contentMd,
        language,
        tags,
        cover_image_url: coverImageUrl,
      });
      return articles.publish(a.slug, { mint_doi: mintDoi && doiAvailable });
    },
    onSuccess: (a) => onDone(a.slug),
  });
  const update = useMutation({
    mutationFn: () =>
      articles.patch(editSlug!, {
        title,
        summary,
        content_md: contentMd,
        language,
        tags,
        cover_image_url: coverImageUrl,
      }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["article", a.slug] });
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      onDone(a.slug);
    },
  });
  const publishExisting = useMutation({
    mutationFn: async () => {
      await articles.patch(editSlug!, {
        title,
        summary,
        content_md: contentMd,
        language,
        tags,
        cover_image_url: coverImageUrl,
      });
      return articles.publish(editSlug!, { mint_doi: mintDoi && doiAvailable });
    },
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["article", a.slug] });
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      onDone(a.slug);
    },
  });

  if (isEdit && existing.isLoading) {
    return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  }
  if (isEdit && existing.isError) {
    return <p className="text-rose-400 text-sm">404</p>;
  }

  // Pre-rendered engines (Quarto/RMarkdown/Jupyter) ship their content
  // as a bundled HTML directory served through an iframe — the markdown
  // editor has nothing to edit there. The user can still change title +
  // summary, and re-uploading via the addin / Import dialog replaces
  // the rendered bundle (idempotent on slug).
  const engine: ArticleListItem["engine"] = existing.data?.engine ?? "markdown";
  const isPreRendered = isEdit && engine !== "markdown";
  const isPublished = isEdit && existing.data?.status === "published";
  const pending =
    create.isPending ||
    createAndPublish.isPending ||
    update.isPending ||
    publishExisting.isPending;
  const error =
    (create.error as Error | null) ||
    (createAndPublish.error as Error | null) ||
    (update.error as Error | null) ||
    (publishExisting.error as Error | null);

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          {isEdit ? t("articles.editor.editing") : t("articles.new")}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          {t("common.cancel")}
        </button>
      </header>

      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("articles.editor.titlePlaceholder")}
            className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-lg"
          />
          <div className="shrink-0">
            <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wide">
              {t("articles.editor.language")}
            </label>
            <div className="flex gap-0.5">
              {(["cs", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  data-testid={`article-editor-lang-${lang}`}
                  className={`text-xs px-3 py-1.5 ring-1 transition first:rounded-l-md last:rounded-r-md ${
                    language === lang
                      ? "bg-indigo-600 ring-indigo-500 text-white"
                      : "bg-slate-950 ring-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t("articles.editor.summaryPlaceholder")}
          rows={4}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm resize-y min-h-[6rem] max-h-[18rem] overflow-auto"
        />
        <CoverUploader
          value={coverImageUrl}
          onChange={setCoverImageUrl}
          uploading={uploadCover.isPending}
          error={uploadCover.error as ApiError | null}
          onFile={(f) => uploadCover.mutate(f)}
        />
        <div>
          <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wide">
            🏷 Tagy
          </label>
          <TagInput value={tags} onChange={setTags} />
        </div>
        {isPreRendered ? (
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-4 text-sm text-slate-300 flex items-start gap-3">
            <EngineIcon engine={engine} />
            <div className="flex-1">
              <p className="font-medium text-slate-100">
                {t("articles.editor.preRenderedTitle")}
              </p>
              <p
                className="text-slate-400 mt-1"
                dangerouslySetInnerHTML={{
                  __html: t("articles.editor.preRenderedBody", {
                    engine:
                      engine === "quarto"
                        ? "Quarto"
                        : engine === "rmarkdown"
                          ? "R Markdown"
                          : "Jupyter",
                  }),
                }}
              />
            </div>
          </div>
        ) : hydrated ? (
          <MarkdownEditor
            key={editSlug ?? "new"}
            markdown={contentMd}
            originalMarkdown={baselineMd}
            onChange={setContentMd}
            placeholder="Začni psát článek…"
          />
        ) : (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {!isEdit && (
          <>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!title.trim() || pending}
              className="bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm px-4 py-2 rounded-md ring-1 ring-slate-700 transition"
            >
              {create.isPending ? "…" : t("articles.editor.saveDraft")}
            </button>
            <button
              type="button"
              onClick={() => createAndPublish.mutate()}
              disabled={!title.trim() || pending}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition"
            >
              {createAndPublish.isPending ? "…" : t("articles.editor.publish")}
            </button>
            <DoiCheckbox
              checked={mintDoi}
              onChange={setMintDoi}
              available={doiAvailable}
            />
          </>
        )}
        {isEdit && (
          <>
            <button
              type="button"
              onClick={() => update.mutate()}
              disabled={!title.trim() || pending}
              data-testid="article-save"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition"
            >
              {update.isPending
                ? "…"
                : isPublished
                  ? t("articles.editor.saveChanges")
                  : t("articles.editor.saveDraft")}
            </button>
            {!isPublished && (
              <>
                <button
                  type="button"
                  onClick={() => publishExisting.mutate()}
                  disabled={!title.trim() || pending}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm px-4 py-2 rounded-md ring-1 ring-slate-700 transition"
                >
                  {publishExisting.isPending ? "…" : t("articles.editor.publish")}
                </button>
                <DoiCheckbox
                  checked={mintDoi}
                  onChange={setMintDoi}
                  available={doiAvailable}
                />
              </>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-400">{error.message}</p>
      )}
    </section>
  );
}

// Cover image picker with drag-drop + URL fallback.
//
// Three states: empty (drop zone), uploading (spinner), uploaded
// (16:9 preview + remove button). User can also paste a URL manually
// in case they want to point at an external image (e.g. NASA APOD).
//
// 16:9 preview mirrors how the hero card renders it on the magazine
// list — gives the author an immediate "this is what readers will see".
function CoverUploader({
  value,
  onChange,
  onFile,
  uploading,
  error,
}: {
  value: string;
  onChange: (url: string) => void;
  onFile: (f: File) => void;
  uploading: boolean;
  error: ApiError | null;
}) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wide">
        🖼 {t("articles.editor.cover")}
      </label>

      {value ? (
        <div className="relative aspect-[16/9] bg-slate-900 ring-1 ring-slate-700 rounded-md overflow-hidden group">
          <img
            src={value}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="bg-slate-900/80 hover:bg-slate-800 backdrop-blur-sm text-slate-100 text-xs px-2 py-1 rounded ring-1 ring-slate-700"
              data-testid="article-cover-replace"
            >
              {t("articles.editor.coverReplace")}
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="bg-rose-900/70 hover:bg-rose-800 backdrop-blur-sm text-rose-100 text-xs px-2 py-1 rounded ring-1 ring-rose-700/60"
              data-testid="article-cover-remove"
            >
              ✕ {t("articles.editor.coverRemove")}
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`aspect-[16/9] rounded-md border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition text-center px-4 ${
            dragging
              ? "border-indigo-500 bg-indigo-950/30 text-indigo-200"
              : uploading
                ? "border-slate-700 bg-slate-950 text-slate-400"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500 hover:text-slate-300"
          }`}
          data-testid="article-cover-dropzone"
        >
          {uploading ? (
            <p className="text-sm">{t("articles.editor.coverUploading")}</p>
          ) : (
            <>
              <p className="text-3xl mb-1">🖼</p>
              <p className="text-sm">{t("articles.editor.coverDropHere")}</p>
              <p className="text-[11px] text-slate-500 mt-1">
                {t("articles.editor.coverHint")}
              </p>
            </>
          )}
        </div>
      )}

      {/* Hidden file input — opened by the dropzone click or
          "Replace" button on top of the preview. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Reset value so the same file can be re-picked after a
          // failed upload (browser otherwise dedupes).
          e.target.value = "";
        }}
        data-testid="article-cover-input"
      />

      {/* Manual URL fallback for power users (e.g. paste NASA APOD URL). */}
      <details className="mt-2 group">
        <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-400 select-none">
          {t("articles.editor.coverUrlToggle")}
        </summary>
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/cover.jpg"
          className="mt-1 w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 outline-none text-xs"
          data-testid="article-cover-url"
        />
      </details>

      {error && (
        <p className="mt-2 text-xs text-rose-400" data-testid="article-cover-error">
          {error.detail || error.message}
        </p>
      )}
    </div>
  );
}

function DoiCheckbox({
  checked,
  onChange,
  available,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  available: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label
      className={`flex items-center gap-2 text-xs select-none ${
        available ? "text-slate-300 cursor-pointer" : "text-slate-600 cursor-not-allowed"
      }`}
      title={
        available
          ? t("articles.editor.doiHint")
          : t("articles.editor.doiUnavailable")
      }
    >
      <input
        type="checkbox"
        checked={available && checked}
        disabled={!available}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="mint-doi"
        className="accent-indigo-500"
      />
      <span>{t("articles.editor.mintDoi")}</span>
    </label>
  );
}
