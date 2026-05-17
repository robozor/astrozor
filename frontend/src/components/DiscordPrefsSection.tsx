import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  discordPrefs,
  lookups,
  type DiscordPref,
  type DiscordPrefKind,
} from "../lib/api";

const KIND_ORDER: DiscordPrefKind[] = [
  "place_followed_checkin",
  "place_any_checkin",
  "article_published",
  "event_status_changed",
  "project_lifecycle",
  "campaign_status_changed",
];

const EVENT_STATES = [
  "draft",
  "planned",
  "registration_open",
  "registration_closed",
  "happening",
  "done",
  "cancelled",
];

const CAMPAIGN_STATES = ["draft", "open", "paused", "closed", "completed", "archived"];

const PROJECT_ACTIONS = ["created", "archived"];

export function DiscordPrefsSection({ hasWebhook }: { hasWebhook: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["discord-prefs"],
    queryFn: () => discordPrefs.list(),
  });
  const byKind = useMemo(() => {
    const m = new Map<DiscordPrefKind, DiscordPref>();
    for (const p of list.data ?? []) m.set(p.kind, p);
    return m;
  }, [list.data]);

  const upsert = useMutation({
    mutationFn: (args: {
      kind: DiscordPrefKind;
      enabled: boolean;
      filters: Record<string, unknown>;
    }) => discordPrefs.upsert(args.kind, { enabled: args.enabled, filters: args.filters }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discord-prefs"] }),
  });

  return (
    <section data-testid="discord-prefs" className="space-y-3">
      <header>
        <h4 className="text-sm text-slate-300 font-medium">
          {t("settings.discord.title")}
        </h4>
        <p className="text-xs text-slate-500 mt-1">
          {t("settings.discord.subtitle")}
        </p>
      </header>

      {!hasWebhook && (
        <p className="text-xs text-amber-300 bg-amber-950/40 ring-1 ring-amber-900/50 rounded-md px-3 py-2">
          {t("settings.discord.noWebhook")}
        </p>
      )}

      <ul className="space-y-2">
        {KIND_ORDER.map((kind) => (
          <KindRow
            key={kind}
            kind={kind}
            pref={byKind.get(kind)}
            disabled={!hasWebhook}
            onChange={(enabled, filters) =>
              upsert.mutate({ kind, enabled, filters })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function KindRow({
  kind,
  pref,
  disabled,
  onChange,
}: {
  kind: DiscordPrefKind;
  pref?: DiscordPref;
  disabled: boolean;
  onChange: (enabled: boolean, filters: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const enabled = pref?.enabled ?? false;
  const filters = (pref?.filters ?? {}) as Record<string, unknown>;

  return (
    <li
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-3"
      data-testid={`pref-${kind}`}
    >
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked, filters)}
          className="accent-indigo-500"
        />
        <span className="text-sm text-slate-100">{t(`settings.discord.kind.${kind}`)}</span>
      </label>
      <p className="text-[11px] text-slate-500 mt-1 ml-6">
        {t(`settings.discord.kindHint.${kind}`)}
      </p>

      {enabled && (
        <div className="mt-3 ml-6">
          {kind === "article_published" && (
            <UserFilter
              label={t("settings.discord.filter.authors")}
              value={(filters.author_emails as string[]) || []}
              onChange={(emails) => onChange(true, { ...filters, author_emails: emails })}
            />
          )}
          {kind === "event_status_changed" && (
            <>
              <UserFilter
                label={t("settings.discord.filter.organizers")}
                value={(filters.organizer_emails as string[]) || []}
                onChange={(emails) =>
                  onChange(true, { ...filters, organizer_emails: emails })
                }
              />
              <TitledFilter
                label={t("settings.discord.filter.events")}
                kind="events"
                value={(filters.event_slugs as string[]) || []}
                onChange={(slugs) => onChange(true, { ...filters, event_slugs: slugs })}
              />
              <StatesFilter
                label={t("settings.discord.filter.toStates")}
                options={EVENT_STATES}
                value={(filters.to_states as string[]) || []}
                onChange={(states) => onChange(true, { ...filters, to_states: states })}
              />
            </>
          )}
          {kind === "project_lifecycle" && (
            <StatesFilter
              label={t("settings.discord.filter.actions")}
              options={PROJECT_ACTIONS}
              value={(filters.actions as string[]) || []}
              onChange={(actions) => onChange(true, { ...filters, actions })}
            />
          )}
          {kind === "campaign_status_changed" && (
            <>
              <UserFilter
                label={t("settings.discord.filter.coordinators")}
                value={(filters.coordinator_emails as string[]) || []}
                onChange={(emails) =>
                  onChange(true, { ...filters, coordinator_emails: emails })
                }
              />
              <TitledFilter
                label={t("settings.discord.filter.campaigns")}
                kind="campaigns"
                value={(filters.campaign_slugs as string[]) || []}
                onChange={(slugs) =>
                  onChange(true, { ...filters, campaign_slugs: slugs })
                }
              />
              <StatesFilter
                label={t("settings.discord.filter.toStates")}
                options={CAMPAIGN_STATES}
                value={(filters.to_states as string[]) || []}
                onChange={(states) => onChange(true, { ...filters, to_states: states })}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function StatesFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2">
      <p className="text-[11px] text-slate-400 mb-1">
        {label}{" "}
        <span className="text-slate-600">
          ({value.length === 0 ? t("settings.discord.filter.any") : value.length})
        </span>
      </p>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() =>
                onChange(active ? value.filter((v) => v !== opt) : [...value, opt])
              }
              className={`text-[11px] px-2 py-0.5 rounded font-mono ring-1 ${
                active
                  ? "bg-indigo-600 ring-indigo-500 text-white"
                  : "bg-slate-900 ring-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UserFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const users = useQuery({
    queryKey: ["lookup-users"],
    queryFn: () => lookups.users("", 50),
  });
  return (
    <div className="mb-2">
      <p className="text-[11px] text-slate-400 mb-1">
        {label}{" "}
        <span className="text-slate-600">
          ({value.length === 0 ? t("settings.discord.filter.allUsers") : value.length})
        </span>
      </p>
      <select
        multiple
        value={value}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
        }
        className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1 text-xs text-slate-100 min-h-[6rem]"
      >
        {users.data?.map((u) => (
          <option key={u.email} value={u.email}>
            {(u.display_name || u.email).slice(0, 40)} ({u.email})
          </option>
        ))}
      </select>
    </div>
  );
}

function TitledFilter({
  label,
  kind,
  value,
  onChange,
}: {
  label: string;
  kind: "events" | "campaigns";
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const items = useQuery({
    queryKey: ["lookup", kind],
    queryFn: () => (kind === "events" ? lookups.events("", 50) : lookups.campaigns("", 50)),
  });
  return (
    <div className="mb-2">
      <p className="text-[11px] text-slate-400 mb-1">
        {label}{" "}
        <span className="text-slate-600">
          ({value.length === 0 ? t("settings.discord.filter.any") : value.length})
        </span>
      </p>
      <select
        multiple
        value={value}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
        }
        className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1 text-xs text-slate-100 min-h-[6rem]"
      >
        {items.data?.map((it) => (
          <option key={it.slug} value={it.slug}>
            {it.title} ({it.status})
          </option>
        ))}
      </select>
    </div>
  );
}
