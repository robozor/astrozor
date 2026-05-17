import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, auth, type Identity, type Me, type ProfilePatch } from "../lib/api";
import { DiscordPrefsSection } from "./DiscordPrefsSection";

export function SettingsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">{t("settings.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {t("settings.subtitle", { email: me.user.email })}
        </p>
      </header>

      <EmailVerificationCard me={me} />
      <ProfileSection me={me} />
      <ConnectedAccounts />
      <IntegrationsSection me={me} />
      <StorageSection me={me} />
    </div>
  );
}

// ---- Email verification ----

function EmailVerificationCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const mutation = useMutation({
    mutationFn: auth.resendVerification,
    onSuccess: () => setSent(true),
  });

  if (me.user.email_verified) {
    return (
      <Card>
        <p className="text-emerald-400 text-sm">✓ {t("settings.email.verified")}</p>
      </Card>
    );
  }
  return (
    <Card tone="warn">
      <div className="flex items-start gap-3">
        <span className="text-amber-400">⚠</span>
        <div className="flex-1">
          <p className="text-sm text-slate-200">{t("settings.email.notVerified")}</p>
          <p className="text-xs text-slate-400 mt-1">{t("settings.email.devHint")}</p>
          {sent ? (
            <p className="text-emerald-400 text-xs mt-2">✓ {t("settings.email.resent")}</p>
          ) : (
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="mt-2 text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded transition"
            >
              {mutation.isPending ? "…" : t("auth.resendVerification")}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---- Profile basics ----

function ProfileSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.profile.display_name);
  const [bio, setBio] = useState(me.profile.bio);
  const [club, setClub] = useState(me.profile.club);
  const [equipment, setEquipment] = useState(me.profile.equipment);
  const [visibility, setVisibility] = useState(me.profile.location_visibility);
  const [language, setLanguage] = useState(me.profile.language);
  const { i18n } = useTranslation();

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => auth.patchProfile(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <Card>
      <h3 className="font-medium mb-3">{t("settings.profile.title")}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label={t("settings.profile.displayName")} value={name} onChange={setName} />
        <TextField label={t("settings.profile.club")} value={club} onChange={setClub} />
        <div className="sm:col-span-2">
          <Label>{t("settings.profile.bio")}</Label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>{t("settings.profile.equipment")}</Label>
          <textarea
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
            rows={2}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
          />
        </div>
        <SelectField
          label={t("settings.profile.locationVisibility")}
          value={visibility}
          onChange={(v) => setVisibility(v as "precise" | "region" | "hidden")}
          options={[
            { value: "precise", label: t("settings.profile.visibility.precise") },
            { value: "region", label: t("settings.profile.visibility.region") },
            { value: "hidden", label: t("settings.profile.visibility.hidden") },
          ]}
        />
        <SelectField
          label={t("settings.profile.language")}
          value={language}
          onChange={(v) => setLanguage(v)}
          options={[
            { value: "cs", label: "Čeština" },
            { value: "en", label: "English" },
          ]}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          // Apply language immediately on save — synced with i18n
          if (language !== i18n.language) {
            void i18n.changeLanguage(language);
          }
          save.mutate({
            display_name: name,
            bio,
            club,
            equipment,
            location_visibility: visibility,
            language,
          });
        }}
        disabled={save.isPending}
        className="mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
      >
        {save.isPending ? "…" : t("settings.save")}
      </button>
      {save.isSuccess && (
        <span className="ml-3 text-xs text-emerald-400">✓ {t("settings.saved")}</span>
      )}
    </Card>
  );
}

// ---- Connected accounts (OAuth identities) ----

function ConnectedAccounts() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const identities = useQuery({ queryKey: ["identities"], queryFn: auth.listIdentities });
  const providers = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: auth.oauthProviders,
    staleTime: 5 * 60 * 1000,
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => auth.disconnectIdentity(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["identities"] }),
  });

  const connected: Record<string, Identity | undefined> = {};
  for (const i of identities.data ?? []) connected[i.provider] = i;
  const configured = providers.data ?? { github: false, google: false, mastodon: false };

  return (
    <Card>
      <h3 className="font-medium mb-3">{t("auth.oauth.connectedAccounts")}</h3>
      <div className="space-y-2">
        <ProviderRow
          provider="github"
          label="GitHub"
          identity={connected.github}
          configured={configured.github}
          onDisconnect={(id) => disconnect.mutate(id)}
        />
        <ProviderRow
          provider="google"
          label="Google"
          identity={connected.google}
          configured={configured.google}
          onDisconnect={(id) => disconnect.mutate(id)}
        />
        <ProviderRow
          provider="mastodon"
          label="Mastodon"
          identity={connected.mastodon}
          configured={configured.mastodon}
          onDisconnect={(id) => disconnect.mutate(id)}
        />
      </div>
      {disconnect.isError && (
        <p className="mt-3 text-xs text-rose-400">
          {(disconnect.error as ApiError).detail}
        </p>
      )}
    </Card>
  );
}

function ProviderRow({
  provider,
  label,
  identity,
  configured,
  onDisconnect,
}: {
  provider: "github" | "google" | "mastodon";
  label: string;
  identity?: Identity;
  configured: boolean;
  onDisconnect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (identity) {
    return (
      <div className="flex items-center justify-between bg-slate-950 ring-1 ring-slate-800 rounded-md px-3 py-2 text-sm">
        <div>
          <span className="text-emerald-400 mr-2">●</span>
          <strong>{label}</strong>
          <span className="text-slate-400 ml-2">
            {identity.provider_username || identity.email}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onDisconnect(identity.id)}
          className="text-xs text-rose-400 hover:text-rose-300"
        >
          {t("auth.oauth.disconnect")}
        </button>
      </div>
    );
  }
  // Mastodon: per-instance dynamic registration. Always available, no env.
  if (provider === "mastodon") {
    return <MastodonRow />;
  }
  // Provider not configured on this instance — show a disabled row with a hint.
  if (!configured) {
    const badge = provider === "google" ? "B-3" : "B-1";
    return (
      <div
        title={t("auth.oauth.notConfiguredHint")}
        className="flex items-center justify-between bg-slate-950 ring-1 ring-slate-800 rounded-md px-3 py-2 text-sm opacity-60 cursor-not-allowed"
      >
        <div>
          <span className="text-slate-600 mr-2">○</span>
          <strong>{label}</strong>
          <span className="text-slate-500 ml-2">{t("auth.oauth.notConfiguredHint")}</span>
        </div>
        <span className="text-xs text-slate-600">{badge}</span>
      </div>
    );
  }
  return (
    <a
      href={`/api/v1/auth/${provider}/start?from=settings`}
      className="flex items-center justify-between bg-slate-950 ring-1 ring-slate-800 hover:ring-slate-700 rounded-md px-3 py-2 text-sm transition"
    >
      <div>
        <span className="text-slate-600 mr-2">○</span>
        <strong>{label}</strong>
        <span className="text-slate-500 ml-2">{t("auth.oauth.notConnected")}</span>
      </div>
      <span className="text-xs text-indigo-300">{t(`auth.oauth.connect_${provider}`)}</span>
    </a>
  );
}

function MastodonRow() {
  const { t } = useTranslation();
  const [instance, setInstance] = useState("");
  const register = useMutation({
    mutationFn: (url: string) => auth.registerMastodon(url),
    onSuccess: (data) => {
      // Server has registered the app — go to OAuth authorize.
      window.location.href = data.start_url;
    },
  });

  return (
    <div className="bg-slate-950 ring-1 ring-slate-800 rounded-md px-3 py-2 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-600">○</span>
        <strong>Mastodon</strong>
        <span className="text-slate-500 text-xs">{t("auth.oauth.mastodonHint")}</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (instance.trim()) register.mutate(instance.trim());
        }}
      >
        <input
          type="text"
          value={instance}
          onChange={(e) => setInstance(e.target.value)}
          placeholder="mastodon.social"
          className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 outline-none text-xs"
        />
        <button
          type="submit"
          disabled={!instance.trim() || register.isPending}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-xs px-3 py-1.5 rounded-md transition"
        >
          {register.isPending ? "…" : t("auth.oauth.mastodonConnect")}
        </button>
      </form>
      {register.isError && (
        <p className="mt-2 text-xs text-rose-400">
          {(register.error as ApiError).detail}
        </p>
      )}
    </div>
  );
}

// ---- Integrations: Discord, Zenodo ----

function IntegrationsSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [discord, setDiscord] = useState(me.profile.discord_webhook_url);
  const [zenodoToken, setZenodoToken] = useState("");
  const [zenodoSandbox, setZenodoSandbox] = useState(me.profile.zenodo_use_sandbox);
  const [autopostCheckin, setAutopostCheckin] = useState(
    me.profile.mastodon_autopost_checkin,
  );
  const hasZenodo = me.profile.has_zenodo_token;

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => auth.patchProfile(patch),
    onSuccess: () => {
      setZenodoToken("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <Card>
      <h3 className="font-medium mb-3">{t("settings.integrations.title")}</h3>
      <div className="space-y-4">
        {/* Discord */}
        <div>
          <Label>{t("settings.integrations.discordWebhook")}</Label>
          <input
            type="url"
            value={discord}
            onChange={(e) => setDiscord(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            {t("settings.integrations.discordHint")}
          </p>
        </div>

        {/* Zenodo */}
        <div className="border-t border-slate-800 pt-4">
          <Label>{t("settings.integrations.zenodoToken")}</Label>
          <input
            type="password"
            value={zenodoToken}
            onChange={(e) => setZenodoToken(e.target.value)}
            placeholder={
              hasZenodo
                ? t("settings.integrations.zenodoStored")
                : t("settings.integrations.zenodoPlaceholder")
            }
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm font-mono"
          />
          <label className="flex items-center gap-2 mt-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={zenodoSandbox}
              onChange={(e) => setZenodoSandbox(e.target.checked)}
            />
            <span>{t("settings.integrations.zenodoSandbox")}</span>
          </label>
          <p className="text-xs text-slate-500 mt-2">
            {t("settings.integrations.zenodoHint")}{" "}
            <a
              href="https://sandbox.zenodo.org/account/settings/applications/tokens/new/"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 hover:text-indigo-200"
            >
              sandbox.zenodo.org
            </a>
          </p>
        </div>

        <div>
          <h4 className="text-sm text-slate-300 font-medium mb-2">
            {t("settings.integrations.mastodonAutopost")}
          </h4>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={autopostCheckin}
              onChange={(e) => setAutopostCheckin(e.target.checked)}
              data-testid="autopost-checkin"
            />
            <span>{t("settings.integrations.autopostCheckin")}</span>
          </label>
          <p className="text-xs text-slate-500 mt-2">
            {t("settings.integrations.autopostCheckinHint")}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          const patch: ProfilePatch = {
            discord_webhook_url: discord,
            zenodo_use_sandbox: zenodoSandbox,
            mastodon_autopost_checkin: autopostCheckin,
          };
          if (zenodoToken) patch.zenodo_token = zenodoToken;
          save.mutate(patch);
        }}
        disabled={save.isPending}
        className="mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
      >
        {save.isPending ? "…" : t("settings.save")}
      </button>
      {save.isSuccess && (
        <span className="ml-3 text-xs text-emerald-400">✓ {t("settings.saved")}</span>
      )}

      {hasZenodo && (
        <button
          type="button"
          onClick={() => save.mutate({ zenodo_token: "" })}
          className="ml-3 text-xs text-rose-400 hover:text-rose-300"
        >
          {t("settings.integrations.zenodoClear")}
        </button>
      )}

      <div className="mt-6 pt-4 border-t border-slate-800">
        <DiscordPrefsSection hasWebhook={!!me.profile.discord_webhook_url} />
      </div>
    </Card>
  );
}

// ---- Storage ----

function StorageSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const used = me.profile.storage_used_bytes;
  const quota = me.profile.storage_quota_bytes;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <Card>
      <h3 className="font-medium mb-3">{t("profile.storage")}</h3>
      <div className="h-2 bg-slate-950 rounded-full overflow-hidden ring-1 ring-slate-800">
        <div
          className="h-full bg-indigo-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-slate-400 mt-2 font-mono">
        {(used / 1024 / 1024).toFixed(1)} MB / {(quota / 1024 / 1024 / 1024).toFixed(0)} GB
      </p>
    </Card>
  );
}

// ---- Primitives ----

function Card({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  const ring = tone === "warn" ? "ring-amber-900/50" : "ring-slate-800";
  return (
    <section className={`bg-slate-950/60 ring-1 ${ring} rounded-xl p-4`}>{children}</section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-slate-400 mb-1 block">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
