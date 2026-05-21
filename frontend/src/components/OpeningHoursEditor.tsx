import { useTranslation } from "react-i18next";
import type { OpeningDayKey, OpeningSchedule } from "../lib/api";

const DAYS: OpeningDayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const EMPTY_DAY = { intervals: [] as [string, string][], auto_checkin: false };

function getDay(schedule: OpeningSchedule, day: OpeningDayKey) {
  return schedule[day] ?? EMPTY_DAY;
}

/** Editor for Place.opening_hours_schedule.
 *
 *  One row per weekday with up to 2 intervals (so a place can model
 *  morning + afternoon shifts with a lunch break). A per-day "Auto
 *  check-in" toggle tells the backend to keep an anonymous
 *  "Hvězdárna otevřena" presence active during the listed intervals
 *  via the periodic celery beat task — see apps/presence/tasks.
 */
export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningSchedule;
  onChange: (next: OpeningSchedule) => void;
}) {
  const { t } = useTranslation();

  function patchDay(day: OpeningDayKey, partial: Partial<typeof EMPTY_DAY>) {
    const current = getDay(value, day);
    const next: OpeningSchedule = {
      ...value,
      [day]: { ...current, ...partial },
    };
    // Cleanup: drop empty days so we don't bloat JSON with zeros
    if (
      !next[day]?.intervals.length &&
      !next[day]?.auto_checkin
    ) {
      const { [day]: _drop, ...rest } = next;
      onChange(rest);
    } else {
      onChange(next);
    }
  }

  function setInterval(
    day: OpeningDayKey,
    idx: number,
    field: 0 | 1,
    val: string,
  ) {
    const dayCfg = getDay(value, day);
    const intervals = dayCfg.intervals.map((iv, i) => {
      if (i !== idx) return iv;
      const copy: [string, string] = [iv[0], iv[1]];
      copy[field] = val;
      return copy;
    });
    patchDay(day, { intervals });
  }

  function addInterval(day: OpeningDayKey) {
    const dayCfg = getDay(value, day);
    if (dayCfg.intervals.length >= 2) return;
    const defaults: [string, string] =
      dayCfg.intervals.length === 0 ? ["08:00", "12:00"] : ["13:00", "17:00"];
    patchDay(day, { intervals: [...dayCfg.intervals, defaults] });
  }

  function removeInterval(day: OpeningDayKey, idx: number) {
    const dayCfg = getDay(value, day);
    patchDay(day, {
      intervals: dayCfg.intervals.filter((_, i) => i !== idx),
    });
  }

  return (
    <div className="ring-1 ring-slate-800 rounded-md p-2 space-y-1">
      <p className="text-[10px] text-slate-500 mb-1">
        {t("place.form.openingHoursHelp")}
      </p>
      {DAYS.map((day) => {
        const cfg = getDay(value, day);
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-1.5 text-xs py-1 border-b border-slate-800 last:border-b-0"
            data-testid={`opening-hours-${day}`}
          >
            <span className="w-8 text-slate-400 uppercase font-mono">
              {t(`place.form.day.${day}`)}
            </span>
            {cfg.intervals.length === 0 && (
              <span className="text-slate-500 italic">
                {t("place.form.closedDay")}
              </span>
            )}
            {cfg.intervals.map((iv, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <input
                  type="time"
                  value={iv[0]}
                  onChange={(e) => setInterval(day, i, 0, e.target.value)}
                  className="bg-slate-950 ring-1 ring-slate-700 rounded px-1 py-0.5 text-slate-100 font-mono w-20"
                />
                <span className="text-slate-500">–</span>
                <input
                  type="time"
                  value={iv[1]}
                  onChange={(e) => setInterval(day, i, 1, e.target.value)}
                  className="bg-slate-950 ring-1 ring-slate-700 rounded px-1 py-0.5 text-slate-100 font-mono w-20"
                />
                <button
                  type="button"
                  onClick={() => removeInterval(day, i)}
                  className="text-rose-400 hover:text-rose-300 px-1"
                  aria-label="Remove interval"
                >
                  ✕
                </button>
              </div>
            ))}
            {cfg.intervals.length < 2 && (
              <button
                type="button"
                onClick={() => addInterval(day)}
                className="text-[11px] px-1.5 py-0.5 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
                data-testid={`opening-hours-add-${day}`}
              >
                + {t("place.form.addInterval")}
              </button>
            )}
            <span className="flex-1" />
            <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={!!cfg.auto_checkin}
                disabled={cfg.intervals.length === 0}
                onChange={(e) => patchDay(day, { auto_checkin: e.target.checked })}
              />
              <span title={t("place.form.autoCheckinHint")}>
                {t("place.form.autoCheckin")}
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only renderer for opening_hours_schedule, used in PlaceDetail. */
export function OpeningHoursDisplay({ schedule }: { schedule: OpeningSchedule }) {
  const { t } = useTranslation();
  const hasAny = DAYS.some((d) => (schedule[d]?.intervals.length ?? 0) > 0);
  if (!hasAny) return null;
  return (
    <div className="text-xs">
      <p className="text-[10px] uppercase text-slate-500 tracking-wide mb-1">
        {t("place.form.openingHours")}
      </p>
      <ul className="space-y-0.5">
        {DAYS.map((day) => {
          const cfg = schedule[day];
          if (!cfg || cfg.intervals.length === 0) return null;
          return (
            <li key={day} className="flex items-center gap-2">
              <span className="w-8 text-slate-400 uppercase font-mono">
                {t(`place.form.day.${day}`)}
              </span>
              <span className="text-slate-200 font-mono">
                {cfg.intervals.map((iv) => `${iv[0]}–${iv[1]}`).join(", ")}
              </span>
              {cfg.auto_checkin && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 ring-1 ring-emerald-700/40 text-emerald-300"
                  title={t("place.form.autoCheckinHint")}
                >
                  ↻ auto
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
