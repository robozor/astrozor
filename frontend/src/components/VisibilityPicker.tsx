import { useTranslation } from "react-i18next";
import type { VisibilityLevel } from "../lib/api";
import { UserAllowlistPicker } from "./UserAllowlistPicker";

/**
 * Re-usable visibility editor for any owner-managed entity (Place,
 * Event, …). Renders 4 radio chips for the visibility level plus a
 * conditional textarea for the "allowlist" mode where the owner pastes
 * a list of e-mails.
 *
 * Used twice on the same form: once for the entity's own visibility,
 * once for the discussion override. The discussion variant accepts
 * `allowInherit` to render a 5th "inherit from entity" option that
 * maps to an empty-string visibility on the wire.
 */
export function VisibilityPicker({
  label,
  value,
  allowedEmails,
  onChange,
  onAllowedEmailsChange,
  allowInherit = false,
  testidPrefix = "visibility",
  ownerEmail,
}: {
  label: string;
  value: "" | VisibilityLevel;
  allowedEmails: string[];
  onChange: (next: "" | VisibilityLevel) => void;
  onAllowedEmailsChange: (next: string[]) => void;
  allowInherit?: boolean;
  testidPrefix?: string;
  /** Owner of the entity — excluded from the available pane because
      they always have access. */
  ownerEmail?: string;
}) {
  const { t } = useTranslation();

  // Buttons rendered in fixed order. The "inherit" pseudo-level only
  // shows up when the parent passes allowInherit=true (i.e. on the
  // discussion picker, where empty string = inherit from entity).
  const options: Array<{ key: "" | VisibilityLevel; label: string; icon: string }> = [];
  if (allowInherit) {
    options.push({ key: "", label: t("visibility.inherit"), icon: "↩" });
  }
  options.push(
    { key: "public", label: t("visibility.public"), icon: "🌐" },
    { key: "members", label: t("visibility.members"), icon: "👥" },
    { key: "allowlist", label: t("visibility.allowlist"), icon: "✓" },
    { key: "private", label: t("visibility.private"), icon: "🔒" },
  );

  return (
    <div data-testid={`${testidPrefix}-root`}>
      <label className="text-[10px] text-slate-500 block mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key || "__inherit"}
            type="button"
            onClick={() => onChange(o.key)}
            data-testid={`${testidPrefix}-${o.key || "inherit"}`}
            className={`text-xs px-2.5 py-1.5 rounded-md ring-1 transition flex items-center gap-1.5 ${
              value === o.key
                ? "bg-indigo-600 ring-indigo-500 text-white"
                : "bg-slate-900 ring-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span aria-hidden>{o.icon}</span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      {value === "allowlist" && (
        <div className="mt-2 space-y-1">
          <UserAllowlistPicker
            selectedEmails={allowedEmails}
            onChange={onAllowedEmailsChange}
            ownerEmail={ownerEmail}
          />
          <p className="text-[11px] text-slate-500">
            {t("visibility.picker.hint")}
          </p>
        </div>
      )}
    </div>
  );
}
