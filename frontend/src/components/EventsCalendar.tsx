import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Campaign, Event } from "../lib/api";

type ViewMode = "month" | "year";

/**
 * A campaign carries a date *range* (starts_at / ends_at). The calendar
 * needs to show it on every day in that range — unlike events which
 * have a single timestamp. Pre-compute the set of yyyy-mm-dd keys a
 * campaign covers so the day-grouping pass is cheap.
 *
 * Open-ended ranges (no end_at) cap at +90 days from now so a
 * "perpetual" campaign doesn't paint the entire calendar.
 */
function campaignDayKeys(c: Campaign): string[] {
  const start = c.starts_at ? new Date(c.starts_at) : null;
  let end = c.ends_at ? new Date(c.ends_at) : null;
  if (!start && !end) return [];
  // Open ranges: clamp to a sane window so we don't iterate forever.
  if (start && !end) {
    end = new Date(start);
    end.setDate(end.getDate() + 90);
  }
  if (end && !start) {
    return [ymd(end)];
  }
  if (!start || !end) return [];
  const keys: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Safety cap: 366 days. Longer "campaigns" lose their tail; that's
  // still better than blowing the loop.
  let n = 0;
  while (cur <= last && n < 366) {
    keys.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
    n += 1;
  }
  return keys;
}

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-500",
  announced: "bg-sky-500",
  registration_open: "bg-emerald-500",
  registration_closed: "bg-amber-500",
  in_progress: "bg-purple-500",
  finished: "bg-slate-600",
  cancelled: "bg-rose-500",
};

/**
 * Calendar above the events list with two view modes:
 *   - Month: classic 6×7 grid with dots per event, day click filters list
 *   - Year:  12 mini-month grids — overview of the whole year; day
 *            click jumps to month view at that date.
 *
 * Selection is owner-controlled via `selectedDate` / `onSelectDate`
 * so the parent can keep the list in sync (and pass null to clear).
 */
export function EventsCalendar({
  events,
  campaigns = [],
  selectedDate,
  onSelectDate,
  onCampaignClick,
}: {
  events: Event[];
  /** Citizen-Science campaigns to render as fuchsia bars on every day
   *  of their date range. Optional — calendar still works without them. */
  campaigns?: Campaign[];
  selectedDate: string | null;
  onSelectDate: (yyyymmdd: string | null) => void;
  /** Called when the user clicks a campaign in the "campaigns on
   *  selected day" list below the grid. Owner decides where to send
   *  them (typically /citizen-science?p=<zid>). */
  onCampaignClick?: (campaign: Campaign) => void;
}) {
  const { t, i18n } = useTranslation();
  const today = new Date();
  const todayKey = ymd(today);

  // Year is the default — gives the visitor the whole-season overview
  // first; they can drill into a single month with the toggle or by
  // clicking a mini-month title.
  const [view, setView] = useState<ViewMode>("year");

  // Tracked separately from selectedDate so the user can navigate
  // through months without losing their filter. View month defaults to
  // the selected day's month if set, otherwise the current month.
  const [viewYear, setViewYear] = useState<number>(
    selectedDate ? parseInt(selectedDate.slice(0, 4), 10) : today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState<number>(
    selectedDate ? parseInt(selectedDate.slice(5, 7), 10) - 1 : today.getMonth(),
  );

  // Group events by yyyy-mm-dd of starts_at (local time of the viewer).
  const byDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const key = ymd(new Date(e.starts_at));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    }
    return map;
  }, [events]);

  // Group campaigns by every yyyy-mm-dd in their date range — that's
  // the difference from events (a campaign occupies a window, not a
  // point). One campaign therefore shows up under multiple day keys.
  const campaignsByDay = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    for (const c of campaigns) {
      for (const key of campaignDayKeys(c)) {
        const arr = map.get(key) ?? [];
        arr.push(c);
        map.set(key, arr);
      }
    }
    return map;
  }, [campaigns]);

  // Campaigns active on the currently selected day — surfaces under
  // the grid so the user can click through to the project detail.
  const campaignsOnSelected = selectedDate
    ? (campaignsByDay.get(selectedDate) ?? [])
    : [];

  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    onSelectDate(todayKey);
  };
  const goPrev = () => {
    if (view === "year") {
      setViewYear(viewYear - 1);
    } else {
      if (viewMonth === 0) {
        setViewYear(viewYear - 1);
        setViewMonth(11);
      } else {
        setViewMonth(viewMonth - 1);
      }
    }
  };
  const goNext = () => {
    if (view === "year") {
      setViewYear(viewYear + 1);
    } else {
      if (viewMonth === 11) {
        setViewYear(viewYear + 1);
        setViewMonth(0);
      } else {
        setViewMonth(viewMonth + 1);
      }
    }
  };

  const headerLabel =
    view === "year"
      ? String(viewYear)
      : new Intl.DateTimeFormat(i18n.language, {
          month: "long",
          year: "numeric",
        }).format(new Date(viewYear, viewMonth, 1));

  // Day click — toggle selection. View mode is NOT changed; the user
  // can stay in Year mode while filtering by day. To leave Year, they
  // either click a mini-month title or flip the toggle.
  const handleDaySelect = (key: string) => {
    if (selectedDate === key) {
      onSelectDate(null);
      return;
    }
    onSelectDate(key);
  };

  return (
    <div
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3 mb-4"
      data-testid="events-calendar"
    >
      <header className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-200 capitalize">
          {headerLabel}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month / Year toggle */}
          <div className="flex gap-0.5 bg-slate-950 rounded-md p-0.5 ring-1 ring-slate-800">
            {(["month", "year"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                data-testid={`calendar-view-${m}`}
                className={`text-xs px-2.5 py-1 rounded transition ${
                  view === m
                    ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t(`events.calendar.${m}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <CalendarNavButton onClick={goPrev} testid="calendar-prev">
              ‹
            </CalendarNavButton>
            <CalendarNavButton onClick={goToday} testid="calendar-today">
              {t("events.calendar.today")}
            </CalendarNavButton>
            <CalendarNavButton onClick={goNext} testid="calendar-next">
              ›
            </CalendarNavButton>
            {selectedDate && (
              <button
                type="button"
                onClick={() => onSelectDate(null)}
                data-testid="calendar-clear"
                className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded transition"
              >
                ✕ {t("events.calendar.clear")}
              </button>
            )}
          </div>
        </div>
      </header>

      {view === "month" ? (
        <MonthGrid
          year={viewYear}
          month={viewMonth}
          byDay={byDay}
          campaignsByDay={campaignsByDay}
          selectedDate={selectedDate}
          todayKey={todayKey}
          onSelectDate={handleDaySelect}
          locale={i18n.language}
        />
      ) : (
        <YearGrid
          year={viewYear}
          byDay={byDay}
          campaignsByDay={campaignsByDay}
          selectedDate={selectedDate}
          todayKey={todayKey}
          onSelectDate={handleDaySelect}
          onJumpToMonth={(m) => {
            setViewMonth(m);
            setView("month");
          }}
          locale={i18n.language}
        />
      )}

      {/* Campaigns active on the selected day. Click → cross-page nav
          to /citizen-science?p=<zid>, handled by the owner via the
          ``onCampaignClick`` callback. */}
      {selectedDate && campaignsOnSelected.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-fuchsia-500" />
            {t("events.calendar.campaignsOnDay")}
          </div>
          <ul className="space-y-1">
            {campaignsOnSelected.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onCampaignClick?.(c)}
                  disabled={!onCampaignClick}
                  data-testid={`calendar-campaign-${c.slug}`}
                  className="w-full text-left flex items-center gap-2 bg-fuchsia-950/30 hover:bg-fuchsia-950/50 ring-1 ring-fuchsia-900/40 rounded px-2.5 py-1.5 text-xs transition disabled:cursor-default disabled:hover:bg-fuchsia-950/30"
                >
                  {c.zooniverse_project_avatar_url ? (
                    <img
                      src={c.zooniverse_project_avatar_url}
                      alt=""
                      className="w-5 h-5 rounded ring-1 ring-fuchsia-900/40 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="w-5 h-5 inline-flex items-center justify-center text-fuchsia-300">
                      🔭
                    </span>
                  )}
                  <span className="text-slate-100 truncate flex-1">{c.title}</span>
                  {c.zooniverse_project_title && (
                    <span className="text-fuchsia-300/80 truncate hidden sm:inline">
                      {c.zooniverse_project_title}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- Month grid (the 6×7 detail view) ----------------------------------

function MonthGrid({
  year,
  month,
  byDay,
  campaignsByDay,
  selectedDate,
  todayKey,
  onSelectDate,
  locale,
}: {
  year: number;
  month: number;
  byDay: Map<string, Event[]>;
  campaignsByDay: Map<string, Campaign[]>;
  selectedDate: string | null;
  todayKey: string;
  onSelectDate: (key: string) => void;
  locale: string;
}) {
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const weekdays = useWeekdayShortNames(locale);

  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {weekdays.map((w) => (
          <div key={w} className="text-center py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const key = ymd(cell.date);
          const dayEvents = byDay.get(key) ?? [];
          const dayCampaigns = campaignsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          const isOutsideMonth = cell.date.getMonth() !== month;
          const hasEvents = dayEvents.length > 0;
          const hasCampaigns = dayCampaigns.length > 0;
          const tooltipLines = [
            ...dayEvents.map((e) => e.title),
            ...dayCampaigns.map((c) => `🔭 ${c.title}`),
          ];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              data-testid={`calendar-day-${key}`}
              title={tooltipLines.length ? tooltipLines.join("\n") : undefined}
              className={`relative h-12 sm:h-14 text-xs rounded transition flex flex-col items-center justify-center gap-0.5 overflow-hidden ${
                isSelected
                  ? "bg-indigo-600/30 ring-1 ring-indigo-500 text-white"
                  : isToday
                    ? "bg-slate-800 ring-1 ring-slate-600 text-slate-100"
                    : isOutsideMonth
                      ? "text-slate-600 hover:bg-slate-900"
                      : "text-slate-300 hover:bg-slate-900"
              }`}
            >
              {/* Campaign band — full-width strip at the bottom marks
                  days inside a campaign window. Distinct fuchsia hue
                  so campaigns don't visually compete with event dots. */}
              {hasCampaigns && !isOutsideMonth && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-1 bg-fuchsia-500/80"
                />
              )}
              <span className="leading-none">{cell.date.getDate()}</span>
              {(hasEvents || hasCampaigns) && (
                <span className="flex items-center gap-0.5">
                  {dayEvents.slice(0, 3).map((e, i) => (
                    <span
                      key={`e-${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[e.status] || "bg-slate-500"}`}
                    />
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[8px] text-slate-400 ml-0.5">
                      +{dayEvents.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---- Year grid (12 mini-months) ---------------------------------------

function YearGrid({
  year,
  byDay,
  campaignsByDay,
  selectedDate,
  todayKey,
  onSelectDate,
  onJumpToMonth,
  locale,
}: {
  year: number;
  byDay: Map<string, Event[]>;
  campaignsByDay: Map<string, Campaign[]>;
  selectedDate: string | null;
  todayKey: string;
  onSelectDate: (key: string) => void;
  onJumpToMonth: (month: number) => void;
  locale: string;
}) {
  const months = Array.from({ length: 12 }, (_, m) => m);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {months.map((m) => (
        <MiniMonth
          key={m}
          year={year}
          month={m}
          byDay={byDay}
          campaignsByDay={campaignsByDay}
          selectedDate={selectedDate}
          todayKey={todayKey}
          onSelectDate={onSelectDate}
          onJumpToMonth={onJumpToMonth}
          locale={locale}
        />
      ))}
    </div>
  );
}

function MiniMonth({
  year,
  month,
  byDay,
  campaignsByDay,
  selectedDate,
  todayKey,
  onSelectDate,
  onJumpToMonth,
  locale,
}: {
  year: number;
  month: number;
  byDay: Map<string, Event[]>;
  campaignsByDay: Map<string, Campaign[]>;
  selectedDate: string | null;
  todayKey: string;
  onSelectDate: (key: string) => void;
  onJumpToMonth: (m: number) => void;
  locale: string;
}) {
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const weekdays = useWeekdayShortNames(locale, true);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(
    new Date(year, month, 1),
  );
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-2">
      <button
        type="button"
        onClick={() => onJumpToMonth(month)}
        className="block w-full text-left text-xs font-medium text-slate-200 hover:text-indigo-300 mb-1 capitalize transition"
        data-testid={`calendar-minimonth-${month}`}
      >
        {monthName}
      </button>
      <div className="grid grid-cols-7 gap-0.5 text-[8px] uppercase text-slate-600 mb-0.5">
        {weekdays.map((w, i) => (
          <div key={i} className="text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const key = ymd(cell.date);
          const dayEvents = byDay.get(key) ?? [];
          const dayCampaigns = campaignsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          const isOutsideMonth = cell.date.getMonth() !== month;
          const hasEvents = dayEvents.length > 0;
          const hasCampaigns = dayCampaigns.length > 0;
          const tooltipLines = [
            ...dayEvents.map((e) => e.title),
            ...dayCampaigns.map((c) => `🔭 ${c.title}`),
          ];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              data-testid={`calendar-mini-day-${key}`}
              title={tooltipLines.length ? tooltipLines.join("\n") : undefined}
              className={`relative h-6 text-[10px] rounded transition flex items-center justify-center overflow-hidden ${
                isSelected
                  ? "bg-indigo-600/30 ring-1 ring-indigo-500 text-white"
                  : isToday
                    ? "bg-slate-800 ring-1 ring-slate-600 text-slate-100"
                    : isOutsideMonth
                      ? "text-slate-700"
                      : hasEvents || hasCampaigns
                        ? "text-slate-200 hover:bg-slate-900"
                        : "text-slate-500 hover:bg-slate-900"
              }`}
            >
              {hasCampaigns && !isOutsideMonth && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-fuchsia-500/80"
                />
              )}
              <span className="inline-flex items-center gap-0.5">
                {cell.date.getDate()}
                {hasEvents && !isOutsideMonth && (
                  <span
                    aria-hidden
                    className="w-1 h-1 rounded-full bg-emerald-500"
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarNavButton({
  onClick,
  children,
  testid,
}: {
  onClick: () => void;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="text-xs text-slate-300 hover:text-slate-100 bg-slate-900 hover:bg-slate-800 ring-1 ring-slate-700 rounded px-2 py-1 transition"
    >
      {children}
    </button>
  );
}

// ---- Helpers -----------------------------------------------------------

function useWeekdayShortNames(locale: string, narrow = false): string[] {
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, {
      weekday: narrow ? "narrow" : "short",
    });
    // 2025-09-01 is a Monday — generate 7 names starting from Monday.
    return [0, 1, 2, 3, 4, 5, 6].map((i) =>
      f.format(new Date(2025, 8, 1 + i)).replace(/\.$/, ""),
    );
  }, [locale, narrow]);
}

function buildMonthGrid(year: number, month: number): { date: Date }[] {
  const first = new Date(year, month, 1);
  const offsetFromMonday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offsetFromMonday);
  const cells: { date: Date }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d });
  }
  return cells;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
