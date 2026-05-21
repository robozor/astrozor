import DatePicker, { registerLocale } from "react-datepicker";
import { cs } from "date-fns/locale/cs";
import { enUS } from "date-fns/locale/en-US";
import { useTranslation } from "react-i18next";
import "react-datepicker/dist/react-datepicker.css";

/**
 * Dark-themed date+time picker wrapper around react-datepicker. We use
 * the library (not the browser's native <input type="datetime-local">)
 * because the native UX varies wildly across OS / browser — users
 * complained that the date+time entry felt non-existent. This gives a
 * proper calendar grid + scrollable hour/minute list with the same
 * visual style everywhere.
 *
 * Czech and English locales are pre-registered; the active app
 * language picks the right month/day names + first-day-of-week.
 */
registerLocale("cs", cs);
registerLocale("en", enUS);

export function DateTimePicker({
  value,
  onChange,
  required,
  testId,
  placeholder,
}: {
  /** ISO timestamp string (UTC) or empty. */
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  testId?: string;
  placeholder?: string;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith("cs") ? "cs" : "en";
  const date = value ? new Date(value) : null;
  return (
    <div className="astrozor-datepicker">
      <DatePicker
        selected={date}
        onChange={(d) => onChange(d ? d.toISOString() : "")}
        showTimeSelect
        timeIntervals={15}
        dateFormat={locale === "cs" ? "d. M. yyyy HH:mm" : "yyyy-MM-dd HH:mm"}
        timeFormat="HH:mm"
        locale={locale}
        required={required}
        placeholderText={placeholder}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
        data-testid={testId}
        // Render the popup at the top of the document so it isn't
        // clipped by parent overflow (sticky headers, modals, etc.).
        popperPlacement="bottom-start"
      />
    </div>
  );
}
