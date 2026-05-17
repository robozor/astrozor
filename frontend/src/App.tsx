import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, auth, type Me } from "./lib/api";

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

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-900/60 ring-1 ring-slate-800 rounded-2xl p-8 backdrop-blur">
        <Header />
        {me.isLoading ? (
          <Spinner />
        ) : isAuthed ? (
          <AuthenticatedView me={me.data} onLogout={() => logout.mutate()} />
        ) : (
          <UnauthenticatedView onAuthed={() => queryClient.invalidateQueries({ queryKey: ["me"] })} />
        )}
      </div>
    </main>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-3xl" aria-hidden>
        ☆
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Astrozor</h1>
      <span className="ml-auto text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300">
        Krok 1
      </span>
    </div>
  );
}

function Spinner() {
  return <p className="text-slate-400 text-sm">Načítám…</p>;
}

// ---- Unauthenticated: tabs for Login / Signup / Magic link ----

type Tab = "login" | "signup" | "magic";

function UnauthenticatedView({ onAuthed }: { onAuthed: () => void }) {
  const [tab, setTab] = useState<Tab>("login");
  return (
    <div>
      <p className="text-slate-300 mb-4 text-sm">
        Vítej v Astrozoru. Pro pokračování se přihlas nebo zaregistruj.
      </p>
      <div className="flex gap-1 mb-6 bg-slate-950 rounded-lg p-1 ring-1 ring-slate-800">
        <TabButton label="Přihlášení" active={tab === "login"} onClick={() => setTab("login")} />
        <TabButton label="Registrace" active={tab === "signup"} onClick={() => setTab("signup")} />
        <TabButton
          label="Magic link"
          active={tab === "magic"}
          onClick={() => setTab("magic")}
        />
      </div>
      {tab === "login" && <LoginForm onSuccess={onAuthed} />}
      {tab === "signup" && <SignupForm onSuccess={onAuthed} />}
      {tab === "magic" && <MagicLinkForm />}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      <Field label="E-mail" type="email" value={email} onChange={setEmail} required />
      <Field label="Heslo" type="password" value={password} onChange={setPassword} required />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        Přihlásit se
      </Button>
    </form>
  );
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
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
        label="Přezdívka (volitelně)"
        type="text"
        value={displayName}
        onChange={setDisplayName}
      />
      <Field label="E-mail" type="email" value={email} onChange={setEmail} required />
      <Field
        label="Heslo (min. 8 znaků)"
        type="password"
        value={password}
        onChange={setPassword}
        required
        minLength={8}
      />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        Vytvořit účet
      </Button>
      <p className="text-xs text-slate-500">
        Ověřovací e-mail dorazí v MailHogu na <code>http://localhost:8025</code>.
      </p>
    </form>
  );
}

function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const mutation = useMutation({
    mutationFn: () => auth.magicLink(email),
    onSuccess: () => setSent(true),
  });
  if (sent) {
    return (
      <div className="space-y-2 text-sm text-slate-300">
        <p>✓ Pokud je e-mail v naší databázi, odkaz byl odeslán.</p>
        <p className="text-xs text-slate-500">
          V dev prostředí otevři <code>http://localhost:8025</code> (MailHog) a klikni na odkaz.
        </p>
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
      <p className="text-xs text-slate-400">
        Pošleme ti odkaz, na který stačí kliknout a budeš přihlášen(a). Bez hesla.
      </p>
      <Field label="E-mail" type="email" value={email} onChange={setEmail} required />
      <FormError error={mutation.error as ApiError | null} />
      <Button type="submit" loading={mutation.isPending}>
        Poslat magic link
      </Button>
    </form>
  );
}

// ---- Authenticated view ----

function AuthenticatedView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-400">Přihlášen(a) jako</p>
        <p className="font-medium">{me.user.display_name}</p>
        <p className="text-xs text-slate-500">{me.user.email}</p>
        <p className="text-xs text-slate-500 mt-1">
          E-mail {me.user.email_verified ? "✓ ověřen" : "⚠ neověřen — zkontroluj inbox"}
        </p>
      </div>
      <ProfilePreview profile={me.profile} />
      <button
        type="button"
        onClick={onLogout}
        className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md py-2 text-sm font-medium ring-1 ring-slate-700 transition"
      >
        Odhlásit se
      </button>
    </div>
  );
}

function ProfilePreview({ profile }: { profile: Me["profile"] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-xs">
      <Stat label="Jazyk UI" value={profile.language.toUpperCase()} />
      <Stat label="Timezone" value={profile.timezone_name} />
      <Stat label="Viditelnost polohy" value={profile.location_visibility} />
      <Stat
        label="Storage"
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
