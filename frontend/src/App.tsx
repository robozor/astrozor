import { useQuery } from "@tanstack/react-query";

type Health = {
  status: string;
  version: string;
  database: string;
};

async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/v1/healthz");
  if (!response.ok) {
    throw new Error(`API responded ${response.status}`);
  }
  return response.json() as Promise<Health>;
}

async function fetchReady(): Promise<Health> {
  const response = await fetch("/api/v1/readyz");
  if (!response.ok) {
    throw new Error(`API responded ${response.status}`);
  }
  return response.json() as Promise<Health>;
}

export function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const ready = useQuery({ queryKey: ["ready"], queryFn: fetchReady });

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-900/60 ring-1 ring-slate-800 rounded-2xl p-8 backdrop-blur">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl" aria-hidden>☆</span>
          <h1 className="text-2xl font-semibold tracking-tight">Astrozor</h1>
          <span className="ml-auto text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300">
            Krok 0
          </span>
        </div>

        <p className="text-slate-300 mb-6">
          Kolaborativní platforma pro aktivní astronomy — setkávání online,
          koordinace pozorování, publikační server. Tato obrazovka ověřuje,
          že Docker stack běží.
        </p>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Card label="Frontend" value="✓ running" tone="ok" />
          <Card
            label="API"
            value={
              health.isLoading
                ? "…"
                : health.isError
                  ? "✗ unreachable"
                  : `✓ ${health.data?.version ?? "?"}`
            }
            tone={health.isError ? "err" : health.isLoading ? "warn" : "ok"}
          />
          <Card
            label="Database"
            value={
              ready.isLoading
                ? "…"
                : ready.isError
                  ? "✗ unreachable"
                  : ready.data?.database === "ok"
                    ? "✓ connected"
                    : "✗ degraded"
            }
            tone={
              ready.isLoading
                ? "warn"
                : ready.isError || ready.data?.database !== "ok"
                  ? "err"
                  : "ok"
            }
          />
        </dl>

        <p className="text-xs text-slate-500 mt-6">
          Next: Krok 1 — Authentication & profile. Sledování stavu projektu v{" "}
          <code className="text-slate-400">PROGRESS.md</code>.
        </p>
      </div>
    </main>
  );
}

type Tone = "ok" | "warn" | "err";

function Card({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const toneClass: Record<Tone, string> = {
    ok: "text-emerald-400",
    warn: "text-amber-400",
    err: "text-rose-400",
  };
  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-3">
      <dt className="text-xs uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className={`mt-1 font-mono ${toneClass[tone]}`}>{value}</dd>
    </div>
  );
}
