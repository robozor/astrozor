import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  auth,
  projects,
  type GHContributor,
  type GHIssue,
  type GHIssueComment,
  type GHIssueDetail,
  type GHIssueType,
  type GHRepo,
  type Me,
  type Project,
  type ProjectMember,
} from "../lib/api";
import { MarkdownComposer } from "./MarkdownComposer";
import { ProjectActivityGraph } from "./ProjectActivityGraph";
import { proseMarkdownClass } from "./proseClasses";
import { TagFilter, TagInput, TagsList } from "./Tags";

type View =
  | { kind: "list" }
  | { kind: "detail"; slug: string }
  | { kind: "new" }
  | { kind: "edit"; slug: string };

export function ProjectsPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "detail") {
    return (
      <ProjectDetail
        slug={view.slug}
        me={me}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", slug: view.slug })}
      />
    );
  }
  if (view.kind === "new") {
    return (
      <ProjectEditor
        existingSlug={null}
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "edit") {
    return (
      <ProjectEditor
        existingSlug={view.slug}
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "detail", slug: view.slug })}
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

/** Render plain text with bare http(s) URLs converted to safe
 *  external links. Used in project descriptions where the user
 *  may paste a homepage URL (e.g. for Bolidozor → bolidozor.cz)
 *  and expect it to be clickable without learning markdown.
 *
 *  The regex matches an http/https URL; we strip trailing
 *  punctuation that's commonly written *after* a URL in prose
 *  (period/comma/closing parens/quotes) so "see https://x.com." gives
 *  a link to "https://x.com" instead of "https://x.com.".
 */
function linkifyText(text: string): ReactNode[] {
  const URL_RX = /(https?:\/\/[^\s<>"']+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RX.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    let url = m[1];
    let trailing = "";
    while (url.length > 0 && ".,!?;:)]}".includes(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }
    nodes.push(
      <a
        key={`a-${m.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-400 hover:text-indigo-300 underline"
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = m.index + m[1].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function ProjectList({
  onOpen,
  onNew,
}: {
  onOpen: (slug: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ["projects"],
    queryFn: () => projects.list(),
  });
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const filtered = (list.data ?? []).filter((p) => {
    if (tagFilter.length === 0) return true;
    const tagSet = new Set((p.tags ?? []).map((t) => t.toLowerCase()));
    return tagFilter.every((t) => tagSet.has(t.toLowerCase()));
  });

  return (
    <section data-testid="projects-list">
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-xl font-semibold">{t("projects.title")}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <TagFilter kind="projects" selected={tagFilter} onChange={setTagFilter} />
          <button
            type="button"
            onClick={onNew}
            data-testid="project-new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
          >
            {t("projects.new")}
          </button>
        </div>
      </header>

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && list.data.length === 0 && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("projects.empty")}</p>
          <p className="text-slate-500 text-xs mt-2">{t("projects.emptyHint")}</p>
        </div>
      )}

      <ul className="space-y-3">
        {filtered.map((p) => (
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
                <span>👥 {p.member_count}</span>
                <span>·</span>
                <span>📦 {p.repo_count}</span>
              </div>
            </div>
            {p.description && (
              <p className="text-sm text-slate-400 mt-2 line-clamp-2">
                {linkifyText(p.description)}
              </p>
            )}
            {p.tags && p.tags.length > 0 && (
              <div className="mt-2">
                <TagsList tags={p.tags} size="xs" />
              </div>
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
  onEdit,
}: {
  slug: string;
  me: Me;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const project = useQuery({
    queryKey: ["project", slug],
    queryFn: () => projects.get(slug),
  });
  const repos = useQuery({
    queryKey: ["project-repos", slug],
    queryFn: () => projects.repos(slug),
  });

  const remove = useMutation({
    mutationFn: () => projects.remove(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onBack();
    },
  });
  const join = useMutation({
    mutationFn: () => projects.join(slug),
    onSuccess: (p) => {
      qc.setQueryData(["project", slug], p);
      qc.invalidateQueries({ queryKey: ["project-members", slug] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const leave = useMutation({
    mutationFn: () => projects.leave(slug),
    onSuccess: (p) => {
      qc.setQueryData(["project", slug], p);
      qc.invalidateQueries({ queryKey: ["project-members", slug] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const p = project.data;
  const canEdit = !!p?.can_edit;

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
      {project.isSuccess && p && (
        <article className="space-y-4">
          <header className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold text-slate-100">{p.name}</h2>
              <p className="text-xs text-slate-500 mt-1">
                {t("projects.by")} {p.created_by_email} · <Badge>{p.visibility}</Badge>
                {p.status !== "active" && (
                  <>
                    {" · "}
                    <Badge>{p.status}</Badge>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.is_member ? (
                <button
                  type="button"
                  onClick={() => leave.mutate()}
                  disabled={leave.isPending || p.created_by_email === me.user.email}
                  className="text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-300 ring-1 ring-slate-700 px-3 py-1.5 rounded transition"
                  title={
                    p.created_by_email === me.user.email
                      ? t("projects.creatorCantLeave")
                      : undefined
                  }
                >
                  {t("projects.leave")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => join.mutate()}
                  disabled={join.isPending}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition"
                  data-testid="project-join"
                >
                  {t("projects.join")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-3 py-1.5 rounded transition"
                  data-testid="project-edit"
                >
                  {t("projects.edit")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("projects.confirmDelete"))) remove.mutate();
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1.5"
                >
                  {t("projects.delete")}
                </button>
              )}
            </div>
          </header>

          {p.description && (
            <p className="text-slate-300 whitespace-pre-wrap">
              {linkifyText(p.description)}
            </p>
          )}
          {p.tags.length > 0 && <TagsList tags={p.tags} size="xs" />}

          <MembersWidget slug={slug} memberCount={p.member_count} />

          <ProjectActivityGraph slug={slug} />

          <div>
            <h3 className="font-medium text-slate-200 mb-2">
              {t("projects.repos.title")}{" "}
              <span className="text-xs text-slate-500 font-normal">
                · {p.repo_count}
              </span>
            </h3>
            {repos.isSuccess && repos.data.length === 0 && (
              <p className="text-slate-500 text-sm">{t("projects.repos.empty")}</p>
            )}
            <ul className="space-y-3">
              {repos.data?.map((r) => (
                <RepoCard
                  key={r.id}
                  repo={r}
                  canManage={canEdit}
                  projectSlug={slug}
                />
              ))}
            </ul>

            {canEdit && <AddRepoForm projectSlug={slug} />}
          </div>
        </article>
      )}
    </section>
  );
}

function MembersWidget({
  slug,
  memberCount,
}: {
  slug: string;
  memberCount: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const members = useQuery({
    queryKey: ["project-members", slug],
    queryFn: () => projects.members(slug),
    enabled: open,
    staleTime: 60_000,
  });
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center justify-between w-full text-left"
        data-testid="project-members-toggle"
      >
        <span className="text-sm font-medium text-slate-200">
          👥 {t("projects.members.heading")}{" "}
          <span className="text-xs text-slate-500 ml-1">· {memberCount}</span>
        </span>
        <span className="text-slate-500 text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {members.isLoading && (
            <p className="text-xs text-slate-500">{t("common.loading")}</p>
          )}
          {members.data && members.data.length === 0 && (
            <p className="text-xs text-slate-500 italic">
              {t("projects.members.empty")}
            </p>
          )}
          {members.data && members.data.length > 0 && (
            <ul className="space-y-1.5">
              {members.data.map((m) => (
                <MemberRow key={m.user_email} member={m} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: ProjectMember }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex items-center gap-2 text-xs"
      data-testid={`member-${member.user_email}`}
    >
      <Avatar src={member.avatar_url} name={member.user_display_name} size={24} />
      <span className="text-slate-200 truncate flex-1 min-w-0">
        {member.user_display_name}
      </span>
      {member.is_creator && (
        <span className="text-[9px] bg-amber-900/40 text-amber-200 ring-1 ring-amber-900/60 px-1 py-0.5 rounded">
          {t("projects.members.creator")}
        </span>
      )}
      <span className="text-[10px] text-slate-500 font-mono uppercase">
        {member.role}
      </span>
    </li>
  );
}

function Avatar({
  src,
  name,
  size = 24,
}: {
  src: string;
  name: string;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        className="rounded-full ring-1 ring-slate-800 object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full ring-1 ring-slate-800 bg-slate-800 grid place-items-center text-[10px] text-slate-400 shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}

function relTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, sec] of units) {
    if (Math.abs(diffSec) >= sec) {
      return rtf.format(Math.round(diffSec / sec), unit);
    }
  }
  return rtf.format(diffSec, "second");
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
  const { t, i18n } = useTranslation();
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
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid={`repo-card-${repo.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener"
            className="font-mono text-sm text-indigo-300 hover:text-indigo-200 truncate inline-block max-w-full"
          >
            📦 {repo.full_name}
          </a>
          {repo.description && (
            <p className="text-xs text-slate-400 line-clamp-2">{repo.description}</p>
          )}
          {repo.topics && repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {repo.topics.slice(0, 8).map((topic) => (
                <span
                  key={topic}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-200 ring-1 ring-indigo-900/60"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500 flex gap-3 shrink-0 items-center">
          <span title={t("projects.repos.stars")}>★ {repo.stars}</span>
          <span title={t("projects.repos.forks")}>⑂ {repo.forks}</span>
          {repo.language && (
            <span className="font-mono text-[10px] bg-slate-800/60 px-1.5 py-0.5 rounded">
              {repo.language}
            </span>
          )}
        </div>
      </div>

      {repo.last_status && repo.last_status !== "ok" && (
        <RepoStatusWarning status={repo.last_status} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <RepoMetric
          icon="📅"
          label={t("projects.repos.lastCommit")}
          value={
            repo.last_commit_at ? relTime(repo.last_commit_at, i18n.language) : "—"
          }
          title={repo.last_commit_at ?? undefined}
        />
        <RepoMetric
          icon="🏷"
          label={t("projects.repos.lastRelease")}
          value={
            repo.last_release_tag
              ? `${repo.last_release_tag} · ${relTime(repo.last_release_at, i18n.language)}`
              : t("projects.repos.noReleases")
          }
          href={repo.last_release_url || undefined}
        />
        <RepoMetric
          icon="🐛"
          label={t("projects.repos.openIssuesLabel")}
          value={String(repo.open_issues)}
        />
      </div>

      {repo.top_contributors && repo.top_contributors.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            {t("projects.repos.team")}
          </div>
          <ContributorsRow contributors={repo.top_contributors} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          onClick={() => setShowIssues((s) => !s)}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded transition"
          data-testid={`repo-toggle-issues-${repo.id}`}
        >
          {showIssues ? "▾" : "▸"} {t("projects.issues.toggle", { count: repo.open_issues })}
        </button>
        <a
          href={`${repo.html_url}/issues`}
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {t("projects.issues.openOnGh")} ↗
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

function RepoMetric({
  icon,
  label,
  value,
  href,
  title,
}: {
  icon: string;
  label: string;
  value: string;
  href?: string;
  title?: string;
}) {
  const inner = (
    <div
      className="bg-slate-900/60 ring-1 ring-slate-800 rounded px-2.5 py-1.5"
      title={title}
    >
      <div className="text-[10px] uppercase text-slate-500">
        {icon} {label}
      </div>
      <div className="font-mono text-slate-200 text-xs truncate">{value}</div>
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener" className="block hover:ring-slate-700">
        {inner}
      </a>
    );
  }
  return inner;
}

function ContributorsRow({ contributors }: { contributors: GHContributor[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {contributors.slice(0, 10).map((c) => (
        <a
          key={c.login}
          href={c.html_url}
          target="_blank"
          rel="noopener"
          title={`${c.login} · ${c.contributions} commits`}
        >
          <Avatar src={c.avatar_url} name={c.login} size={28} />
        </a>
      ))}
      {contributors.length > 10 && (
        <span className="text-[10px] text-slate-500 font-mono">
          +{contributors.length - 10}
        </span>
      )}
    </div>
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
    <div className="bg-amber-950/40 ring-1 ring-amber-900/50 rounded-md px-2 py-1.5">
      <p className="text-xs text-amber-200 font-medium">⚠ {title}</p>
      {hint && <p className="text-xs text-amber-300/80 mt-0.5">{hint}</p>}
    </div>
  );
}

type IssueStateFilter = "all" | "new" | "in_progress" | "blocked";
type IssuePriorityFilter = "all" | "high" | "normal" | "low";
type IssueSort = "priority" | "newest" | "oldest" | "updated" | "comments";

/** Numeric weight for priority sort — higher = appears first.
 *  Tie-breaker is created_at (newest first) so within "high" you
 *  still see the freshest issue on top. */
function priorityRank(p: IssuePriorityFilter): number {
  if (p === "high") return 3;
  if (p === "normal") return 2;
  if (p === "low") return 1;
  return 0;
}

/** Derive a workflow sub-state from an issue's labels + assignees.
 *
 * GitHub itself has only ``open`` / ``closed`` — projects use labels
 * to express finer states (in-progress, blocked, etc.). We inspect
 * common conventions; anything that doesn't match falls under "new".
 */
function issueSubState(issue: GHIssue): IssueStateFilter {
  const labels = issue.labels.map((l) => l.name.toLowerCase());
  if (labels.some((l) => l.includes("block"))) return "blocked";
  if (
    issue.assignees.length > 0 ||
    labels.some(
      (l) =>
        l.includes("in progress") ||
        l.includes("in-progress") ||
        l === "wip" ||
        l.includes("doing"),
    )
  ) {
    return "in_progress";
  }
  return "new";
}

function issuePriority(issue: GHIssue): IssuePriorityFilter {
  const labels = issue.labels.map((l) => l.name.toLowerCase());
  if (
    labels.some(
      (l) =>
        l.includes("p0") ||
        l.includes("p1") ||
        l.includes("priority:high") ||
        l === "high" ||
        l.includes("urgent") ||
        l.includes("critical"),
    )
  ) {
    return "high";
  }
  if (
    labels.some(
      (l) =>
        l.includes("priority:low") || l === "low" || l.includes("trivial"),
    )
  ) {
    return "low";
  }
  return "normal";
}

function IssuesPanel({ repo }: { repo: GHRepo }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
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

  const [stateFilter, setStateFilter] = useState<IssueStateFilter>("all");
  const [priorityFilter, setPriorityFilter] =
    useState<IssuePriorityFilter>("all");
  // Priority-first by default — the user sees the highest-priority
  // issues at the top without picking a sort each time. Ties fall
  // back to newest-first inside the same priority bucket.
  const [sort, setSort] = useState<IssueSort>("priority");
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  useEffect(() => {
    if (issues.isSuccess && repo.last_status && repo.last_status !== "ok") {
      qc.invalidateQueries({ queryKey: ["project-repos", repo.project_slug] });
    }
  }, [issues.isSuccess, repo.last_status, repo.project_slug, qc]);

  const filteredSorted = useMemo(() => {
    const all = issues.data ?? [];
    const filtered = all.filter((it) => {
      if (stateFilter !== "all" && issueSubState(it) !== stateFilter) return false;
      if (priorityFilter !== "all" && issuePriority(it) !== priorityFilter)
        return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "updated":
          return b.updated_at.localeCompare(a.updated_at);
        case "comments":
          return b.comments - a.comments;
        case "priority": {
          const diff = priorityRank(issuePriority(b)) - priorityRank(issuePriority(a));
          if (diff !== 0) return diff;
          // Same priority → newest-first tie-breaker so freshest
          // high-priority bug bubbles to the top of its bucket.
          return b.created_at.localeCompare(a.created_at);
        }
        case "newest":
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return sorted;
  }, [issues.data, stateFilter, priorityFilter, sort]);

  const repoUnreachable = repo.last_status === "not_found";
  const totalCount = issues.data?.length ?? 0;
  const filteredCount = filteredSorted.length;
  return (
    <div className="border-t border-slate-800 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-medium text-slate-300 flex items-center gap-2">
          <span>
            {t("projects.issues.title")}
            {issues.data && (
              <span className="text-slate-500 font-normal ml-1">
                · {filteredCount === totalCount
                  ? totalCount
                  : `${filteredCount} / ${totalCount}`}
              </span>
            )}
          </span>
          {hasGhIdentity && !repoUnreachable && (
            <button
              type="button"
              onClick={() => setNewIssueOpen(true)}
              className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition"
              data-testid={`new-issue-button-${repo.id}`}
            >
              + {t("projects.issues.newIssue")}
            </button>
          )}
        </h4>
        {issues.data && issues.data.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <IssueSelect
              value={stateFilter}
              onChange={(v) => setStateFilter(v as IssueStateFilter)}
              label={t("projects.issues.filterState")}
              options={[
                ["all", t("projects.issues.stateAll")],
                ["new", t("projects.issues.stateNew")],
                ["in_progress", t("projects.issues.stateInProgress")],
                ["blocked", t("projects.issues.stateBlocked")],
              ]}
            />
            <IssueSelect
              value={priorityFilter}
              onChange={(v) => setPriorityFilter(v as IssuePriorityFilter)}
              label={t("projects.issues.filterPriority")}
              options={[
                ["all", t("projects.issues.priorityAll")],
                ["high", t("projects.issues.priorityHigh")],
                ["normal", t("projects.issues.priorityNormal")],
                ["low", t("projects.issues.priorityLow")],
              ]}
            />
            <IssueSelect
              value={sort}
              onChange={(v) => setSort(v as IssueSort)}
              label={t("projects.issues.sort")}
              options={[
                ["priority", t("projects.issues.sortPriority")],
                ["newest", t("projects.issues.sortNewest")],
                ["oldest", t("projects.issues.sortOldest")],
                ["updated", t("projects.issues.sortUpdated")],
                ["comments", t("projects.issues.sortComments")],
              ]}
            />
          </div>
        )}
      </div>
      {issues.isLoading && (
        <p className="text-xs text-slate-500">{t("common.loading")}</p>
      )}
      {issues.isSuccess && totalCount === 0 && (
        <p className="text-xs text-slate-500">
          {repoUnreachable
            ? t("projects.issues.repoUnreachable")
            : t("projects.issues.empty")}
        </p>
      )}
      {issues.isSuccess && totalCount > 0 && filteredCount === 0 && (
        <p className="text-xs text-slate-500 italic">
          {t("projects.issues.filteredEmpty")}
        </p>
      )}
      <ul className="space-y-2">
        {filteredSorted.map((issue) => (
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
      {newIssueOpen && (
        <NewIssueDialog
          repo={repo}
          onClose={() => setNewIssueOpen(false)}
          onCreated={async () => {
            // Small delay before refetch: GitHub's REST API has
            // brief read-after-write inconsistency on the issues
            // listing — POST /issues returns the new issue, but a
            // GET /issues right after sometimes still serves the
            // pre-create snapshot. 800ms is enough in practice for
            // the new ticket to surface. We then fetch directly and
            // seed the cache, bypassing React Query's fetch
            // machinery (which empirically failed to refresh in
            // this flow even with refetch/cancel/remove).
            await new Promise((r) => setTimeout(r, 800));
            const [freshIssues, freshRepos] = await Promise.all([
              projects.issues(repo.id),
              projects.repos(repo.project_slug),
            ]);
            qc.setQueryData(["repo-issues", repo.id], freshIssues);
            qc.setQueryData(
              ["project-repos", repo.project_slug],
              freshRepos,
            );
            setNewIssueOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Modal that posts a new issue to GitHub via the user's connected
 *  OAuth token. Kind selector (bug/feature/task) maps to GH labels
 *  on the backend; body uses the shared MarkdownComposer so the
 *  preview matches what GitHub will render. */
function NewIssueDialog({
  repo,
  onClose,
  onCreated,
}: {
  repo: GHRepo;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<GHIssueType>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      projects.createIssue(repo.id, {
        title: title.trim(),
        body: body.trim(),
        type,
      }),
    onSuccess: async (res) => {
      if (res.status === "ok") {
        await onCreated();
      } else if (res.status === "no_token") {
        setError(t("projects.issues.newIssueNoToken"));
      } else {
        setError(
          `${res.status}${res.detail ? `: ${res.detail.slice(0, 200)}` : ""}`,
        );
      }
    },
    onError: (err) => {
      setError(String(err));
    },
  });

  const titleTooShort = title.trim().length < 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16"
      onClick={onClose}
      data-testid="new-issue-modal"
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-lg shadow-xl w-full max-w-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              {t("projects.issues.newIssueTitle")}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t("projects.issues.newIssueIntoRepo", { repo: repo.full_name })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg leading-none"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          {(["bug", "feature", "task"] as GHIssueType[]).map((opt) => (
            <label
              key={opt}
              className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded ring-1 transition ${
                type === opt
                  ? "ring-indigo-500 bg-indigo-500/10 text-indigo-200"
                  : "ring-slate-700 text-slate-400 hover:ring-slate-600"
              }`}
            >
              <input
                type="radio"
                name="issue-type"
                value={opt}
                checked={type === opt}
                onChange={() => setType(opt)}
                className="sr-only"
              />
              <span>
                {opt === "bug" && "🐛"}
                {opt === "feature" && "✨"}
                {opt === "task" && "📌"}
              </span>
              <span>{t(`projects.issues.newIssueType_${opt}`)}</span>
            </label>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">
            {t("projects.issues.newIssueTitleLabel")}
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("projects.issues.newIssueTitlePlaceholder")}
            maxLength={200}
            className="w-full bg-slate-950/60 ring-1 ring-slate-700 focus:ring-indigo-500 rounded px-2 py-1.5 text-sm text-slate-100 outline-none transition"
            data-testid="new-issue-title"
            autoFocus
          />
        </label>

        <div className="space-y-1">
          <span className="text-[11px] text-slate-400">
            {t("projects.issues.newIssueBodyLabel")}
          </span>
          <MarkdownComposer
            value={body}
            onChange={setBody}
            placeholder={t("projects.issues.newIssueBodyPlaceholder")}
            rows={8}
            testid="new-issue-body"
          />
        </div>

        {error && (
          <p className="text-[11px] text-rose-400 break-words">{error}</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[10px] text-slate-500 italic">
            {t("projects.issues.newIssuePostsToGh")}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-300 hover:text-slate-100 px-3 py-1.5 rounded"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                create.mutate();
              }}
              disabled={create.isPending || titleTooShort}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-3 py-1.5 rounded transition"
              data-testid="new-issue-submit"
            >
              {create.isPending
                ? "…"
                : t("projects.issues.newIssueSubmit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  options: [string, string][];
}) {
  return (
    <label className="text-[10px] text-slate-500 flex items-center gap-1">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-950/60 ring-1 ring-slate-700 hover:ring-slate-600 focus:ring-indigo-500 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none transition"
      >
        {options.map(([v, lab]) => (
          <option key={v} value={v}>
            {lab}
          </option>
        ))}
      </select>
    </label>
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
  const [detailOpen, setDetailOpen] = useState(false);

  const ghLink = issue.html_url || `${repo.html_url}/issues/${issue.number}`;

  return (
    <li
      className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2 space-y-2"
      data-testid={`issue-${issue.number}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setDetailOpen((s) => !s)}
            className="text-sm text-slate-100 hover:text-indigo-300 text-left"
            data-testid={`issue-expand-${issue.number}`}
          >
            {detailOpen ? "▾" : "▸"} #{issue.number} {issue.title}
          </button>
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
      <div className="flex flex-wrap gap-2 items-center">
        <a
          href={ghLink}
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {t("projects.issues.openIssue")} ↗
        </a>
      </div>
      {detailOpen && (
        <IssueDetailPanel
          repoId={repo.id}
          issueNumber={issue.number}
          canPost={canClaim}
        />
      )}
    </li>
  );
}

/** Expanded issue panel: body + GH comments + unified GH comment
 *  composer (no separate Astrozor chat — everything goes through
 *  GitHub via the user's connected OAuth bearer).
 */
function IssueDetailPanel({
  repoId,
  issueNumber,
  canPost,
}: {
  repoId: string;
  issueNumber: number;
  canPost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["issue-detail", repoId, issueNumber],
    queryFn: () => projects.issueDetail(repoId, issueNumber),
    staleTime: 60_000,
  });
  const [text, setText] = useState("");
  const [postError, setPostError] = useState<string>("");
  const post = useMutation({
    mutationFn: () => projects.commentIssue(repoId, issueNumber, text.trim()),
    onSuccess: (res) => {
      if (res.status === "ok") {
        setText("");
        setPostError("");
        qc.invalidateQueries({
          queryKey: ["issue-detail", repoId, issueNumber],
        });
      } else {
        setPostError(`${res.status}: ${res.detail ?? ""}`);
      }
    },
  });

  if (detail.isLoading) {
    return (
      <div className="border-t border-slate-800 pt-2 mt-2">
        <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
      </div>
    );
  }
  if (!detail.data) return null;
  const d = detail.data;
  return (
    <div className="border-t border-slate-800 pt-3 mt-2 space-y-3">
      <IssueBody body_html={d.body_html} user={d.user} created_at={d.created_at} locale={i18n.language} />
      {d.comments.length > 0 && (
        <ul className="space-y-2">
          {d.comments.map((c) => (
            <li key={c.id}>
              <GHCommentBubble comment={c} locale={i18n.language} />
            </li>
          ))}
        </ul>
      )}
      {!canPost && (
        <p className="text-[11px] text-slate-500 italic">
          {t("projects.issues.needGhConnect")}
        </p>
      )}
      {canPost && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) post.mutate();
          }}
          className="space-y-2"
        >
          <MarkdownComposer
            value={text}
            onChange={setText}
            placeholder={t("projects.issues.chatPlaceholder")}
            rows={4}
            testid={`issue-comment-input-${issueNumber}`}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500 italic">
              {t("projects.issues.postsToGh")}
            </span>
            <button
              type="submit"
              disabled={post.isPending || !text.trim()}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-3 py-1 rounded transition"
            >
              {post.isPending ? "…" : t("projects.issues.chatSend")}
            </button>
          </div>
          {postError && (
            <p className="text-[11px] text-rose-400">{postError}</p>
          )}
        </form>
      )}
    </div>
  );
}

function IssueBody({
  body_html,
  user,
  created_at,
  locale,
}: {
  body_html: string;
  user: GHIssueDetail["user"];
  created_at: string | null;
  locale: string;
}) {
  const created = created_at ? new Date(created_at) : null;
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        {user.avatar_url && (
          <img
            src={user.avatar_url}
            alt={user.login}
            width={20}
            height={20}
            className="rounded-full ring-1 ring-slate-800"
          />
        )}
        <a
          href={user.html_url}
          target="_blank"
          rel="noopener"
          className="text-slate-200 hover:text-indigo-300"
        >
          {user.login || "anon"}
        </a>
        {created && (
          <span>
            {" · "}
            {created.toLocaleString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
      {body_html ? (
        <div
          className={proseMarkdownClass}
          dangerouslySetInnerHTML={{ __html: body_html }}
        />
      ) : (
        <p className="text-[11px] text-slate-500 italic">—</p>
      )}
    </div>
  );
}

function GHCommentBubble({
  comment,
  locale,
}: {
  comment: GHIssueComment;
  locale: string;
}) {
  const created = comment.created_at ? new Date(comment.created_at) : null;
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded p-2 space-y-1">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        {comment.user.avatar_url && (
          <img
            src={comment.user.avatar_url}
            alt={comment.user.login}
            width={18}
            height={18}
            className="rounded-full ring-1 ring-slate-800"
          />
        )}
        <a
          href={comment.user.html_url}
          target="_blank"
          rel="noopener"
          className="text-slate-200 hover:text-indigo-300"
        >
          {comment.user.login}
        </a>
        {created && (
          <span>
            {" · "}
            {created.toLocaleString(locale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {comment.html_url && (
          <a
            href={comment.html_url}
            target="_blank"
            rel="noopener"
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            GH ↗
          </a>
        )}
      </div>
      <div
        className={proseMarkdownClass}
        dangerouslySetInnerHTML={{ __html: comment.body_html }}
      />
    </div>
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
  existingSlug,
  onDone,
  onCancel,
}: {
  existingSlug: string | null;
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ["project", existingSlug],
    queryFn: () => projects.get(existingSlug!),
    enabled: !!existingSlug,
  });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private" | "internal">(
    "public",
  );
  const [tags, setTags] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from existing when in edit mode (one-shot — subsequent
  // refetches shouldn't blow away the user's in-flight edits).
  useEffect(() => {
    if (existingSlug && existing.data && !hydrated) {
      setName(existing.data.name);
      setDescription(existing.data.description);
      setVisibility(existing.data.visibility);
      setTags(existing.data.tags || []);
      setHydrated(true);
    }
  }, [existing.data, existingSlug, hydrated]);

  const create = useMutation({
    mutationFn: () => projects.create({ name, description, visibility, tags }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onDone(p.slug);
    },
  });
  const patch = useMutation({
    mutationFn: () =>
      projects.patch(existingSlug!, { name, description, visibility, tags }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.setQueryData(["project", existingSlug], p);
      onDone(p.slug);
    },
  });
  const submit = existingSlug ? patch : create;

  return (
    <section data-testid="project-editor">
      <button
        type="button"
        onClick={onCancel}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.cancel")}
      </button>
      <h2 className="text-xl font-semibold mb-4">
        {existingSlug ? t("projects.editTitle") : t("projects.new")}
      </h2>
      {existingSlug && existing.isLoading && (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      )}
      <form
        className="space-y-3 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) submit.mutate();
        }}
      >
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("projects.field.name")}
          </span>
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
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">🏷 Tagy</span>
          <TagInput value={tags} onChange={setTags} />
        </label>
        {submit.error && (
          <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
            {(submit.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={submit.isPending || !name.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
          data-testid={existingSlug ? "project-save" : "project-create"}
        >
          {submit.isPending
            ? "…"
            : existingSlug
              ? t("projects.save")
              : t("projects.create")}
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
