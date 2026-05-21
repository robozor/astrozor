import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { type GHActivityBucket, projects } from "../lib/api";

/**
 * GitHub-style contribution graph for the whole project.
 *
 * The backend aggregates ``/stats/commit_activity`` across every
 * linked GH repo and zero-fills the trailing N-day series. We
 * group those daily buckets into 7-row × 53-col grid (rows = day
 * of week, cols = week) and colour each cell by intensity.
 *
 * GitHub's stats endpoint is computed asynchronously upstream —
 * the first call against a cold repo returns 202 and an empty
 * series. Refresh after ~30 s typically fills it in.
 */
export function ProjectActivityGraph({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const activityQ = useQuery({
    queryKey: ["project-activity", slug, 365],
    queryFn: () => projects.activity(slug, 365),
    staleTime: 5 * 60_000,
  });

  const grid = useMemo(() => buildGrid(activityQ.data?.buckets ?? []), [
    activityQ.data,
  ]);
  const max = grid.maxCount;

  if (activityQ.isLoading) {
    return (
      <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3">
        <p className="text-xs text-slate-500">{t("common.loading")}</p>
      </div>
    );
  }
  if (!activityQ.data) return null;

  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-200">
          {t("projects.activity.heading")}
        </h3>
        <span className="text-[11px] text-slate-500 font-mono">
          {t("projects.activity.totalCommits", {
            count: activityQ.data.total_commits,
          })}
        </span>
      </div>
      {activityQ.data.total_commits === 0 ? (
        <p className="text-[11px] text-slate-500 italic leading-snug">
          {t("projects.activity.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid"
            style={{
              gridTemplateColumns: "auto 1fr",
              gridTemplateRows: "auto auto",
              gap: "4px 6px",
            }}
          >
            {/* (0,0) blank — corner cell above day labels */}
            <div />
            {/* (0,1) month label row */}
            <MonthAxis grid={grid} locale={i18n.language} />
            {/* (1,0) day labels */}
            <DayAxis />
            {/* (1,1) the actual heat grid */}
            <div
              className="grid gap-[3px]"
              style={{
                gridTemplateColumns: `repeat(${grid.weeks}, minmax(11px, 1fr))`,
                gridTemplateRows: "repeat(7, 11px)",
                gridAutoFlow: "column",
                minWidth: `${grid.weeks * 14}px`,
              }}
              role="img"
              aria-label={t("projects.activity.heading")}
            >
              {grid.cells.map((cell, i) => (
                <div
                  key={i}
                  className={`w-full h-full rounded-[2px] ${cellClass(cell?.count ?? 0, max)}`}
                  title={
                    cell
                      ? `${new Date(cell.date).toLocaleDateString(i18n.language, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })} — ${t("projects.activity.commits", { count: cell.count })}`
                      : ""
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
        <span>{t("projects.activity.less")}</span>
        <span className="w-2.5 h-2.5 rounded-[2px] bg-slate-800 ring-1 ring-slate-700" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-900/70" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-700/80" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-300" />
        <span>{t("projects.activity.more")}</span>
      </div>
    </div>
  );
}

/** Day-of-week labels matching the 7-row grid (Sun on top, Sat at
 *  the bottom — same as GitHub). We only show Mon / Wed / Fri so
 *  the labels don't overcrowd the 11-px row height. */
function DayAxis() {
  // The grid rows are 11 px each + 3 px gap; the matching label
  // baseline is shifted via translate-y to land in the middle of
  // its row. Two-letter abbreviations stay locale-neutral.
  const slots = ["", "Mon", "", "Wed", "", "Fri", ""];
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: "repeat(7, 11px)",
        rowGap: "3px",
      }}
    >
      {slots.map((label, i) => (
        <div
          key={i}
          className="text-[9px] text-slate-500 font-mono leading-[11px] pr-1 select-none"
        >
          {label}
        </div>
      ))}
    </div>
  );
}

/** Month names along the top axis, placed on the column where the
 *  1st of that month falls. Same logic GitHub uses on profile
 *  contribution graphs. */
function MonthAxis({
  grid,
  locale,
}: {
  grid: { cells: Cell[]; weeks: number };
  locale: string;
}) {
  // Walk weeks, find the first cell whose date is "day 1" — that's
  // where the month label anchors. Skip the very first cell to
  // avoid a label squeezed into the left edge of the previous month.
  const labels: { week: number; text: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < grid.weeks; w++) {
    for (let row = 0; row < 7; row++) {
      const cell = grid.cells[w * 7 + row];
      if (!cell) continue;
      const d = new Date(cell.date + "T00:00:00Z");
      const m = d.getUTCMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        // Skip first week to avoid overlap; require some slack
        // since the label is wider than a single column.
        if (w >= 1) {
          labels.push({
            week: w,
            text: d.toLocaleDateString(locale, { month: "short" }),
          });
        }
        break;
      }
    }
  }
  return (
    <div
      className="relative h-3"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${grid.weeks}, minmax(11px, 1fr))`,
      }}
    >
      {labels.map((lab) => (
        <span
          key={lab.week}
          className="text-[9px] text-slate-500 font-mono leading-3 select-none"
          style={{
            gridColumnStart: lab.week + 1,
            gridColumnEnd: lab.week + 4,
          }}
        >
          {lab.text}
        </span>
      ))}
    </div>
  );
}

type Cell = { date: string; count: number } | null;

function buildGrid(buckets: GHActivityBucket[]): {
  cells: Cell[];
  weeks: number;
  maxCount: number;
} {
  if (buckets.length === 0) {
    return { cells: [], weeks: 0, maxCount: 0 };
  }
  // Sort by date asc so we can walk forward through time.
  const sorted = [...buckets].sort((a, b) => a.date.localeCompare(b.date));
  // Pad the leading edge so the first column starts on Sunday.
  // GitHub renders Sunday at the top — we follow that. Date.getUTCDay
  // returns 0=Sun..6=Sat which lines up nicely.
  const first = new Date(sorted[0].date + "T00:00:00Z");
  const firstDow = first.getUTCDay();
  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push(null);
  }
  let maxCount = 0;
  for (const b of sorted) {
    cells.push({ date: b.date, count: b.count });
    if (b.count > maxCount) maxCount = b.count;
  }
  // Pad the trailing edge to the next Saturday so the last column is
  // complete (otherwise the CSS grid would leave a ragged edge).
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks = cells.length / 7;
  return { cells, weeks, maxCount };
}

function cellClass(count: number, max: number): string {
  if (count === 0) return "bg-slate-800 ring-1 ring-slate-700/60";
  if (max <= 0) return "bg-emerald-900/70";
  const ratio = count / max;
  if (ratio < 0.25) return "bg-emerald-900/70";
  if (ratio < 0.5) return "bg-emerald-700/80";
  if (ratio < 0.75) return "bg-emerald-500";
  return "bg-emerald-300";
}
