import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, auth, type Me } from "./lib/api";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { MapView } from "./components/MapView";
import { SettingsPage } from "./components/SettingsPage";
import { ArticlesPage } from "./components/ArticlesPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { EventsPage } from "./components/EventsPage";
import { CitizenSciencePage } from "./components/CitizenSciencePage";
import { AdminPage } from "./components/AdminPage";
import { NotificationsBell } from "./components/NotificationsBell";

type Page =
  | "map"
  | "settings"
  | "articles"
  | "projects"
  | "events"
  | "campaigns"
  | "admin";

// Pages anonymous (not-logged-in) visitors are allowed to see. Everything
// else needs auth and triggers the login modal when clicked.
const ANON_ALLOWED: ReadonlyArray<Page> = ["map", "articles", "events", "campaigns"];

// Each section gets its own URL path. Reloading preserves the section,
// browser Back/Forward navigates between them, links can be shared.
// "campaigns" maps to /citizen-science because the user-facing name is
// Citizen Science (the internal Page key kept its legacy "campaigns"
// value to avoid touching all callers; only the URL differs).
const PAGE_PATHS: Record<Page, string> = {
  map: "/",
  campaigns: "/citizen-science",
  articles: "/articles",
  events: "/events",
  projects: "/projects",
  settings: "/settings",
  admin: "/admin",
};

const PATH_TO_PAGE = new Map<string, Page>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as Page]),
);

function pageFromLocation(): Page | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const fromPath = PATH_TO_PAGE.get(path);
  if (fromPath) return fromPath;
  // OAuth callback lands on /?from=<page>&oauth_ok=1 before the JS
  // patches the URL. Honour the ``from`` hint at boot so we don't
  // briefly render the Map before redirecting to the originating section.
  const fromParam = new URLSearchParams(window.location.search).get("from");
  if (fromParam && fromParam in PAGE_PATHS) return fromParam as Page;
  return null;
}

/**
 * Hook backing the section navigation. Reads the initial page from the
 * URL pathname, listens for browser Back/Forward via ``popstate``, and
 * exposes a setter that ``pushState``s a new URL so refresh / share
 * links stay on the current section.
 *
 * The setter accepts an optional ``replace`` flag — used for OAuth
 * callbacks that strip query params without polluting history.
 */
function usePageRoute(defaultPage: Page): [Page, (next: Page, opts?: { replace?: boolean }) => void] {
  const [page, setPageState] = useState<Page>(() => pageFromLocation() ?? defaultPage);

  useEffect(() => {
    const onPop = () => {
      const next = pageFromLocation();
      if (next) setPageState(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setPage = useCallback(
    (next: Page, opts?: { replace?: boolean }) => {
      setPageState(next);
      const path = PAGE_PATHS[next];
      // Preserve any hash (e.g. anchor scrolling); strip search params
      // unless the caller is doing a replace (OAuth flow keeps params
      // until it processes them).
      const url = path + window.location.hash;
      if (opts?.replace) {
        window.history.replaceState(null, "", url);
      } else if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, "", url);
      }
    },
    [],
  );

  return [page, setPage];
}

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

  // While we don't know auth state yet, show a quick splash. After that
  // we either render the authed app (full nav) or the anon app (limited
  // nav with Login CTA). The login form moves into a modal so visitors
  // can keep reading and switch contexts.
  if (me.isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <Spinner />
      </main>
    );
  }

  if (isAuthed) {
    return <AuthedApp me={me.data} onLogout={() => logout.mutate()} />;
  }

  return (
    <AnonApp
      onAuthed={() => queryClient.invalidateQueries({ queryKey: ["me"] })}
    />
  );
}

function AuthedApp({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t } = useTranslation();

  // URL-driven section routing. Initial page comes from window.location;
  // setPage also pushes a new URL so refresh / share links work. Legacy
  // OAuth callbacks still arrive as ``/?from=settings&oauth_ok=1`` — we
  // catch that in the effect below and redirect to the proper path.
  const [page, setPage] = usePageRoute("map");
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
    const from = params.get("from");
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
      // OAuth callback lands on `/?...` with `from=<page>` telling us
      // which section initiated the flow. Route the user there and
      // strip the query params from the URL in one history step so
      // back-button doesn't replay the OAuth landing.
      const target = (from && PAGE_PATHS[from as Page] ? (from as Page) : page);
      setPage(target, { replace: true });
      const t = setTimeout(() => setFlash(null), 5000);
      return () => clearTimeout(t);
    }
  }, [page, setPage]);

  return (
    <main className="h-screen flex flex-col p-2 sm:p-3 overflow-hidden">
      {/*
        Inner-scroll layout: <main> takes full viewport height and never
        scrolls. The wrapper is a flex column whose header is static
        (always pinned visually because it's outside the scrolling area)
        and content area below either scrolls itself (Articles, Settings)
        or fills without scroll (Map).

        NOTE: no `backdrop-blur` on this wrapper — it creates a CSS
        containing block (backdrop-filter triggers it just like transform)
        which makes `position: fixed` modals inside this tree positioned
        relative to this div instead of the viewport.
      */}
      <div className="w-full flex flex-col flex-1 min-h-0 bg-slate-900/60 ring-1 ring-slate-800 rounded-xl p-3 sm:p-4">
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
        {/*
          Header row — lives in normal flow at the top of the flex
          column. It never moves because the scrolling happens inside
          the content area below, not on the body. `shrink-0` keeps
          its height predictable so the scrollable area gets the rest.
        */}
        <div className="shrink-0 mb-4">
          <div className="flex items-center gap-3">
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
              id="projects"
              active={page === "projects"}
              label={t("nav.projects")}
              onClick={() => setPage("projects")}
            />
            <NavTab
              id="settings"
              active={page === "settings"}
              label={t("nav.settings")}
              onClick={() => setPage("settings")}
            />
            {me.user.is_staff && (
              <NavTab
                id="admin"
                active={page === "admin"}
                label={t("nav.admin")}
                onClick={() => setPage("admin")}
              />
            )}
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
        </div>

        {/*
          Content area. Map gets `overflow-hidden` so its full-bleed
          MapLibre canvas never produces a body scrollbar. All other
          agendas scroll inside this box, leaving the header fixed at
          the top of the card. `min-h-0` is the standard flex-child
          trick that lets the child shrink below its content size.
        */}
        {page === "map" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <AuthenticatedMapView me={me} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-3 -mb-3 px-3 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            {page === "articles" && <ArticlesPage me={me} />}
            {page === "projects" && <ProjectsPage me={me} />}
            {page === "events" && <EventsPage me={me} />}
            {page === "campaigns" && <CitizenSciencePage me={me} />}
            {page === "settings" && <SettingsPage me={me} />}
            {page === "admin" && <AdminPage me={me} />}
          </div>
        )}
      </div>
    </main>
  );
}

function NavTab({
  id,
  active,
  label,
  onClick,
  beta = false,
}: {
  id: string;
  active: boolean;
  label: string;
  onClick: () => void;
  beta?: boolean;
}) {
  // Beta tabs are visually de-emphasized while we shift focus to
  // Citizen Science. They stay fully functional — see roadmap.md
  // "Navigation positioning — DECIDED 2026-05-19".
  const sizeClass = beta ? "text-xs px-2 py-1" : "text-sm px-3 py-1.5";
  const inactiveClass = beta
    ? "text-slate-500 hover:text-slate-300"
    : "text-slate-400 hover:text-slate-200";
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`nav-${id}`}
      className={`${sizeClass} rounded-md transition inline-flex items-center gap-1 ${
        active
          ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
          : inactiveClass
      }`}
    >
      <span>{label}</span>
      {beta && (
        <span className="text-[9px] uppercase tracking-wide text-slate-500 bg-slate-900/80 ring-1 ring-slate-800 rounded px-1 py-px">
          beta
        </span>
      )}
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

// ---- Anonymous app shell: limited nav + login CTA ----
//
// Renders the same outer layout as AuthedApp so the visual transition
// when the user logs in is just a top-bar swap. Nav is reduced to
// {Map, Articles, Events} — the three surfaces we currently expose to
// visitors. Anything that needs auth pops the LoginModal.
function AnonApp({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = usePageRoute("map");
  const [loginOpen, setLoginOpen] = useState(false);
  const [flash, setFlash] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Anon visitors land on Map by default. If they arrived on a path
  // that anon isn't allowed to view (e.g. /settings), redirect home.
  // Also surface oauth_error / verified flashes from the OAuth
  // callback, then strip the query params from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!ANON_ALLOWED.includes(page)) {
      setPage("map", { replace: true });
    }
    const params = new URLSearchParams(window.location.search);
    const err = params.get("oauth_error");
    const verified = params.get("verified");
    const from = params.get("from") as Page | null;
    if (err) {
      setFlash({
        type: "error",
        text: t("auth.oauth.errorFlash", { error: err }),
      });
    } else if (verified) {
      setFlash({ type: "ok", text: t("auth.emailVerifiedFlash") });
    }
    if (err || verified) {
      const target = from && ANON_ALLOWED.includes(from) ? from : page;
      setPage(target, { replace: true });
      const tid = setTimeout(() => setFlash(null), 6000);
      return () => clearTimeout(tid);
    }
  }, [t, page, setPage]);

  // Helper passed to pages so any auth-gated action can pop the modal.
  const requireLogin = () => setLoginOpen(true);

  return (
    <main className="h-screen flex flex-col p-2 sm:p-3 overflow-hidden">
      <div className="w-full flex flex-col flex-1 min-h-0 bg-slate-900/60 ring-1 ring-slate-800 rounded-xl p-3 sm:p-4">
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
        <div className="shrink-0 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>☆</span>
            <h1 className="text-2xl font-semibold tracking-tight">{t("common.brand")}</h1>
            <nav className="flex items-center gap-1 ml-2 flex-wrap">
              <NavTab id="map" active={page === "map"} label={t("nav.map")} onClick={() => setPage("map")} />
              <NavTab id="articles" active={page === "articles"} label={t("nav.articles")} onClick={() => setPage("articles")} />
              <NavTab id="events" active={page === "events"} label={t("nav.events")} onClick={() => setPage("events")} />
              <NavTab id="campaigns" active={page === "campaigns"} label={t("nav.campaigns")} onClick={() => setPage("campaigns")} />
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher isAuthed={false} />
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                data-testid="anon-login-cta"
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md transition font-medium"
              >
                {t("auth.tab.login")} / {t("auth.tab.signup")}
              </button>
            </div>
          </div>
        </div>

        {page === "map" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <MapView me={null} onRequireLogin={requireLogin} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-3 -mb-3 px-3 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            {page === "campaigns" && <CitizenSciencePage me={null} />}
            {page === "articles" && <ArticlesPage me={null} onRequireLogin={requireLogin} />}
            {page === "events" && <EventsPage me={null} onRequireLogin={requireLogin} />}
          </div>
        )}
      </div>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onAuthed={() => {
            setLoginOpen(false);
            onAuthed();
          }}
        />
      )}
    </main>
  );
}

// Modal wrapper around the existing tabs-based auth form. Triggered
// from the anon top bar or any auth-gated action.
function LoginModal({ onClose, onAuthed }: { onClose: () => void; onAuthed: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="login-modal"
    >
      <div
        className="w-full max-w-md bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-100">{t("auth.welcome")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>
        <div className="p-4">
          <UnauthenticatedView onAuthed={onAuthed} />
        </div>
      </div>
    </div>
  );
}

// ---- Unauthenticated: tabs for Login / Signup / Magic link ----

type Tab = "login" | "signup" | "magic";

function UnauthenticatedView({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("login");
  // Fetch OAuth provider configuration status. Disabled providers
  // render greyed-out with a tooltip explaining the admin needs to
  // set the corresponding env vars — clicking does nothing.
  const providers = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: auth.oauthProviders,
    staleTime: 5 * 60_000,
  });
  const configured = providers.data;

  return (
    <div data-testid="unauth-root">
      <p className="text-slate-300 mb-4 text-sm">{t("auth.welcome")}</p>

      {/* OAuth providers — uniform dark style with brand-colored
          icons. The backend reports which providers are configured at
          /api/v1/auth/providers; ones without env vars render grey + a
          tooltip so users understand why they don't work. */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <OAuthButton
          provider="github"
          configured={configured?.github ?? true}
          icon={<GitHubIcon />}
          label={t("auth.oauth.signInGitHub")}
          notConfiguredLabel={t("auth.oauth.notConfigured", { provider: "GitHub" })}
        />
        <OAuthButton
          provider="google"
          configured={configured?.google ?? true}
          icon={<GoogleIcon />}
          label={t("auth.oauth.signInGoogle")}
          notConfiguredLabel={t("auth.oauth.notConfigured", { provider: "Google" })}
        />
        <OAuthButton
          provider="gitlab"
          configured={configured?.gitlab ?? false}
          icon={<GitLabIcon />}
          label={t("auth.oauth.signInGitLab")}
          notConfiguredLabel={t("auth.oauth.notConfigured", { provider: "GitLab" })}
        />
        <OAuthButton
          provider="facebook"
          configured={configured?.facebook ?? false}
          icon={<FacebookIcon />}
          label={t("auth.oauth.signInFacebook")}
          notConfiguredLabel={t("auth.oauth.notConfigured", { provider: "Facebook" })}
        />
      </div>
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

function OAuthButton({
  provider,
  configured,
  icon,
  label,
  notConfiguredLabel,
}: {
  provider: string;
  configured: boolean;
  icon: React.ReactNode;
  label: string;
  notConfiguredLabel: string;
}) {
  const base =
    "flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium ring-1 transition";
  if (configured) {
    return (
      <a
        href={`/api/v1/auth/${provider}/start`}
        data-testid={`oauth-${provider}-start`}
        className={`${base} bg-slate-800 hover:bg-slate-700 text-slate-100 ring-slate-700`}
      >
        {icon}
        <span>{label}</span>
      </a>
    );
  }
  // Not configured — render as a disabled button so clicks do nothing
  // and a tooltip explains why. Saves users from the silent redirect
  // back to /?oauth_error=not_configured that produced no feedback.
  return (
    <button
      type="button"
      disabled
      data-testid={`oauth-${provider}-disabled`}
      title={notConfiguredLabel}
      className={`${base} bg-slate-900/60 text-slate-500 ring-slate-800 cursor-not-allowed opacity-60`}
    >
      <span className="grayscale opacity-50">{icon}</span>
      <span>{label}</span>
    </button>
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

function GoogleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 48 48"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.991 21.991 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7C13.42 14.62 18.27 10.75 24 10.75z"/>
    </svg>
  );
}

function GitLabIcon() {
  // Official GitLab Tanuki — minimal 4-shape composition from the
  // upstream branding kit (https://about.gitlab.com/press/press-kit/).
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 380 380"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#E24329" d="M282.83 170.73 282.59 170.1 258.38 106.93C257.89 105.69 257.02 104.64 255.9 103.93 255.06 103.39 254.1 103.07 253.11 102.99 252.11 102.91 251.11 103.07 250.19 103.45 249.27 103.83 248.46 104.43 247.81 105.21 247.16 105.99 246.71 106.91 246.49 107.91L230.13 157.96 149.91 157.96 133.55 107.91C133.34 106.91 132.89 105.99 132.24 105.21 131.59 104.43 130.78 103.83 129.86 103.45 128.94 103.07 127.94 102.91 126.94 102.99 125.95 103.07 124.99 103.39 124.15 103.93 123.04 104.65 122.17 105.69 121.68 106.93L97.41 170.07 97.16 170.7C93.7 179.97 93.07 190.13 95.36 199.78 97.65 209.43 102.74 218.1 110.06 224.6L110.13 224.66 110.32 224.83 147.04 252.6 165.18 266.31 176.13 274.66C178.69 276.6 181.79 277.62 184.97 277.55 188.15 277.49 191.22 276.34 193.69 274.31L201.13 268.59 219.31 254.83 256.31 226.81 256.4 226.74 256.41 226.71C263.71 220.21 268.79 211.56 271.08 201.93 273.37 192.31 272.76 182.17 269.31 172.91"/>
      <path fill="#FC6D26" d="M282.83 170.73 282.59 170.1C271 172.45 260.07 177.34 250.59 184.43L190.11 230.18C210.7 245.74 228.62 259.27 228.62 259.27L256.31 226.81 256.4 226.74 256.41 226.71C263.71 220.21 268.79 211.56 271.08 201.93 273.37 192.31 272.76 182.17 269.31 172.91"/>
      <path fill="#FCA326" d="M147.04 252.6 165.18 266.31 176.13 274.66C178.69 276.6 181.79 277.62 184.97 277.55 188.15 277.49 191.22 276.34 193.69 274.31L201.13 268.59 219.31 254.83C219.31 254.83 200.7 241.31 190.11 230.18 179.51 241.31 147.04 252.6 147.04 252.6Z"/>
      <path fill="#E24329" d="M129.91 184.43C120.42 177.35 109.49 172.47 97.91 170.1L97.16 170.7C93.7 179.97 93.07 190.13 95.36 199.78 97.65 209.43 102.74 218.1 110.06 224.6L110.13 224.66 110.32 224.83 147.04 252.6 190.11 230.18Z"/>
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.97h-1.514c-1.49 0-1.955.928-1.955 1.879v2.255h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
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
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex-1 min-h-0">
        <MapView me={me} />
      </div>
      <div className="shrink-0 text-xs text-slate-500 flex items-center gap-3">
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
