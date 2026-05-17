import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { articles, type ArticleListItem, type Me } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";

type View =
  | { kind: "list" }
  | { kind: "detail"; slug: string }
  | { kind: "new" }
  | { kind: "edit"; slug: string };

export function ArticlesPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "detail") {
    return (
      <ArticleDetail
        slug={view.slug}
        me={me}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", slug: view.slug })}
      />
    );
  }
  if (view.kind === "new") {
    return (
      <ArticleEditor
        me={me}
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "edit") {
    return (
      <ArticleEditor
        me={me}
        editSlug={view.slug}
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "detail", slug: view.slug })}
      />
    );
  }
  return <ArticleList onOpen={(slug) => setView({ kind: "detail", slug })} onNew={() => setView({ kind: "new" })} />;
}

// ---- List ----

function ArticleList({ onOpen, onNew }: { onOpen: (slug: string) => void; onNew: () => void }) {
  const { t, i18n } = useTranslation();
  const langPart = i18n.language.startsWith("cs") ? "cs" : "en";
  const list = useQuery({
    queryKey: ["articles", langPart],
    queryFn: () => articles.list({ language: langPart }),
  });

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("nav.articles")}</h2>
        <button
          type="button"
          onClick={onNew}
          data-testid="article-new"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
        >
          {t("articles.new")}
        </button>
      </header>

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && list.data.count === 0 && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("articles.empty")}</p>
          <p className="text-slate-500 text-xs mt-2">{t("articles.emptyHint")}</p>
        </div>
      )}

      <ul className="space-y-3">
        {list.data?.items.map((a) => (
          <ArticleCard key={a.id} article={a} onOpen={() => onOpen(a.slug)} />
        ))}
      </ul>
    </section>
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
        className="w-full text-left bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-700 rounded-xl p-4 transition"
      >
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-medium">{article.title}</h3>
          <span className="text-xs text-slate-500 font-mono">{article.language.toUpperCase()}</span>
        </div>
        {article.summary && <p className="text-sm text-slate-300 mt-1">{article.summary}</p>}
        <div className="mt-2 text-xs text-slate-500 flex items-center gap-3">
          <span>{article.author_display_name}</span>
          {date && <span>· {date}</span>}
          {article.doi && (
            <span className="font-mono text-slate-600">· DOI {article.doi}</span>
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
  me: Me;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["article", slug],
    queryFn: () => articles.get(slug),
  });
  const cmts = useQuery({
    queryKey: ["comments", slug],
    queryFn: () => articles.comments(slug),
  });

  const [commentText, setCommentText] = useState("");
  const post = useMutation({
    mutationFn: (text: string) => articles.postComment(slug, text),
    onSuccess: () => {
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["comments", slug] });
    },
  });

  if (detail.isLoading) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  if (detail.isError) return <p className="text-rose-400 text-sm">404</p>;
  const article = detail.data!;
  const isAuthor = article.author_email === me.user.email;
  const isOwnDraft = isAuthor && article.status !== "published";

  return (
    <article>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("articles.back")}
        </button>
        {isAuthor && (
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

      <header className="mb-6">
        <h2 className="text-2xl font-semibold">{article.title}</h2>
        <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
          <span>{article.author_display_name}</span>
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

      <div
        className="prose prose-invert max-w-none article-html"
        dangerouslySetInnerHTML={{ __html: article.content_html }}
      />

      <section className="mt-10 pt-6 border-t border-slate-800">
        <h3 className="text-lg font-medium mb-4">
          {t("articles.comments")} ({cmts.data?.count ?? 0})
        </h3>
        <ul className="space-y-3 mb-4">
          {cmts.data?.items.map((c) => (
            <li key={c.id} className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-3">
              <p className="text-xs text-slate-500 mb-1">
                <strong className="text-slate-300">{c.user_display_name}</strong>
                {" · "}
                {new Date(c.created_at).toLocaleString()}
              </p>
              <p
                className="text-sm text-slate-200 whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: c.text }}
              />
            </li>
          ))}
        </ul>

        {article.status === "published" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (commentText.trim()) post.mutate(commentText);
            }}
          >
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={3}
              placeholder={t("articles.commentPlaceholder")}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
            />
            <button
              type="submit"
              disabled={post.isPending || !commentText.trim()}
              className="mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-1.5 rounded-md transition"
            >
              {post.isPending ? "…" : t("articles.commentPost")}
            </button>
          </form>
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
      setHydrated(true);
    }
  }, [isEdit, existing.isSuccess, existing.data, hydrated]);

  const create = useMutation({
    mutationFn: () =>
      articles.create({
        title,
        summary,
        content_md: contentMd,
        language: i18n.language.startsWith("cs") ? "cs" : "en",
      }),
    onSuccess: (a) => onDone(a.slug),
  });
  const createAndPublish = useMutation({
    mutationFn: async () => {
      const a = await articles.create({
        title,
        summary,
        content_md: contentMd,
        language: i18n.language.startsWith("cs") ? "cs" : "en",
      });
      return articles.publish(a.slug);
    },
    onSuccess: (a) => onDone(a.slug),
  });
  const update = useMutation({
    mutationFn: () =>
      articles.patch(editSlug!, { title, summary, content_md: contentMd }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["article", a.slug] });
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      onDone(a.slug);
    },
  });
  const publishExisting = useMutation({
    mutationFn: async () => {
      await articles.patch(editSlug!, { title, summary, content_md: contentMd });
      return articles.publish(editSlug!);
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
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("articles.editor.titlePlaceholder")}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-lg"
        />
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t("articles.editor.summaryPlaceholder")}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
        />
        {hydrated ? (
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

      <div className="mt-4 flex gap-2">
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
              <button
                type="button"
                onClick={() => publishExisting.mutate()}
                disabled={!title.trim() || pending}
                className="bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm px-4 py-2 rounded-md ring-1 ring-slate-700 transition"
              >
                {publishExisting.isPending ? "…" : t("articles.editor.publish")}
              </button>
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
