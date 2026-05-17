import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { projects, type GHRepo, type Me, type Project } from "../lib/api";

type View = { kind: "list" } | { kind: "detail"; slug: string } | { kind: "new" };

export function ProjectsPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "detail") {
    return <ProjectDetail slug={view.slug} me={me} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "new") {
    return (
      <ProjectEditor
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }
  return (
    <ProjectList
      onOpen={(slug) => setView({ kind: "detail", slug })}
      onNew={() => setView({ kind: "new" })}
    />
  );
}

function ProjectList({ onOpen, onNew }: { onOpen: (slug: string) => void; onNew: () => void }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ["projects"],
    queryFn: () => projects.list(),
  });

  return (
    <section data-testid="projects-list">
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("projects.title")}</h2>
        <button
          type="button"
          onClick={onNew}
          data-testid="project-new"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
        >
          {t("projects.new")}
        </button>
      </header>

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && list.data.length === 0 && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("projects.empty")}</p>
          <p className="text-slate-500 text-xs mt-2">{t("projects.emptyHint")}</p>
        </div>
      )}

      <ul className="space-y-3">
        {list.data?.map((p) => (
          <li
            key={p.id}
            className="bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-700 rounded-xl p-4 cursor-pointer transition"
            onClick={() => onOpen(p.slug)}
            data-testid={`project-card-${p.slug}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-slate-100 truncate">{p.name}</h3>
                <p className="text-xs text-slate-500 truncate">{p.created_by_email}</p>
              </div>
              <div className="text-xs text-slate-500 flex gap-2 shrink-0">
                <Badge>{p.visibility}</Badge>
                <span>·</span>
                <span>{p.member_count} 👥</span>
                <span>·</span>
                <span>{p.repo_count} 📦</span>
              </div>
            </div>
            {p.description && (
              <p className="text-sm text-slate-400 mt-2 line-clamp-2">{p.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectDetail({
  slug,
  me,
  onBack,
}: {
  slug: string;
  me: Me;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", slug], queryFn: () => projects.get(slug) });
  const repos = useQuery({ queryKey: ["project-repos", slug], queryFn: () => projects.repos(slug) });

  const isOwner = project.data?.created_by_email === me.user.email;

  const remove = useMutation({
    mutationFn: () => projects.remove(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onBack();
    },
  });

  return (
    <section data-testid="project-detail">
      <button
        type="button"
        onClick={onBack}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.back")}
      </button>

      {project.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {project.isSuccess && (
        <article className="space-y-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-slate-100">{project.data.name}</h2>
              <p className="text-xs text-slate-500 mt-1">
                {t("projects.by")} {project.data.created_by_email} ·{" "}
                <Badge>{project.data.visibility}</Badge>
              </p>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("projects.confirmDelete"))) remove.mutate();
                }}
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                {t("projects.delete")}
              </button>
            )}
          </header>

          {project.data.description && (
            <p className="text-slate-300 whitespace-pre-wrap">{project.data.description}</p>
          )}

          <div>
            <h3 className="font-medium text-slate-200 mb-2">{t("projects.repos.title")}</h3>
            {repos.isSuccess && repos.data.length === 0 && (
              <p className="text-slate-500 text-sm">{t("projects.repos.empty")}</p>
            )}
            <ul className="space-y-2">
              {repos.data?.map((r) => (
                <RepoCard key={r.id} repo={r} canManage={isOwner} projectSlug={slug} />
              ))}
            </ul>

            {isOwner && <AddRepoForm projectSlug={slug} />}
          </div>
        </article>
      )}
    </section>
  );
}

function RepoCard({
  repo,
  canManage,
  projectSlug,
}: {
  repo: GHRepo;
  canManage: boolean;
  projectSlug: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => projects.refreshRepo(repo.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-repos", projectSlug] }),
  });
  const remove = useMutation({
    mutationFn: () => projects.removeRepo(repo.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-repos", projectSlug] }),
  });

  return (
    <li
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3"
      data-testid={`repo-card-${repo.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <a
          href={repo.html_url}
          target="_blank"
          rel="noopener"
          className="font-mono text-sm text-indigo-300 hover:text-indigo-200 truncate"
        >
          {repo.full_name}
        </a>
        <div className="text-xs text-slate-500 flex gap-3 shrink-0">
          <span>★ {repo.stars}</span>
          <span>⑂ {repo.forks}</span>
          <span>{repo.open_issues} {t("projects.repos.issues")}</span>
          {repo.language && <span>· {repo.language}</span>}
        </div>
      </div>
      {repo.description && (
        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{repo.description}</p>
      )}
      {repo.last_status && repo.last_status !== "ok" && (
        <p className="text-xs text-amber-400 mt-1">⚠ {repo.last_status}</p>
      )}
      {canManage && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {refresh.isPending ? "…" : t("projects.repos.refresh")}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            className="text-xs text-rose-400 hover:text-rose-300"
          >
            {t("projects.repos.remove")}
          </button>
        </div>
      )}
    </li>
  );
}

function AddRepoForm({ projectSlug }: { projectSlug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const add = useMutation({
    mutationFn: () => projects.addRepo(projectSlug, fullName.trim()),
    onSuccess: () => {
      setFullName("");
      qc.invalidateQueries({ queryKey: ["project-repos", projectSlug] });
    },
  });

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (fullName.trim()) add.mutate();
      }}
    >
      <input
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="owner/repo"
        className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-sm text-slate-100 outline-none transition"
        data-testid="repo-add-input"
      />
      <button
        type="submit"
        disabled={add.isPending || !fullName.trim()}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-3 py-2 rounded-md transition"
      >
        {add.isPending ? "…" : t("projects.repos.add")}
      </button>
    </form>
  );
}

function ProjectEditor({
  onDone,
  onCancel,
}: {
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private" | "internal">("public");
  const create = useMutation({
    mutationFn: () => projects.create({ name, description, visibility }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onDone(p.slug);
    },
  });

  return (
    <section data-testid="project-editor">
      <button
        type="button"
        onClick={onCancel}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.cancel")}
      </button>
      <h2 className="text-xl font-semibold mb-4">{t("projects.new")}</h2>
      <form
        className="space-y-3 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">{t("projects.field.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
            data-testid="project-name"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("projects.field.description")}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("projects.field.visibility")}
          </span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          >
            <option value="public">{t("projects.visibility.public")}</option>
            <option value="internal">{t("projects.visibility.internal")}</option>
            <option value="private">{t("projects.visibility.private")}</option>
          </select>
        </label>
        {create.error && (
          <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
            {(create.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
          data-testid="project-create"
        >
          {create.isPending ? "…" : t("projects.create")}
        </button>
      </form>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
      {children}
    </span>
  );
}
