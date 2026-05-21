import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CampaignsPage } from "./CampaignsPage";
import { DateTimePicker } from "./DateTimePicker";
import { SprintChat } from "./SprintChat";
import { SprintFullPage } from "./SprintFullPage";
import { ZooniverseTalkBrowser } from "./ZooniverseTalkBrowser";
import {
  campaigns as campaignsApi,
  zooniverse,
  type Campaign,
  type Me,
  type Sprint,
  type ZooniverseContributor,
  type ZooniverseProject,
  type ZooniverseWorkflow,
  type ZooniverseWorkflowActivity,
} from "../lib/api";
import { useUrlParam } from "../lib/urlParam";

/**
 * Astrozor's Citizen Science hub.
 *
 * Visual dominance: a tile grid of admin-curated Zooniverse projects
 * (mirrors `ArticlesPage`'s grid pattern). Below that, the existing
 * in-house campaigns row stays as a subordinate listing — campaigns
 * can optionally link to a Zooniverse project (time-boxed sprints).
 *
 * The page header carries the JoinAstrozorGroupCard whose three states
 * drive the user's onboarding path: link Zooniverse account → join the
 * Astrozor group on Zooniverse → start classifying.
 */
export function CitizenSciencePage({ me }: { me: Me | null }) {
  const { t } = useTranslation();
  // ?p=<zooniverse_id> opens the project detail; ?s=<slug> opens the
  // sprint detail (overrides project detail). Refresh + share links
  // land on the same place. Setting either to null walks one step
  // back in the hierarchy.
  const [detailZidRaw, setDetailZid] = useUrlParam("p");
  const [sprintSlug, setSprintSlug] = useUrlParam("s");
  const detailZid = detailZidRaw && /^\d+$/.test(detailZidRaw) ? Number(detailZidRaw) : null;
  const projects = useQuery({
    queryKey: ["zooniverse-projects"],
    queryFn: () => zooniverse.listProjects(true),
  });
  const filtered = (projects.data ?? []).filter((p) => p.is_featured);

  if (sprintSlug) {
    return (
      <SprintFullPage
        slug={sprintSlug}
        onBack={() => setSprintSlug(null)}
        me={me}
      />
    );
  }
  if (detailZid !== null) {
    return (
      <ZooniverseProjectDetail
        zid={detailZid}
        onBack={() => setDetailZid(null)}
        authed={!!me}
      />
    );
  }

  return (
    <section data-testid="citizen-science-page" className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">{t("campaigns.title")}</h2>
        <p className="text-sm text-slate-400">{t("citizen.subtitle")}</p>
      </header>

      <GroupDashboardHero />
      <JoinAstrozorGroupCard authed={!!me} />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm uppercase tracking-wide text-slate-400">
            {t("citizen.projectsHeading")}
          </h3>
          {projects.data && (
            <span className="text-xs text-slate-500">
              {t("citizen.projectCount", { count: filtered.length })}
            </span>
          )}
        </div>
        {projects.isLoading && (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        )}
        {projects.isSuccess && filtered.length === 0 && (
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
            <p className="text-slate-400 text-sm">{t("citizen.emptyProjects")}</p>
            <p className="text-slate-500 text-xs mt-2">
              {t("citizen.emptyProjectsHint")}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ZooniverseProjectCard
              key={p.id}
              project={p}
              onOpen={() => setDetailZid(String(p.zooniverse_id))}
            />
          ))}
        </div>
      </div>

      {/* Subordinate row: in-house Astrozor campaigns. Hidden if none. */}
      <CampaignsBelow me={me} />
    </section>
  );
}

// ---- Banner with telescope fallback ----

/**
 * Renders a Zooniverse project image with the telescope-emoji fallback
 * reserved only for truly-missing or broken images.
 *
 * Two reasons we need a component (instead of inlining `<img>`):
 *
 * 1. Some projects don't have a background uploaded — we want the
 *    avatar, then the telescope.
 * 2. Zooniverse's CDN occasionally 404s an old avatar / serves a
 *    network error mid-session. ``onError`` flips us to the fallback
 *    so the tile keeps rendering instead of showing a broken-image
 *    icon.
 */
function ProjectBanner({
  src,
  alt,
  className,
  fallbackClassName,
}: {
  src: string;
  alt: string;
  className: string;
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={fallbackClassName} aria-hidden>
        🔭
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

// ---- Locale helpers ----

/** Format an integer with the user's UI language so the number reads
 *  naturally — e.g. "1 234" in cs, "1,234" in en. The Citizen Science
 *  page used to be hardcoded to cs-CZ which clashed with the EN translation. */
function useLocaleNumber() {
  const { i18n } = useTranslation();
  return (n: number) => n.toLocaleString(i18n.language);
}

// ---- Project tile ----

function ZooniverseProjectCard({
  project,
  onOpen,
}: {
  project: ZooniverseProject;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleNumber();
  const banner = project.background_url || project.avatar_url;
  // Tile sparkline shows only the last 7 days — cheap, gives a hint of
  // momentum before the user clicks into the full detail view.
  const series = useQuery({
    queryKey: ["zooniverse-project-series", project.zooniverse_id, 7],
    queryFn: () => zooniverse.projectSeries(project.zooniverse_id, 7),
    staleTime: 5 * 60_000,
  });
  return (
    <article
      data-testid={`zooniverse-card-${project.zooniverse_id}`}
      onClick={onOpen}
      className="group bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-600 rounded-xl overflow-hidden transition flex flex-col cursor-pointer"
    >
      <div className="aspect-[16/9] bg-gradient-to-br from-indigo-900/40 to-slate-900 relative overflow-hidden">
        <ProjectBanner
          src={banner}
          alt={project.title}
          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition"
          fallbackClassName="w-full h-full flex items-center justify-center text-slate-700 text-5xl"
        />
        <div className="absolute bottom-2 right-2 text-[10px] text-slate-300/70 bg-slate-950/70 ring-1 ring-slate-700/60 rounded px-1.5 py-0.5">
          Zooniverse
        </div>
        {project.zombie && (
          <div
            className="absolute top-2 left-2 text-[10px] text-amber-200 bg-amber-950/80 ring-1 ring-amber-900/60 rounded px-1.5 py-0.5"
            title={t("citizen.notLaunchApproved")}
          >
            ⚠ {t("citizen.notLaunchApproved")}
          </div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col gap-2">
        <h4 className="font-semibold text-slate-100 leading-tight">{project.title}</h4>
        {project.owner_login && (
          <p className="text-[11px] text-slate-500">@{project.owner_login}</p>
        )}
        <p className="text-xs text-slate-400 line-clamp-3 flex-1">
          {project.description}
        </p>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {project.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 ring-1 ring-slate-700/60"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="pt-1">
          <Sparkline data={series.data?.data ?? []} width={280} height={36} />
        </div>
        <footer className="pt-1 mt-auto text-[11px] text-slate-500 flex items-center justify-between gap-2">
          <span className="text-slate-400 font-mono">
            {t("citizen.classificationsCount", {
              count: project.classifications_count,
              formattedCount: fmt(project.classifications_count),
            })}
          </span>
          <a
            href={project.zooniverse_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {t("citizen.openProjectShort")}
          </a>
        </footer>
      </div>
    </article>
  );
}

// ---- Join Astrozor group card (3 states + polling) ----

function JoinAstrozorGroupCard({ authed }: { authed: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const membership = useQuery({
    queryKey: ["zooniverse-membership"],
    queryFn: () => zooniverse.membership(),
  });
  const refresh = useMutation({
    mutationFn: () => zooniverse.refreshMembership(),
    onSuccess: (data) => {
      queryClient.setQueryData(["zooniverse-membership"], data);
    },
  });

  // Polling after the join click: re-check membership at +30 s / +2 min / +10 min
  // (Zooniverse propagation is usually seconds; the staircase covers worst-case).
  // We only poll if the user explicitly clicked "Join" in this session.
  const [joinClickedAt, setJoinClickedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!joinClickedAt || !membership.data?.linked) return;
    if (membership.data.in_group) {
      setJoinClickedAt(null);
      return;
    }
    const delays = [30_000, 120_000, 600_000];
    const since = Date.now() - joinClickedAt;
    const next = delays.find((d) => d > since);
    if (next === undefined) return;
    const timer = window.setTimeout(() => refresh.mutate(), next - since);
    return () => window.clearTimeout(timer);
  }, [joinClickedAt, membership.data, refresh]);

  // Re-check whenever the tab regains focus (covers manual return from Zooniverse).
  useEffect(() => {
    const onFocus = () => {
      if (joinClickedAt && !membership.data?.in_group) refresh.mutate();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [joinClickedAt, membership.data, refresh]);

  const m = membership.data;
  if (membership.isLoading) {
    return (
      <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl px-4 py-3 text-xs text-slate-500">
        {t("common.loading")}
      </div>
    );
  }

  // State A — not logged in. Soft prompt + group public link.
  if (!authed) {
    return (
      <div
        data-testid="zooniverse-join-card"
        className="bg-indigo-950/30 ring-1 ring-indigo-900/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      >
        <div className="text-sm">
          <strong className="text-indigo-200">{t("citizen.join.anonTitle")}</strong>
          <p className="text-xs text-slate-400 mt-0.5">{t("citizen.join.anonBody")}</p>
        </div>
        {m && (
          <a
            href={m.group_public_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline shrink-0"
          >
            {t("citizen.join.anonGroupLink", { count: m.member_count })}
          </a>
        )}
      </div>
    );
  }

  // State B — logged in, no Zooniverse identity linked yet.
  if (!m?.linked) {
    return (
      <div
        data-testid="zooniverse-join-card"
        className="bg-indigo-950/30 ring-1 ring-indigo-900/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      >
        <div className="text-sm min-w-0">
          <strong className="text-indigo-200">{t("citizen.join.linkTitle")}</strong>
          <p className="text-xs text-slate-400 mt-0.5">{t("citizen.join.linkBody")}</p>
        </div>
        <a
          href="/api/v1/auth/zooniverse/start?from=campaigns"
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md transition shrink-0"
          data-testid="zooniverse-link-cta"
        >
          {t("citizen.join.linkCta")}
        </a>
      </div>
    );
  }

  // State C — linked, already a member.
  if (m.in_group) {
    return (
      <div
        data-testid="zooniverse-join-card"
        className="bg-emerald-950/30 ring-1 ring-emerald-900/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      >
        <div className="text-sm min-w-0">
          <span className="text-emerald-300 mr-2">●</span>
          <strong>{t("citizen.join.memberTitle")}</strong>
          <span className="text-xs text-slate-400 ml-2">
            {t("citizen.join.memberHint")}
          </span>
        </div>
        <a
          href={m.group_public_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline shrink-0"
        >
          {t("citizen.join.memberGroupLink")}
        </a>
      </div>
    );
  }

  // State D — linked, not yet member. Show the join link.
  return (
    <div
      data-testid="zooniverse-join-card"
      className="bg-indigo-950/30 ring-1 ring-indigo-900/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
    >
      <div className="text-sm min-w-0">
        <strong className="text-indigo-200">{t("citizen.join.joinTitle")}</strong>
        <p className="text-xs text-slate-400 mt-0.5">{t("citizen.join.joinBody")}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {refresh.isPending && (
          <span className="text-[11px] text-slate-500">{t("citizen.join.verifying")}</span>
        )}
        <a
          href={m.join_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setJoinClickedAt(Date.now())}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md transition"
          data-testid="zooniverse-join-cta"
        >
          {t("citizen.join.joinCta", { count: m.member_count })}
        </a>
      </div>
    </div>
  );
}

// ---- Group dashboard hero (stats above the project grid) ----

function GroupDashboardHero() {
  const { t } = useTranslation();
  const fmt = useLocaleNumber();
  const dashboard = useQuery({
    queryKey: ["zooniverse-dashboard"],
    queryFn: () => zooniverse.dashboard(),
    staleTime: 60_000,
  });
  if (dashboard.isLoading || !dashboard.data) return null;
  const d = dashboard.data;
  // Hide hero if the group is empty (no classifications + no contributors)
  // and only has the bootstrap admin — keeps the page calm in the
  // pre-launch state. Show as soon as something interesting exists.
  const hasActivity =
    d.total_classifications > 0 ||
    d.active_users > 0 ||
    d.top_contributors.length > 0;
  if (!hasActivity) return null;

  return (
    <section className="bg-gradient-to-br from-indigo-950/40 via-slate-950/60 to-slate-950/60 ring-1 ring-indigo-900/40 rounded-xl p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-sm uppercase tracking-wide text-indigo-300">
          {t("citizen.groupOnZooniverse", { name: d.name })}
        </h3>
        <span className="text-[11px] text-slate-500">
          {t("citizen.memberCount", { count: d.member_count })}
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t("citizen.stats.totalClassifications")}
          value={fmt(d.total_classifications)}
          accent="indigo"
        />
        <StatCard
          label={t("citizen.stats.activeContributors")}
          value={fmt(d.active_users)}
          accent="emerald"
        />
        <StatCard
          label={t("citizen.stats.timeSpent")}
          value={formatDuration(d.time_spent_s)}
          accent="amber"
        />
        <StatCard
          label={t("citizen.stats.topContributorsHeading")}
          value={fmt(d.top_contributors.length)}
          hint={t("citizen.stats.topContributorsHint")}
          accent="violet"
        />
      </div>
      <TopContributorsList contributors={d.top_contributors} />
    </section>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent = "indigo",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "indigo" | "emerald" | "amber" | "violet";
}) {
  const accentColor = {
    indigo: "text-indigo-200",
    emerald: "text-emerald-200",
    amber: "text-amber-200",
    violet: "text-violet-200",
  }[accent];
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold font-mono ${accentColor} mt-1`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function TopContributorsList({ contributors }: { contributors: ZooniverseContributor[] }) {
  const { t } = useTranslation();
  const fmt = useLocaleNumber();
  if (contributors.length === 0) {
    return (
      <p className="text-xs text-slate-500 text-center py-2">
        {t("citizen.stats.topContributorsEmpty")}
      </p>
    );
  }
  const max = Math.max(1, ...contributors.map((c) => c.count));
  return (
    <ol className="space-y-1.5">
      {contributors.map((c, idx) => {
        const pct = Math.max(2, (c.count / max) * 100);
        const label = c.display_name || c.login || `Zooniverse #${c.zooniverse_user_id}`;
        return (
          <li
            key={c.zooniverse_user_id}
            className="grid grid-cols-[1.5rem_2rem_1fr_auto] items-center gap-2 text-xs"
            data-testid={`top-contributor-${c.zooniverse_user_id}`}
          >
            <span className="text-slate-500 font-mono text-right">{idx + 1}.</span>
            {c.avatar_url ? (
              <img
                src={c.avatar_url}
                alt=""
                className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-800"
                loading="lazy"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-slate-800 ring-1 ring-slate-700 flex items-center justify-center text-[10px] text-slate-500">
                {label.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 relative">
              <div
                className="absolute inset-y-0 left-0 bg-indigo-900/30 rounded-sm"
                style={{ width: `${pct}%` }}
              />
              <div className="relative px-2 py-0.5">
                <span className="text-slate-200 font-medium truncate inline-block max-w-full align-middle">
                  {label}
                </span>
                {c.astrozor_email && (
                  <span className="ml-1 text-[9px] uppercase tracking-wide text-emerald-300 bg-emerald-950/40 ring-1 ring-emerald-900/60 rounded px-1 py-px">
                    Astrozor
                  </span>
                )}
              </div>
            </div>
            <span className="font-mono text-slate-300 tabular-nums">
              {fmt(c.count)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

// ---- Sparkline (inline SVG) ----

function Sparkline({
  data,
  width = 240,
  height = 50,
  stroke = "rgb(165 180 252)",
  fill = "rgba(99, 102, 241, 0.15)",
}: {
  data: { date: string; count: number }[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  const { t, i18n } = useTranslation();
  const path = useMemo(() => {
    if (data.length < 2) return { line: "", area: "", maxLabel: "" };
    const max = Math.max(1, ...data.map((d) => d.count));
    const xStep = width / (data.length - 1);
    const yScale = (v: number) => height - (v / max) * (height - 4) - 2;
    const points = data.map((d, i) => `${(i * xStep).toFixed(1)},${yScale(d.count).toFixed(1)}`);
    const line = "M" + points.join(" L");
    const area = `${line} L${(width).toFixed(1)},${height} L0,${height} Z`;
    return { line, area, maxLabel: max.toLocaleString(i18n.language) };
  }, [data, width, height, i18n.language]);

  if (data.length < 2) {
    return (
      <div
        className="bg-slate-900/40 rounded-md text-[10px] text-slate-600 flex items-center justify-center"
        style={{ width, height }}
      >
        {t("citizen.stats.noActivity")}
      </div>
    );
  }
  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height} className="block">
        <path d={path.area} fill={fill} />
        <path d={path.line} fill="none" stroke={stroke} strokeWidth={1.5} />
      </svg>
      <span className="absolute top-0 right-1 text-[9px] text-slate-500 font-mono">
        ↑ {path.maxLabel}
      </span>
    </div>
  );
}

// ---- Project detail view ----

function ZooniverseProjectDetail({
  zid,
  onBack,
  authed,
}: {
  zid: number;
  onBack: () => void;
  authed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useLocaleNumber();
  const proj = useQuery({
    queryKey: ["zooniverse-project", zid],
    queryFn: () => zooniverse.getProject(zid),
  });
  const series = useQuery({
    queryKey: ["zooniverse-project-series", zid, 30],
    queryFn: () => zooniverse.projectSeries(zid, 30),
    staleTime: 5 * 60_000,
  });

  if (proj.isLoading) {
    return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  }
  if (proj.isError || !proj.data) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="text-sm text-slate-400 hover:text-slate-200">
          ← {t("common.back")}
        </button>
        <p className="text-rose-400 text-sm">{t("citizen.detailError")}</p>
      </div>
    );
  }

  const p = proj.data;
  const banner = p.background_url || p.avatar_url;

  return (
    <article data-testid={`zooniverse-detail-${p.zooniverse_id}`} className="space-y-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("common.back")}
        </button>
        <a
          href={p.zooniverse_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          {t("citizen.openZooniverseProject")}
        </a>
      </header>

      <div className="aspect-[21/9] rounded-xl overflow-hidden bg-slate-900">
        <ProjectBanner
          src={banner}
          alt={p.title}
          className="w-full h-full object-cover"
          fallbackClassName="w-full h-full flex items-center justify-center text-slate-700 text-7xl"
        />
      </div>

      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">{p.title}</h2>
        {p.owner_login && (
          <p className="text-sm text-slate-500">@{p.owner_login}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div className="space-y-4">
          {p.introduction && (
            <section className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {p.introduction}
              </p>
            </section>
          )}
          {!p.introduction && p.description && (
            <section className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {p.description}
              </p>
            </section>
          )}

          {p.zombie && (
            <div
              role="alert"
              data-testid="zooniverse-zombie-warning"
              className="bg-amber-950/40 ring-1 ring-amber-900/60 rounded-lg p-3"
            >
              <p className="text-sm font-medium text-amber-200">
                ⚠ {t("citizen.zombieWarning.title")}
              </p>
              <p className="text-xs text-amber-100/80 mt-1 leading-snug">
                {t("citizen.zombieWarning.body")}
              </p>
            </div>
          )}
          <ClassifyButtons project={p} authed={authed} />
          {!authed && (
            <p className="text-xs text-slate-500">{t("citizen.classifyAnonHint")}</p>
          )}

          {/* Astrozor sprints — time-boxed group classification windows
              scoped to this Zooniverse project. Each sprint is a Campaign
              row with ``zooniverse_project`` set; the UI here is the only
              surface that exposes them (they're hidden from the generic
              campaigns list). */}
          <SprintsSection
            zid={zid}
            project={p}
            authed={authed}
            locale={i18n.language}
          />
        </div>

        <aside className="space-y-3">
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              {t("citizen.activityLast30")}
            </div>
            <Sparkline data={series.data?.data ?? []} width={260} height={70} />
            {series.data?.data.length ? (
              <div className="text-[10px] text-slate-500 mt-1.5 flex justify-between">
                <span>{series.data.data[0]?.date}</span>
                <span>{series.data.data[series.data.data.length - 1]?.date}</span>
              </div>
            ) : null}
          </div>

          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              {t("citizen.statsHeading")}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("citizen.totalClassifications")}</dt>
                <dd className="font-mono text-slate-200">
                  {fmt(p.classifications_count)}
                </dd>
              </div>
              {p.group_contribution_count !== null && (
                <div className="flex justify-between">
                  <dt className="text-slate-400">{t("citizen.groupClassifications")}</dt>
                  <dd className="font-mono text-indigo-300">
                    {fmt(p.group_contribution_count)}
                  </dd>
                </div>
              )}
              {p.state && (
                <div className="flex justify-between">
                  <dt className="text-slate-400">{t("citizen.projectState")}</dt>
                  <dd className="text-slate-300">{p.state}</dd>
                </div>
              )}
              {p.primary_language && (
                <div className="flex justify-between">
                  <dt className="text-slate-400">{t("citizen.projectLanguage")}</dt>
                  <dd className="text-slate-300 uppercase">{p.primary_language}</dd>
                </div>
              )}
            </dl>
          </div>

          {p.tags.length > 0 && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                {t("citizen.tagsHeading")}
              </div>
              <div className="flex flex-wrap gap-1">
                {p.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 ring-1 ring-slate-700/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
            <ZooniverseTalkBrowser zid={p.zooniverse_id} />
          </div>
        </aside>
      </div>
    </article>
  );
}

// ---- Classify buttons (one per active workflow) ----

function ClassifyButtons({
  project,
  authed,
}: {
  project: ZooniverseProject;
  authed: boolean;
}) {
  const { t } = useTranslation();
  const active = (project.workflows ?? []).filter((w) => w.active);

  // Per-workflow classification counts for the current user. Skipped
  // entirely when the user isn't logged in — anonymous visitors get
  // bare CTAs without badges. If the user is logged in but hasn't
  // linked their Zooniverse account, the endpoint replies
  // ``linked=false`` and we treat that like the unauth case.
  const activityQ = useQuery({
    queryKey: ["zoo-my-workflow-activity", project.zooniverse_id],
    queryFn: () => zooniverse.myWorkflowActivity(project.zooniverse_id),
    enabled: authed && active.length > 0,
    staleTime: 5 * 60_000,
  });
  const countByWorkflow = useMemo(() => {
    const out = new Map<number, number>();
    const data = activityQ.data;
    if (!data || !data.linked) return out;
    for (const row of data.workflows) {
      out.set(row.workflow_id, row.classified_count);
    }
    return out;
  }, [activityQ.data]);

  // No active workflows — fall back to the landing-page link so the
  // user can at least pick something on Zooniverse itself.
  if (active.length === 0) {
    return (
      <div className="space-y-2">
        <a
          href={project.zooniverse_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition"
        >
          🔭 {t("citizen.classifyDefault")}
        </a>
        <p className="text-[11px] text-slate-500">{t("citizen.noActiveWorkflows")}</p>
      </div>
    );
  }

  // Two-line card layout for every active workflow — title on top,
  // task description underneath. One workflow gets a slightly wider
  // single column; many workflows tile into a responsive grid so the
  // descriptions stay readable instead of squeezing into one row.
  return (
    <div
      className={
        active.length === 1
          ? "grid grid-cols-1 gap-2"
          : "grid grid-cols-1 sm:grid-cols-2 gap-2"
      }
    >
      {active.map((w) => (
        <WorkflowCta
          key={w.id}
          workflow={w}
          classifiedCount={countByWorkflow.get(w.id) ?? 0}
        />
      ))}
    </div>
  );
}

function WorkflowCta({
  workflow,
  classifiedCount,
}: {
  workflow: ZooniverseWorkflow;
  classifiedCount: number;
}) {
  const { t } = useTranslation();
  const pct = Math.round((workflow.completeness || 0) * 100);
  const isActive = classifiedCount > 0;
  return (
    <a
      href={workflow.classify_url}
      target="_blank"
      rel="noopener noreferrer"
      title={pct > 0 ? `${pct}%` : undefined}
      className="group flex items-start gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-3 rounded-md transition"
      data-testid={`classify-workflow-${workflow.id}`}
    >
      <span aria-hidden className="text-lg leading-none mt-0.5">🔭</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">
            {t("citizen.classifyOn", { workflow: workflow.display_name })}
          </span>
          {pct > 0 && (
            <span className="text-[10px] font-mono opacity-70 group-hover:opacity-100">
              {pct}%
            </span>
          )}
          {isActive && (
            <span
              className="text-[10px] font-medium bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40 rounded px-1.5 py-0.5"
              data-testid={`workflow-active-badge-${workflow.id}`}
              title={t("citizen.workflowActivity.tooltip", {
                count: classifiedCount,
              })}
            >
              ✓ {t("citizen.workflowActivity.active", {
                count: classifiedCount,
              })}
            </span>
          )}
        </span>
        {workflow.description && (
          <span className="block text-[11px] text-indigo-100/80 mt-0.5 leading-snug">
            {workflow.description}
          </span>
        )}
      </span>
    </a>
  );
}

// ---- Sprints section (project-scoped) ----

function SprintsSection({
  zid,
  project,
  authed,
  locale,
}: {
  zid: number;
  project: ZooniverseProject;
  authed: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sprintsQ = useQuery({
    queryKey: ["zooniverse-sprints", zid],
    queryFn: () => zooniverse.listSprints(zid),
  });
  const [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const [statsForSlug, setStatsForSlug] = useState<string | null>(null);
  // Sprint slug URL param is owned by the parent CitizenSciencePage;
  // here we just write to it via this setter so the Open button
  // navigates to the dedicated SprintFullPage.
  const [, setSprintSlug] = useUrlParam("s");

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["zooniverse-sprints", zid] });

  const join = useMutation({
    mutationFn: (slug: string) => zooniverse.joinSprint(slug),
    onSuccess: (sprint) => {
      // Auto-navigate to the sprint page right after joining — the
      // typical next action is to look at the workflow / chat with
      // others.
      setSprintSlug(sprint.slug);
      refresh();
    },
  });
  const leave = useMutation({
    mutationFn: (slug: string) => zooniverse.leaveSprint(slug),
    onSuccess: refresh,
  });
  const close = useMutation({
    mutationFn: (slug: string) => zooniverse.closeSprint(slug),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (slug: string) => zooniverse.removeSprint(slug),
    onSuccess: refresh,
  });

  const sprints = sprintsQ.data ?? [];

  return (
    <section className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm uppercase tracking-wide text-slate-400">
            {t("citizen.sprints.heading")}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 max-w-xl">
            {t("citizen.sprints.subtitle")}
          </p>
        </div>
        {authed && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            data-testid="sprint-new"
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md transition shrink-0"
          >
            + {t("citizen.sprints.newButton")}
          </button>
        )}
      </header>

      {sprintsQ.isLoading && (
        <p className="text-xs text-slate-500">{t("common.loading")}</p>
      )}
      {sprintsQ.isSuccess && sprints.length === 0 && (
        <p className="text-xs text-slate-500">{t("citizen.sprints.empty")}</p>
      )}

      <ul className="space-y-2">
        {sprints.map((s) => (
          <li
            key={s.id}
            data-testid={`sprint-${s.slug}`}
            className="bg-slate-900/40 ring-1 ring-slate-800 rounded-lg p-3 space-y-2"
          >
            <SprintHeader sprint={s} locale={locale} />
            {s.description && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap leading-snug">
                {s.description}
              </p>
            )}
            <SprintActions
              sprint={s}
              authed={authed}
              joinPending={join.isPending}
              leavePending={leave.isPending}
              closePending={close.isPending}
              statsOpen={statsForSlug === s.slug}
              onJoin={() => join.mutate(s.slug)}
              onLeave={() => leave.mutate(s.slug)}
              onOpenPage={() => setSprintSlug(s.slug)}
              onToggleStats={() =>
                setStatsForSlug((cur) => (cur === s.slug ? null : s.slug))
              }
              onClose={() => {
                if (window.confirm(t("citizen.sprints.closeConfirm", { title: s.title }))) {
                  close.mutate(s.slug);
                }
              }}
              onEdit={() => setEditing(s)}
              onDelete={() => {
                if (window.confirm(t("citizen.sprints.deleteConfirm", { title: s.title }))) {
                  remove.mutate(s.slug);
                }
              }}
            />
            {statsForSlug === s.slug && <SprintStatsPanel sprint={s} />}
          </li>
        ))}
      </ul>

      {editing !== null && (
        <SprintEditorModal
          zid={zid}
          project={project}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function SprintHeader({ sprint, locale }: { sprint: Sprint; locale: string }) {
  const { t } = useTranslation();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  let dateLabel: string;
  if (sprint.starts_at && sprint.ends_at) {
    dateLabel = t("citizen.sprints.dateRange", {
      from: fmt(sprint.starts_at),
      to: fmt(sprint.ends_at),
    });
  } else if (sprint.starts_at && sprint.status === "open") {
    dateLabel = t("citizen.sprints.openEnded", { from: fmt(sprint.starts_at) });
  } else if (sprint.starts_at) {
    dateLabel = t("citizen.sprints.noEnd", { from: fmt(sprint.starts_at) });
  } else if (sprint.ends_at) {
    dateLabel = t("citizen.sprints.noStart", { to: fmt(sprint.ends_at) });
  } else {
    dateLabel = t("citizen.sprints.anyTime");
  }

  return (
    <div className="flex items-start gap-3">
      <SprintStatusDot status={sprint.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h4 className="text-sm font-medium text-slate-100">{sprint.title}</h4>
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            {sprint.status}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {dateLabel}
          {sprint.workflow_name && (
            <>
              {" · "}
              <span className="text-slate-400">
                {t("citizen.sprints.workflowLabel", { name: sprint.workflow_name })}
              </span>
            </>
          )}
          {" · "}
          <span className="text-slate-400">
            {t("citizen.sprints.participants", { count: sprint.participant_count })}
          </span>
        </p>
      </div>
    </div>
  );
}

function SprintActions({
  sprint,
  authed,
  joinPending,
  leavePending,
  closePending,
  statsOpen,
  onJoin,
  onLeave,
  onOpenPage,
  onToggleStats,
  onClose,
  onEdit,
  onDelete,
}: {
  sprint: Sprint;
  authed: boolean;
  joinPending: boolean;
  leavePending: boolean;
  closePending: boolean;
  statsOpen: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onOpenPage: () => void;
  onToggleStats: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isClosed = sprint.status !== "open";
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {/* Members get [Open] + [Leave]; non-members get [Join] + [Open].
          "Open" navigates to the dedicated SprintFullPage (?s=<slug>)
          so the chat + Talk browser have room to breathe. */}
      {authed && !isClosed && (
        sprint.is_joined ? (
          <>
            <button
              type="button"
              onClick={onOpenPage}
              className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded transition"
              data-testid={`sprint-open-${sprint.slug}`}
            >
              {t("citizen.sprints.open")}
            </button>
            <button
              type="button"
              onClick={onLeave}
              disabled={leavePending}
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 ring-1 ring-slate-700 px-2.5 py-1 rounded transition"
              data-testid={`sprint-leave-${sprint.slug}`}
            >
              {t("citizen.sprints.leave")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onJoin}
              disabled={joinPending}
              className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded transition"
              data-testid={`sprint-join-${sprint.slug}`}
            >
              {t("citizen.sprints.join")}
            </button>
            <button
              type="button"
              onClick={onOpenPage}
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 ring-1 ring-slate-700 px-2.5 py-1 rounded transition"
              data-testid={`sprint-open-${sprint.slug}`}
            >
              {t("citizen.sprints.preview")}
            </button>
          </>
        )
      )}
      {sprint.workflow_classify_url && (
        <a
          href={sprint.workflow_classify_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-2.5 py-1 rounded transition"
        >
          🔭 {sprint.workflow_name || t("citizen.classifyDefault")}
        </a>
      )}
      <button
        type="button"
        onClick={onToggleStats}
        className="text-[11px] text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded transition"
        data-testid={`sprint-stats-toggle-${sprint.slug}`}
      >
        {statsOpen ? t("citizen.sprints.hideStats") : t("citizen.sprints.showStats")}
      </button>
      {sprint.can_manage && !isClosed && (
        <button
          type="button"
          onClick={onClose}
          disabled={closePending}
          className="text-[11px] text-amber-300 hover:text-amber-200 px-2.5 py-1 rounded transition"
          data-testid={`sprint-close-${sprint.slug}`}
        >
          {t("citizen.sprints.close")}
        </button>
      )}
      {sprint.can_manage && (
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded transition"
        >
          {t("citizen.sprints.edit")}
        </button>
      )}
      {sprint.can_manage && (
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded transition"
        >
          {t("citizen.sprints.delete")}
        </button>
      )}
    </div>
  );
}

function SprintStatsPanel({ sprint }: { sprint: Sprint }) {
  const { t, i18n } = useTranslation();
  const fmt = useLocaleNumber();
  const stats = useQuery({
    queryKey: ["sprint-stats", sprint.slug],
    queryFn: () => zooniverse.sprintStats(sprint.slug),
    staleTime: 30_000,
  });
  if (stats.isLoading) {
    return <p className="text-xs text-slate-500">{t("common.loading")}</p>;
  }
  if (!stats.data) return null;
  const s = stats.data;
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—";
  const todayLabel = new Date().toLocaleDateString(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {t("citizen.sprints.stats.heading")}
      </div>
      <p className="text-[11px] text-slate-500">
        {!s.starts_at
          ? t("citizen.sprints.stats.noStart")
          : s.is_open
            ? t("citizen.sprints.stats.windowOpen", {
                from: fmtDate(s.starts_at),
                to: todayLabel,
              })
            : t("citizen.sprints.stats.windowClosed", {
                from: fmtDate(s.starts_at),
                to: fmtDate(s.ends_at),
              })}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <SprintStatCard
          label={t("citizen.sprints.stats.classifications")}
          value={fmt(s.total_classifications)}
        />
        <SprintStatCard
          label={t("citizen.sprints.stats.activeUsers")}
          value={fmt(s.active_users)}
        />
        <SprintStatCard
          label={t("citizen.sprints.stats.timeSpent")}
          value={formatDuration(s.time_spent_s)}
        />
        <SprintStatCard
          label={t("citizen.sprints.stats.participants")}
          value={fmt(s.participants)}
        />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          {t("citizen.sprints.stats.topContributors")}
        </div>
        {s.top_contributors.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">
            {t("citizen.sprints.stats.topContributorsEmpty")}
          </p>
        ) : (
          <TopContributorsList contributors={s.top_contributors} />
        )}
      </div>
      <p className="text-[10px] text-slate-500 italic leading-snug">
        {t("citizen.sprints.stats.scopeNote")}
      </p>
    </div>
  );
}

function SprintStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded px-2.5 py-1.5">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="font-mono text-slate-200">{value}</div>
    </div>
  );
}

function SprintEditorModal({
  zid,
  project,
  existing,
  onClose,
  onSaved,
}: {
  zid: number;
  project: ZooniverseProject;
  existing: Sprint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = existing !== null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [startsAt, setStartsAt] = useState<string>(existing?.starts_at ?? "");
  const [endsAt, setEndsAt] = useState<string>(existing?.ends_at ?? "");
  const [workflowId, setWorkflowId] = useState<number | null>(
    existing?.workflow_id ?? null,
  );

  const active = (project.workflows ?? []).filter((w) => w.active);

  const save = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return zooniverse.patchSprint(existing!.slug, {
          title,
          description,
          starts_at: startsAt || null,
          ends_at: endsAt || null,
          workflow_id: workflowId,
        });
      }
      return zooniverse.createSprint(zid, {
        title,
        description,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        workflow_id: workflowId,
      });
    },
    onSuccess: () => onSaved(),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="sprint-editor-modal"
    >
      <div
        className="w-full max-w-xl bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-100">
            {isEdit ? t("citizen.sprints.form.editTitle") : t("citizen.sprints.form.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>
        <form
          className="px-5 py-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) save.mutate();
          }}
        >
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              {t("citizen.sprints.form.fieldTitle")} *
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-sm"
              data-testid="sprint-form-title"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              {t("citizen.sprints.form.fieldDescription")}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              {t("citizen.sprints.form.fieldWorkflow")}
            </span>
            <select
              value={workflowId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? parseInt(e.target.value, 10) : null;
                setWorkflowId(Number.isFinite(v) ? v : null);
              }}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-sm"
              data-testid="sprint-form-workflow"
            >
              <option value="">{t("citizen.sprints.workflowAny")}</option>
              {active.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.display_name}
                </option>
              ))}
            </select>
            {active.length === 0 && (
              <p className="text-[10px] text-amber-300 mt-1">
                {t("citizen.sprints.form.noActiveWorkflowsHint")}
              </p>
            )}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                {t("citizen.sprints.form.fieldStartsAt")}
              </span>
              <DateTimePicker
                value={startsAt}
                onChange={setStartsAt}
                testId="sprint-form-starts"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                {t("citizen.sprints.form.fieldEndsAt")}
              </span>
              <DateTimePicker
                value={endsAt}
                onChange={setEndsAt}
                testId="sprint-form-ends"
              />
            </label>
          </div>
          {save.error && (
            <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
              {(save.error as Error).message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-md ring-1 ring-slate-700 transition"
            >
              {t("citizen.sprints.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={save.isPending || !title.trim()}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-md transition"
              data-testid="sprint-form-submit"
            >
              {save.isPending
                ? "…"
                : isEdit
                  ? t("citizen.sprints.form.submitEdit")
                  : t("citizen.sprints.form.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SprintStatusDot({ status }: { status: Campaign["status"] }) {
  const color =
    status === "open"
      ? "bg-emerald-500"
      : status === "paused"
        ? "bg-amber-500"
        : status === "completed"
          ? "bg-sky-500"
          : status === "closed"
            ? "bg-slate-500"
            : status === "archived"
              ? "bg-slate-700"
              : "bg-slate-600";
  return <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

/** Render a from–to date pair in the user's UI locale. Returns one of
 *  "from X" / "until X" / "X – Y" / "ongoing". Used both on the
 *  campaigns section here and on the events calendar dot tooltip. */
export function formatCampaignDateRange(
  startsAt: string | null,
  endsAt: string | null,
  locale: string,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (startsAt && endsAt) {
    return t("citizen.campaignDateRange", { from: fmt(startsAt), to: fmt(endsAt) });
  }
  if (startsAt) return t("citizen.campaignNoEnd", { from: fmt(startsAt) });
  if (endsAt) return t("citizen.campaignNoStart", { to: fmt(endsAt) });
  return t("citizen.campaignAlwaysOn");
}

// ---- Subordinate row: in-house campaigns ----

function CampaignsBelow({ me }: { me: Me | null }) {
  const { t } = useTranslation();
  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => campaignsApi.list(),
  });
  const active = (campaigns.data ?? []).filter((c) => c.status === "open");
  if (campaigns.isLoading) return null;
  if (active.length === 0) return null;

  return (
    <div className="border-t border-slate-800 pt-6 opacity-75">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm uppercase tracking-wide text-slate-400">
          {t("citizen.activeCampaigns")}
        </h3>
        <span className="text-[9px] uppercase tracking-wide text-slate-500 bg-slate-900/80 ring-1 ring-slate-800 rounded px-1 py-px">
          beta
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">{t("citizen.activeCampaignsHint")}</p>
      {/* Reuse the existing CampaignsPage. It renders its own list +
          detail flow internally. */}
      {me && <CampaignsPage me={me} />}
    </div>
  );
}
