import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, mastodon, type Article } from "../lib/api";

const MASTO_LIMIT = 500;

type Visibility = "public" | "unlisted" | "private";

export function MastodonShareModal({
  article,
  onClose,
}: {
  article: Article;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Initial perex: prefer user-written summary; fall back to first 300
  // characters of plain-text content extracted from the rendered HTML.
  const perex = useMemo(() => {
    if (article.summary?.trim()) return article.summary.trim();
    const plain = stripHtml(article.content_html).replace(/\s+/g, " ").trim();
    return plain.length > 300 ? plain.slice(0, 297).trimEnd() + "…" : plain;
  }, [article]);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/articles/${article.slug}`
      : `/articles/${article.slug}`;

  const [hashtagText, setHashtagText] = useState(defaultHashtags(article));
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("public");

  const composed = useMemo(() => {
    const tags = normalizeHashtags(hashtagText);
    const base = `📰 ${article.title}\n\n${perex}\n\n${url}`;
    return tags ? `${base}\n\n${tags}` : base;
  }, [article.title, perex, url, hashtagText]);

  const body = bodyOverride ?? composed;
  const remaining = MASTO_LIMIT - body.length;
  const overLimit = remaining < 0;

  const share = useMutation({
    mutationFn: () =>
      mastodon.post({ status: body, visibility }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="masto-share-modal"
    >
      <div
        className="w-full max-w-2xl bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-100">
            {t("mastodon.share.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm"
            aria-label={t("common.cancel")}
          >
            ✕
          </button>
        </header>

        {share.isSuccess ? (
          <SuccessView url={share.data.url} onClose={onClose} />
        ) : (
          <div className="px-4 py-3 space-y-3">
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">
                {t("mastodon.share.hashtags")}
              </span>
              <input
                value={hashtagText}
                onChange={(e) => {
                  setHashtagText(e.target.value);
                  setBodyOverride(null);
                }}
                placeholder="astronomy observatory čas"
                className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-3 py-1.5 text-sm text-slate-100 outline-none font-mono"
                data-testid="masto-share-hashtags"
              />
              <span className="text-[11px] text-slate-500">
                {t("mastodon.share.hashtagsHint")}
              </span>
            </label>

            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">
                {t("mastodon.share.body")}
              </span>
              <textarea
                value={body}
                onChange={(e) => setBodyOverride(e.target.value)}
                rows={10}
                className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-3 py-2 text-sm text-slate-100 outline-none whitespace-pre-wrap"
                data-testid="masto-share-body"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-slate-500">
                  {bodyOverride !== null && (
                    <button
                      type="button"
                      onClick={() => setBodyOverride(null)}
                      className="text-indigo-300 hover:text-indigo-200"
                    >
                      ↻ {t("mastodon.share.regenerate")}
                    </button>
                  )}
                </span>
                <span
                  className={`text-[11px] font-mono ${
                    overLimit
                      ? "text-rose-400"
                      : remaining < 50
                        ? "text-amber-300"
                        : "text-slate-500"
                  }`}
                >
                  {body.length} / {MASTO_LIMIT}
                </span>
              </div>
            </label>

            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">
                {t("mastodon.share.visibility")}
              </span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Visibility)}
                className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-2 py-1.5 text-sm text-slate-100 outline-none"
              >
                <option value="public">{t("mastodon.share.vis.public")}</option>
                <option value="unlisted">{t("mastodon.share.vis.unlisted")}</option>
                <option value="private">{t("mastodon.share.vis.private")}</option>
              </select>
            </label>

            {share.error && (
              <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
                {(share.error as ApiError).detail ||
                  (share.error as Error).message}
              </p>
            )}
          </div>
        )}

        {!share.isSuccess && (
          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-slate-400 hover:text-slate-200 px-3 py-1.5"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => share.mutate()}
              disabled={share.isPending || overLimit || !body.trim()}
              data-testid="masto-share-submit"
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-1.5 rounded-md transition"
            >
              {share.isPending ? "…" : t("mastodon.share.send")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function SuccessView({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-6 space-y-3 text-center">
      <p className="text-emerald-300 text-sm">✓ {t("mastodon.share.success")}</p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="inline-block text-sm text-indigo-300 hover:text-indigo-200 underline"
        >
          {t("mastodon.share.openOnMasto")} ↗
        </a>
      )}
      <div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm bg-slate-800 hover:bg-slate-700 ring-1 ring-slate-700 text-slate-200 px-3 py-1.5 rounded-md mt-3"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, "");
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function defaultHashtags(a: Article): string {
  // Sensible starter — language + 'astronomy'. User edits freely.
  return a.language === "cs"
    ? "astronomie astrozor"
    : "astronomy astrozor";
}

function normalizeHashtags(raw: string): string {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
}
