import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, auth, type Me } from "./lib/api";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { MapView } from "./components/MapView";

export function App() {
  const queryClient = useQueryClient();
  const me = useQuery<Me, ApiError>({
    queryKey: ["me"],
    queryFn: auth.me,
    retry: (failureCount, error) => error.status >= 500 && failureCount < 2,
  });

  const isAuthed = me.isSuccess && me.data.user;

  const logout = useMutation({
    mutationFn: auth.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  // Sync profile.language → i18n on login
  const { i18n } = useTranslation();
  useEffect(() => {
    if (me.isSuccess && me.data.profile.language && me.data.profile.language !== i18n.language) {
      void i18n.changeLanguage(me.data.profile.language);
    }
  }, [me.isSuccess, me.data?.profile.language, i18n]);

  if (isAuthed) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-6xl mx-auto bg-slate-900/60 ring-1 ring-slate-800 rounded-2xl p-4 sm:p-6 backdrop-blur">
          <Header isAuthed={true} />
          <AuthenticatedView me={me.data} onLogout={() => logout.mutate()} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-900/60 ring-1 ring-slate-800 rounded-2xl p-8 backdrop-blur">
        <Header isAuthed={false} />
        {me.isLoading ? (
          <Spinner />
        ) : (
          <UnauthenticatedView onAuthed={() => queryClient.invalidateQueries({ queryKey: ["me"] })} />
        )}
      </div>
    </main>
  );
}

function Header({ isAuthed }: { isAuthed: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-3xl" aria-hidden>
        ☆
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">{t("common.brand")}</h1>
      <span className="ml-auto text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300">
        {t("common.krok")} 3
      </span>
      <LanguageSwitcher isAuthed={isAuthed} />
    </div>
  );
}

function LanguageSwitcher({ isAuthed }: { isAuthed: boolean }) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (lang: LanguageCode) => auth.patchProfile({ language: lang }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const current = i18n.language.startsWith("cs") ? "cs" : "en";

  function setLang(lang: LanguageCode) {
    void i18n.changeLanguage(lang);
    if (isAuthed) {
      patch.mutate(lang);
    }
  }

  return (
    <div className="flex gap-1 ml-2" role="group" aria-label="language">
      {SUPPORTED_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={current === code}
          data-testid={`lang-${code}`}
          className={`text-xs px-2 py-1 rounded-md font-mono transition ${
            current === code
              ? "bg-indigo-600 text-white"
              : "bg-slate-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Spinner() {
  const { t } = useTranslation();
  return <p className="text-slate-400 text-sm">{t("common.loading")}</p>;
}

// ---- Unauthenticated: tabs for Login / Signup / Magic link ----

type Tab = "login" | "signup" | "magic";

function UnauthenticatedView({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("login");
  return (
    <div data-testid="unauth-root">
      <p className="text-slate-300 mb-4 text-sm">{t("auth.welcome")}</p>

      <a
        href="/api/v1/auth/github/start"
        data-testid="oauth-github-start"
        className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md py-2 text-sm font-medium ring-1 ring-slate-700 transition mb-4"
      >
        <GitHubIcon />
        <span>{t("auth.oauth.signInGitHub")}</span>
      </a>
      <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
        <div className="flex-1 h-px bg-slate-800" />
        <span>{t("auth.or")}</span>
        <div className="flex-1 h-px bg-slate-800" />
      </div>

      <div className="flex gap-1 mb-6 bg-slate-950 rounded-lg p-1 ring-1 ring-slate-800">
        <TabButton id="login" label={t("auth.tab.login")} active={tab === "login"} onClick={() => setTab("login")} />
        <TabButton id="signup" label={t("auth.tab.signup")} active={tab === "signup"} onClick={() => setTab("signup")} />
        <TabButton id="magic" label={t("auth.tab.magic")} active={tab === "magic"} onClick={() => setTab("magic")} />
      </div>
      {tab === "login" && <LoginForm onSuccess={onAuthed} />}
      {tab === "signup" && <SignupForm onSuccess={onAuthed} />}
      {tab === "magic" && <MagicLinkForm />}
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`tab-${id}`}
      className={`flex-1 px-3 py-1.5 rounded-md text-sm transition ${
        active
          ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => auth.login(email, password),
    onSuccess,
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <Field label={t("auth.label.email")} type="email" value={email} onChange={setEmail} required />
      <Field label={t("auth.label.password")} type="password" value={password} onChange={setPassword} required />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        {t("auth.button.login")}
      </Button>
    </form>
  );
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const mutation = useMutation({
    mutationFn: () => auth.signup(email, password, displayName),
    onSuccess,
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <Field
        label={t("auth.label.displayName")}
        type="text"
        value={displayName}
        onChange={setDisplayName}
      />
      <Field label={t("auth.label.email")} type="email" value={email} onChange={setEmail} required />
      <Field
        label={t("auth.label.passwordMin")}
        type="password"
        value={password}
        onChange={setPassword}
        required
        minLength={8}
      />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        {t("auth.button.signup")}
      </Button>
      <p className="text-xs text-slate-500">{t("auth.signup.mailhogHint", { url: "http://localhost:8025" })}</p>
    </form>
  );
}

function MagicLinkForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const mutation = useMutation({
    mutationFn: () => auth.magicLink(email),
    onSuccess: () => setSent(true),
  });
  if (sent) {
    return (
      <div className="space-y-2 text-sm text-slate-300">
        <p>{t("auth.magicLink.sent")}</p>
        <p className="text-xs text-slate-500">{t("auth.magicLink.devHint", { url: "http://localhost:8025" })}</p>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-xs text-slate-400">{t("auth.magicLink.intro")}</p>
      <Field label={t("auth.label.email")} type="email" value={email} onChange={setEmail} required />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        {t("auth.button.magic")}
      </Button>
    </form>
  );
}

// ---- Authenticated view ----

function AuthenticatedView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <MapView />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <p className="text-xs text-slate-400">{t("auth.loggedInAs")}</p>
          <p className="font-medium">{me.user.display_name}</p>
          <p className="text-xs text-slate-500">{me.user.email}</p>
          <p className="text-xs text-slate-500 mt-1">
            {t("auth.label.email")} {me.user.email_verified ? t("auth.emailVerified") : t("auth.emailUnverified")}
          </p>
          <div className="mt-3">
            <ProfilePreview profile={me.profile} />
          </div>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onLogout}
            data-testid="logout-button"
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md py-2 text-sm font-medium ring-1 ring-slate-700 transition"
          >
            {t("auth.button.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePreview({ profile }: { profile: Me["profile"] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-3 text-xs">
      <Stat label={t("profile.language")} value={profile.language.toUpperCase()} />
      <Stat label={t("profile.timezone")} value={profile.timezone_name} />
      <Stat label={t("profile.locationVisibility")} value={profile.location_visibility} />
      <Stat
        label={t("profile.storage")}
        value={`${(profile.storage_used_bytes / 1024 / 1024).toFixed(1)} / ${(profile.storage_quota_bytes / 1024 / 1024 / 1024).toFixed(0)} GB`}
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-3">
      <dt className="text-xs uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className="mt-1 font-mono text-slate-200">{value}</dd>
    </div>
  );
}

// ---- Primitives ----

function Field({
  label,
  type,
  value,
  onChange,
  required,
  minLength,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
      />
    </label>
  );
}

function Button({
  type,
  children,
  loading,
}: {
  type: "submit" | "button";
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={loading}
      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-md py-2 text-sm font-medium transition"
    >
      {loading ? "…" : children}
    </button>
  );
}

function FormError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
      {error.detail}
    </p>
  );
}
