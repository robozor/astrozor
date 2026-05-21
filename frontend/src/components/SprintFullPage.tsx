import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError, type Me, type Sprint, zooniverse } from "../lib/api";
import { SprintChat } from "./SprintChat";
import { ZooniverseTalkBrowser } from "./ZooniverseTalkBrowser";

/**
 * Dedicated full-width sprint page — replaces the inline SprintPanel.
 *
 * Layout: back button → header (title, dates, coordinator, status)
 * → "Open workflow on Zooniverse" CTA → 2-column body with chat
 * (left, wide) + stats / Talk browser (right, sticky).
 *
 * Loaded via the ``?s=<slug>`` URL param. The back button drops the
 * param and returns to the project detail (or grid if ``?p`` is
 * also missing).
 */
export function SprintFullPage({
  slug,
  onBack,
  me,
}: {
  slug: string;
  onBack: () => void;
  me: Me | null;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  // The sprint envelope isn't keyed by zid here — we look it up by
  // slug via the per-project listing. Cheaper than introducing a
  // dedicated ``GET /sprints/{slug}`` endpoint; reuses cached data
  // when the user navigates from the project page.
  const sprintsCache = useMemo(() => {
    const cache = qc.getQueriesData<Sprint[]>({
      queryKey: ["zooniverse-sprints"],
    });
    for (const [, data] of cache) {
      if (Array.isArray(data)) {
        const hit = data.find((s) => s.slug === slug);
        if (hit) return hit;
      }
    }
    return null;
  }, [qc, slug]);
  // ``stats`` is the cheapest endpoint that returns sprint metadata
  // we need (project linkage, workflow_classify_url come from the
  // Sprint envelope itself, which we already have in the list cache).
  // If the cache is cold (deep-link / refresh), fall back to fetching
  // every sprint of the catalogue — slow but rare.
  const statsQ = useQuery({
    queryKey: ["sprint-stats", slug],
    queryFn: () => zooniverse.sprintStats(slug),
    staleTime: 30_000,
  });
  const cold = useQuery({
    queryKey: ["sprint-by-slug-cold", slug],
    queryFn: async () => {
      // Fan out across catalogued projects looking for the slug. The
      // catalogue is small (~20 projects), so this is a few hundred
      // ms worst-case.
      const projects = await zooniverse.listProjects(true);
      for (const p of projects) {
        const sprints = await zooniverse.listSprints(p.zooniverse_id);
        const hit = sprints.find((s) => s.slug === slug);
        if (hit) return hit;
      }
      return null;
    },
    enabled: !sprintsCache,
    staleTime: 60_000,
  });
  const sprint: Sprint | null = sprintsCache || cold.data || null;

  // Hooks MUST come before any conditional return — React enforces a
  // stable hook order across renders. Earlier returns sit below
  // these two ``useMutation`` calls.
  const join = useMutation({
    mutationFn: () => zooniverse.joinSprint(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zooniverse-sprints"] });
      qc.invalidateQueries({ queryKey: ["sprint-by-slug-cold", slug] });
    },
  });
  const leave = useMutation({
    mutationFn: () => zooniverse.leaveSprint(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zooniverse-sprints"] });
      qc.invalidateQueries({ queryKey: ["sprint-by-slug-cold", slug] });
    },
  });

  if (!sprint && (cold.isLoading || cold.isFetching)) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("common.back")}
        </button>
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      </section>
    );
  }
  if (!sprint) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("common.back")}
        </button>
        <p className="text-rose-400 text-sm">{t("citizen.sprints.notFound")}</p>
      </section>
    );
  }

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—";

  return (
    <section
      data-testid={`sprint-page-${slug}`}
      className="space-y-4"
    >
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← {t("citizen.sprints.backToProject")}
        </button>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {t("citizen.sprints.statusLabel", { status: sprint.status })}
        </span>
      </header>

      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">{sprint.title}</h2>
        <p className="text-xs text-slate-500">
          {sprint.starts_at && sprint.ends_at
            ? t("citizen.sprints.dateRange", {
                from: fmtDate(sprint.starts_at),
                to: fmtDate(sprint.ends_at),
              })
            : sprint.starts_at
              ? t("citizen.sprints.openEnded", { from: fmtDate(sprint.starts_at) })
              : t("citizen.sprints.anyTime")}
          {" · "}
          {t("citizen.sprints.coordinator")}:{" "}
          {sprint.coordinator_display_name || sprint.coordinator_email}
          {sprint.workflow_name && " · "}
          {sprint.workflow_name &&
            t("citizen.sprints.workflowLabel", { name: sprint.workflow_name })}
        </p>
        {sprint.description && (
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {sprint.description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sprint.workflow_classify_url && (
          <a
            href={sprint.workflow_classify_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-md transition"
          >
            🔭 {t("citizen.sprints.openOnZooniverse")} ↗
          </a>
        )}
        {sprint.is_joined ? (
          <button
            type="button"
            onClick={() => leave.mutate()}
            disabled={leave.isPending}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 ring-1 ring-slate-700 px-3 py-1.5 rounded transition"
          >
            {t("citizen.sprints.leave")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => join.mutate()}
            disabled={join.isPending}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition"
          >
            {t("citizen.sprints.join")}
          </button>
        )}
      </div>

      {!sprint.is_joined && (
        <div
          role="region"
          aria-label={t("citizen.sprints.joinPromptHeading")}
          className="bg-indigo-950/40 ring-1 ring-indigo-800/60 rounded-xl p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-indigo-100">
            👋 {t("citizen.sprints.joinPromptHeading")}
          </h3>
          <p className="text-xs text-indigo-100/80 leading-snug">
            {t("citizen.sprints.joinPromptBody")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => join.mutate()}
              disabled={join.isPending}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition"
              data-testid="sprint-page-join"
            >
              {t("citizen.sprints.join")}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 ring-1 ring-slate-700 px-3 py-1.5 rounded transition"
            >
              ← {t("citizen.sprints.backToProject")}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div className="space-y-4 min-w-0">
          {sprint.is_joined && (
            <SprintChat sprint={sprint} currentUserEmail={me?.email} />
          )}
        </div>
        <aside className="space-y-4 min-w-0">
          {statsQ.data && (
            <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {t("citizen.sprints.stats.heading")}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <SprintStatCard
                  label={t("citizen.sprints.stats.classifications")}
                  value={statsQ.data.total_classifications.toLocaleString(
                    i18n.language,
                  )}
                />
                <SprintStatCard
                  label={t("citizen.sprints.stats.activeUsers")}
                  value={statsQ.data.active_users.toLocaleString(i18n.language)}
                />
                <SprintStatCard
                  label={t("citizen.sprints.stats.participants")}
                  value={statsQ.data.participants.toLocaleString(i18n.language)}
                />
                <SprintStatCard
                  label={t("citizen.sprints.stats.timeSpent")}
                  value={formatDuration(statsQ.data.time_spent_s)}
                />
              </div>
            </div>
          )}
          {statsQ.isError && (
            <p className="text-[11px] text-rose-400">
              {(statsQ.error as ApiError)?.detail || t("common.error")}
            </p>
          )}
          <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4">
            <ZooniverseTalkBrowser
              zid={
                /* statsQ doesn't carry zid; fall back to the
                   sprint envelope which already has it via the
                   project relation. */
                resolveZidForSprint(sprint, qc) || 0
              }
            />
          </div>
        </aside>
      </div>
    </section>
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

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Best-effort lookup of the Zooniverse project ID for a sprint by
 * scanning the React Query cache. We deliberately don't refetch —
 * if it's not cached, the Talk widget renders empty and that's
 * acceptable (the user reached the sprint via direct deep-link
 * before opening any project page).
 */
function resolveZidForSprint(
  sprint: Sprint,
  qc: ReturnType<typeof useQueryClient>,
): number {
  const cache = qc.getQueriesData<Sprint[]>({
    queryKey: ["zooniverse-sprints"],
  });
  for (const [key, data] of cache) {
    if (Array.isArray(data) && data.some((s) => s.id === sprint.id)) {
      // The query key is ["zooniverse-sprints", zid]; pull the zid out.
      const zid = (key as unknown[])[1];
      if (typeof zid === "number") return zid;
    }
  }
  return 0;
}
