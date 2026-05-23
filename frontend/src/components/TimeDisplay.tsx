import { useTranslation } from "react-i18next";
import type { Me } from "../lib/api";

/**
 * Render a datetime in up to three flavours:
 *   - UTC      (canonical, what the DB stores)
 *   - Local    (the entity's GPS-derived TZ — passed via `entityTimezone`)
 *   - User     (the viewer's preferred TZ — read from `me.profile.timezone_name`)
 *
 * Each flavour can be toggled off per-user (Settings → Časové zóny).
 * Defaults are all-on for new accounts. When the viewer is anonymous
 * we still show all three using the browser's local TZ as the "user"
 * line — that's still informative for visitors.
 *
 * Lines render compact (single column) by default. Pass `inline` for
 * a one-line "UTC 18:00 · Local 19:00 · You 19:00" rendering used in
 * dense list rows where space is tight.
 */
export function TimeDisplay({
  iso,
  entityTimezone,
  me,
  inline = false,
  className = "",
  testid,
}: {
  iso: string | null | undefined;
  entityTimezone?: string | undefined;
  me?: Me | null;
  inline?: boolean;
  className?: string;
  testid?: string;
}) {
  const { t } = useTranslation();
  if (!iso) {
    return (
      <span className={className} data-testid={testid}>
        —
      </span>
    );
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    // Defensive — invalid date string. Render as-is so the UI doesn't
    // crash but the bug is visible.
    return (
      <span className={className} data-testid={testid}>
        {iso}
      </span>
    );
  }

  const showUtc = me?.profile?.show_utc ?? true;
  const showLocal = me?.profile?.show_local ?? true;
  const showUser = me?.profile?.show_user ?? true;

  const userTz =
    me?.profile?.timezone_name ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  // Always render the "Local" row when the user has show_local on AND
  // the entity has a GPS-derived TZ — even if it matches the user's
  // own TZ. Showing the duplicate value is intentional per UX spec
  // (3 explicit rows beats inferring "well it's the same so skip").
  const localTz = entityTimezone || "";

  // Each row has THREE parts now:
  //   - kind: the type tag (UTC / Local / User) — always rendered so
  //     the reader instantly knows which clock they're looking at,
  //     even when two rows show identical wall-clock values.
  //   - tz:   the IANA shortcut next to it (e.g. "Prague").
  //   - text: the formatted date+time string itself.
  type Row = { kind: string; tz: string; text: string; hint?: string };
  const rows: Row[] = [];
  if (showUtc) {
    rows.push({
      kind: t("time.utc"),
      tz: "UTC",
      text: format(d, "UTC"),
      hint: t("time.utcHint"),
    });
  }
  if (showLocal && localTz) {
    rows.push({
      kind: t("time.local"),
      tz: shortTz(localTz),
      text: format(d, localTz),
      hint: t("time.localHint"),
    });
  }
  if (showUser) {
    rows.push({
      kind: t("time.user"),
      tz: shortTz(userTz),
      text: format(d, userTz),
      hint: t("time.userHint"),
    });
  }

  if (rows.length === 0) {
    return (
      <span className={className} data-testid={testid}>
        {format(d, "UTC")} UTC
      </span>
    );
  }

  if (inline) {
    return (
      <span className={className} data-testid={testid}>
        {rows.map((r, i) => (
          <span key={r.kind}>
            {i > 0 && <span className="text-slate-600"> · </span>}
            <span title={r.hint}>
              <span className="text-slate-500 mr-1 font-mono text-[10px] uppercase">
                {r.kind}
              </span>
              <span>{r.text}</span>
              <span className="text-slate-600 ml-1 text-[10px]">{r.tz}</span>
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-col ${className}`} data-testid={testid}>
      {rows.map((r) => (
        <span key={r.kind} className="text-xs leading-snug" title={r.hint}>
          {/* fixed-width kind tag so the time columns line up vertically
              even when the kind labels have different lengths */}
          <span className="text-slate-500 mr-1.5 font-mono text-[10px] uppercase inline-block w-9">
            {r.kind}
          </span>
          <span>{r.text}</span>
          <span className="text-slate-600 ml-1.5 text-[10px]">{r.tz}</span>
        </span>
      ))}
    </span>
  );
}

function format(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    // Bad IANA name — fall back to UTC so we never throw.
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  }
}

function shortTz(tz: string): string {
  // Show the trailing path segment for IANA names ("Prague" from
  // "Europe/Prague"), and keep "UTC" / "GMT" verbatim. Better than
  // showing "Europe/Prague" repeatedly in every row — the long form
  // lives in the hover tooltip.
  if (tz === "UTC" || tz === "GMT") return tz;
  const i = tz.lastIndexOf("/");
  return i >= 0 ? tz.slice(i + 1).replace(/_/g, " ") : tz;
}
