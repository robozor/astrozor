import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, auth, type Me } from "./lib/api";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { MapView } from "./components/MapView";
import { SettingsPage } from "./components/SettingsPage";
import { ArticlesPage } from "./components/ArticlesPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { EventsPage } from "./components/EventsPage";
import { CampaignsPage } from "./components/CampaignsPage";
import { NotificationsBell } from "./components/NotificationsBell";

type Page = "map" | "settings" | "articles" | "projects" | "events" | "campaigns";

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
    return <AuthedApp me={me.data} onLogout={() => logout.mutate()} />;
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

function AuthedApp({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t } = useTranslation();

  // Initial page from URL — supports OAuth redirect ?from=settings and clean URLs
  const initialPage: Page = (() => {
    if (typeof window === "undefined") return "map";
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get("from");
    if (
      fromParam === "settings" ||
      fromParam === "articles" ||
      fromParam === "projects" ||
      fromParam === "events" ||
      fromParam === "campaigns"
    )
      return fromParam;
    return "map";
  })();
  const [page, setPage] = useState<Page>(initialPage);
  const [flash, setFlash] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  // Show a flash after OAuth redirect, then clean the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("oauth_ok");
    const err = params.get("oauth_error");
    const provider = params.get("provider");
    const verified = params.get("verified");
    if (ok) {
      setFlash({
        type: "ok",
        text: provider ? `${provider} připojeno.` : "Přihlášení úspěšné.",
      });
    } else if (err) {
      setFlash({ type: "error", text: `OAuth chyba: ${err}` });
    } else if (verified) {
      setFlash({ type: "ok", text: "E-mail ověřen." });
    }
    if (ok || err || verified) {
      // Clean URL but keep ?from preserved? No — strip everything.
      window.history.replaceState({}, "", window.location.pathname);
      const t = setTimeout(() => setFlash(null), 5000);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <main className="min-h-screen p-2 sm:p-3">
      <div className="w-full bg-slate-900/60 ring-1 ring-slate-800 rounded-xl p-3 sm:p-4 backdrop-blur">
        {flash && (
          <div
            data-testid="flash"
            className={`mb-3 text-sm px-3 py-2 rounded-md ring-1 ${
              flash.type === "ok"
                ? "bg-emerald-950/40 ring-emerald-900/50 text-emerald-200"
                : "bg-rose-950/40 ring-rose-900/50 text-rose-200"
            }`}
          >
            {flash.text}
          </div>
        )}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl" aria-hidden>
            ☆
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("common.brand")}</h1>
          <nav className="flex items-center gap-1 ml-2 flex-wrap">
            <NavTab id="map" active={page === "map"} label={t("nav.map")} onClick={() => setPage("map")} />
            <NavTab
              id="articles"
              active={page === "articles"}
              label={t("nav.articles")}
              onClick={() => setPage("articles")}
            />
            <NavTab
              id="projects"
              active={page === "projects"}
              label={t("nav.projects")}
              onClick={() => setPage("projects")}
            />
            <NavTab
              id="events"
              active={page === "events"}
              label={t("nav.events")}
              onClick={() => setPage("events")}
            />
            <NavTab
              id="campaigns"
              active={page === "campaigns"}
              label={t("nav.campaigns")}
              onClick={() => setPage("campaigns")}
            />
            <NavTab
              id="settings"
              active={page === "settings"}
              label={t("nav.settings")}
              onClick={() => setPage("settings")}
            />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NotificationsBell />
            <span className="text-xs text-slate-400 hidden sm:inline">{me.user.display_name}</span>
            <LanguageSwitcher isAuthed={true} />
            <button
              type="button"
              onClick={onLogout}
              data-testid="logout-button"
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 px-3 py-1.5 rounded-md ring-1 ring-slate-700 transition"
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>

        {page === "map" && <AuthenticatedMapView me={me} />}
        {page === "articles" && <ArticlesPage me={me} />}
        {page === "projects" && <ProjectsPage me={me} />}
        {page === "events" && <EventsPage me={me} />}
        {page === "campaigns" && <CampaignsPage me={me} />}
        {page === "settings" && <SettingsPage me={me} />}
      </div>
    </main>
  );
}

function NavTab({
  id,
  active,
  label,
  onClick,
}: {
  id: string;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`nav-${id}`}
      className={`text-sm px-3 py-1.5 rounded-md transition ${
        active
          ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
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

// ---- Map page (authed) ----

function AuthenticatedMapView({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <MapView me={me} />
      <div className="text-xs text-slate-500 flex items-center gap-3">
        <span>
          {t("auth.label.email")}{" "}
          {me.user.email_verified ? (
            <span className="text-emerald-400">{t("auth.emailVerified")}</span>
          ) : (
            <span className="text-amber-400">{t("auth.emailUnverified")}</span>
          )}
        </span>
        <span>·</span>
        <span>{me.profile.location_visibility}</span>
        <span>·</span>
        <span>{me.profile.language.toUpperCase()}</span>
      </div>
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
