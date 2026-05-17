import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { auth, projects, type GHIssue, type GHRepo, type Me, type Project } from "../lib/api";

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
  const [showIssues, setShowIssues] = useState(false);
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
        <RepoStatusWarning status={repo.last_status} />
      )}
      <div className="flex flex-wrap gap-3 mt-2">
        <button
          type="button"
          onClick={() => setShowIssues((s) => !s)}
          className="text-xs text-indigo-300 hover:text-indigo-200"
          data-testid={`repo-toggle-issues-${repo.id}`}
        >
          {showIssues ? "▾" : "▸"} {t("projects.issues.toggle")}
        </button>
        <a
          href={`${repo.html_url}/issues`}
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {t("projects.issues.openOnGh")} ↗
        </a>
        <a
          href={`${repo.html_url}/projects`}
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {t("projects.issues.boards")} ↗
        </a>
        {canManage && (
          <>
            <button
              type="button"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="text-xs text-slate-400 hover:text-slate-200 ml-auto"
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
          </>
        )}
      </div>
      {showIssues && <IssuesPanel repo={repo} />}
    </li>
  );
}

function RepoStatusWarning({ status }: { status: string }) {
  const { t } = useTranslation();
  let title = status;
  let hint: string | null = null;
  if (status === "not_found") {
    title = t("projects.repos.status.notFound");
    hint = t("projects.repos.status.notFoundHint");
  } else if (status === "rate_limited") {
    title = t("projects.repos.status.rateLimited");
    hint = t("projects.repos.status.rateLimitedHint");
  } else if (status.startsWith("error:")) {
    title = t("projects.repos.status.error");
    hint = status.slice(6).trim();
  }
  return (
    <div className="mt-2 bg-amber-950/40 ring-1 ring-amber-900/50 rounded-md px-2 py-1.5">
      <p className="text-xs text-amber-200 font-medium">⚠ {title}</p>
      {hint && <p className="text-xs text-amber-300/80 mt-0.5">{hint}</p>}
    </div>
  );
}

function IssuesPanel({ repo }: { repo: GHRepo }) {
  const { t } = useTranslation();
  const issues = useQuery({
    queryKey: ["repo-issues", repo.id],
    queryFn: () => projects.issues(repo.id),
  });
  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: () => auth.listIdentities(),
  });
  const hasGhIdentity = !!identities.data?.some(
    (i) => i.provider === "github" && i.has_token,
  );

  const repoUnreachable = repo.last_status === "not_found";
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <h4 className="text-xs font-medium text-slate-300 mb-2">
        {t("projects.issues.title")}
      </h4>
      {issues.isLoading && (
        <p className="text-xs text-slate-500">{t("common.loading")}</p>
      )}
      {issues.isSuccess && issues.data.length === 0 && (
        <p className="text-xs text-slate-500">
          {repoUnreachable
            ? t("projects.issues.repoUnreachable")
            : t("projects.issues.empty")}
        </p>
      )}
      <ul className="space-y-2">
        {issues.data?.map((issue) => (
          <IssueRow
            key={issue.number}
            issue={issue}
            repo={repo}
            canClaim={hasGhIdentity}
          />
        ))}
      </ul>
      {!hasGhIdentity && issues.data && issues.data.length > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          {t("projects.issues.needGhConnect")}
        </p>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  repo,
  canClaim,
}: {
  issue: GHIssue;
  repo: GHRepo;
  canClaim: boolean;
}) {
  const { t } = useTranslation();
  const [claimed, setClaimed] = useState<string | null>(null);
  const claim = useMutation({
    mutationFn: () => projects.claimIssue(repo.id, issue.number),
    onSuccess: (res) => {
      if (res.status === "ok" && res.html_url) {
        setClaimed(res.html_url);
      }
    },
  });

  const ghLink = issue.html_url || `${repo.html_url}/issues/${issue.number}`;

  return (
    <li
      className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2"
      data-testid={`issue-${issue.number}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={ghLink}
            target="_blank"
            rel="noopener"
            className="text-sm text-slate-100 hover:text-indigo-300"
          >
            #{issue.number} {issue.title}
          </a>
          <div className="flex flex-wrap gap-1 mt-1">
            {issue.labels.map((lab) => (
              <span
                key={lab.name}
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{
                  background: `#${lab.color || "475569"}33`,
                  color: `#${lab.color || "94a3b8"}`,
                  border: `1px solid #${lab.color || "475569"}66`,
                }}
              >
                {lab.name}
              </span>
            ))}
          </div>
          {issue.assignees.length > 0 && (
            <p className="text-[10px] text-slate-500 mt-1">
              {t("projects.issues.assignedTo")}:{" "}
              {issue.assignees.map((a) => a.login).join(", ")}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-slate-500 font-mono">{issue.state}</span>
          {issue.comments > 0 && (
            <span className="text-[10px] text-slate-500">💬 {issue.comments}</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <a
          href={ghLink}
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {t("projects.issues.openIssue")} ↗
        </a>
        {canClaim && !claimed && (
          <button
            type="button"
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
            className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            data-testid={`issue-claim-${issue.number}`}
          >
            {claim.isPending ? "…" : t("projects.issues.claim")}
          </button>
        )}
        {claimed && (
          <a
            href={claimed}
            target="_blank"
            rel="noopener"
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            ✓ {t("projects.issues.claimed")} ↗
          </a>
        )}
        {claim.data && claim.data.status !== "ok" && (
          <span className="text-xs text-rose-400">
            {claim.data.status}: {claim.data.detail}
          </span>
        )}
      </div>
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
    <div className="mt-3">
      <form
        className="flex gap-2"
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
      {add.error && (
        <p className="text-xs text-rose-400 mt-2" data-testid="repo-add-error">
          {(add.error as Error).message}
        </p>
      )}
    </div>
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
