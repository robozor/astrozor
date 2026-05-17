import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { admin, type Me, type MapInfraOut } from "../lib/api";

export function AdminPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  if (!me.user.is_staff) {
    return (
      <section className="bg-rose-950/40 ring-1 ring-rose-900/50 rounded-xl p-6">
        <p className="text-rose-200 text-sm">{t("admin.notStaff")}</p>
      </section>
    );
  }

  return (
    <section data-testid="admin-page" className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">{t("admin.title")}</h2>
        <p className="text-sm text-slate-400 mt-1">{t("admin.subtitle")}</p>
      </header>
      <MapInfraPanel />
    </section>
  );
}

function MapInfraPanel() {
  const { t } = useTranslation();
  // Poll every 1.5 s while any job is running so progress streams in.
  // Browser tab in background still gets updates (refetchIntervalInBackground)
  // so users who alt-tab away during a multi-GB download don't see stale
  // numbers on their return.
  const infra = useQuery({
    queryKey: ["admin", "map-infra"],
    queryFn: () => admin.getMapInfra(),
    refetchInterval: (q) => {
      const d = q.state.data as MapInfraOut | undefined;
      const running =
        d?.pmtiles.status === "running" || d?.photon.status === "running";
      return running ? 1500 : false;
    },
    refetchIntervalInBackground: true,
  });

  if (infra.isLoading) {
    return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  }
  if (!infra.data) return null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <PmtilesCard data={infra.data} />
      <PhotonCard data={infra.data} />
    </div>
  );
}

function PmtilesCard({ data }: { data: MapInfraOut }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sourceUrl, setSourceUrl] = useState(data.pmtiles.source_url);

  const download = useMutation({
    mutationFn: () => admin.triggerPmtilesDownload(sourceUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "map-infra"] }),
  });
  const useThis = useMutation({
    mutationFn: () => admin.switchBackends({ tile_backend: "pmtiles" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });
  const useOsm = useMutation({
    mutationFn: () => admin.switchBackends({ tile_backend: "osm" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });

  const active = data.tile_backend === "pmtiles";
  const sizeMib = (data.pmtiles.size_bytes / 1024 / 1024).toFixed(1);
  const downloading = data.pmtiles.status === "running";
  const hasError = data.pmtiles.status === "error";

  return (
    <article
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid="admin-pmtiles"
    >
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-slate-100">{t("admin.pmtiles.title")}</h3>
        <ActiveBadge active={active} />
      </header>

      <dl className="text-xs grid grid-cols-2 gap-y-1 text-slate-400">
        <dt>{t("admin.pmtiles.size")}</dt>
        <dd className="text-slate-200 font-mono">
          {data.pmtiles.size_bytes > 0 ? `${sizeMib} MiB` : t("admin.notReady")}
        </dd>
        <dt>{t("admin.pmtiles.lastUpdate")}</dt>
        <dd className="text-slate-200 font-mono">
          {data.pmtiles.last_update
            ? new Date(data.pmtiles.last_update).toLocaleString()
            : "—"}
        </dd>
        <dt>{t("admin.status")}</dt>
        <dd className={statusClass(data.pmtiles.status)}>{data.pmtiles.status}</dd>
      </dl>

      {downloading && data.pmtiles.live_progress ? (
        <LiveProgress
          bytesWritten={data.pmtiles.live_progress.bytes_written}
          totalBytes={data.pmtiles.live_progress.total_bytes}
        />
      ) : (
        (downloading || hasError) &&
        data.pmtiles.status_message && (
          <p
            className={`text-xs ${
              hasError ? "text-rose-300" : "text-slate-300"
            } font-mono break-words`}
          >
            {data.pmtiles.status_message}
          </p>
        )
      )}

      <label className="block">
        <span className="text-xs text-slate-400 mb-1 block">
          {t("admin.pmtiles.sourceUrl")}
        </span>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 outline-none"
          placeholder="https://build.protomaps.com/YYYYMMDD.pmtiles"
        />
      </label>

      {data.pmtiles.latest && (
        <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <p className="text-slate-300">
              {t("admin.pmtiles.latestAvailable")}{" "}
              <span className="font-mono text-slate-100">{data.pmtiles.latest.key}</span>
            </p>
            <p className="text-slate-500 text-[11px]">
              {(data.pmtiles.latest.size_bytes / 1024 ** 3).toFixed(1)} GB ·{" "}
              {data.pmtiles.latest.uploaded
                ? new Date(data.pmtiles.latest.uploaded).toLocaleDateString()
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSourceUrl(data.pmtiles.latest!.url)}
            className="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-100 px-2 py-1 rounded-md ring-1 ring-slate-700 text-[11px]"
          >
            {t("admin.pmtiles.useLatest")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => download.mutate()}
          disabled={downloading || download.isPending}
          data-testid="pmtiles-download"
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white px-3 py-1.5 rounded-md transition"
        >
          {downloading
            ? t("admin.pmtiles.downloading")
            : data.pmtiles.size_bytes > 0
              ? t("admin.pmtiles.refresh")
              : t("admin.pmtiles.download")}
        </button>
        {data.pmtiles.available && !active && (
          <button
            type="button"
            onClick={() => useThis.mutate()}
            disabled={useThis.isPending}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-emerald-100 px-3 py-1.5 rounded-md transition"
          >
            {t("admin.useThis")}
          </button>
        )}
        {active && (
          <button
            type="button"
            onClick={() => useOsm.mutate()}
            disabled={useOsm.isPending}
            className="text-xs bg-slate-800 hover:bg-slate-700 ring-1 ring-slate-700 text-slate-200 px-3 py-1.5 rounded-md transition"
          >
            {t("admin.pmtiles.backToOsm")}
          </button>
        )}
      </div>
    </article>
  );
}

function PhotonCard({ data }: { data: MapInfraOut }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const probe = useMutation({
    mutationFn: () => admin.probePhoton(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "map-infra"] }),
  });
  const useThis = useMutation({
    mutationFn: () => admin.switchBackends({ search_backend: "photon" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });
  const useNominatim = useMutation({
    mutationFn: () => admin.switchBackends({ search_backend: "nominatim" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });

  const active = data.search_backend === "photon";
  const probing = data.photon.status === "running";
  const hasError = data.photon.status === "error";

  return (
    <article
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid="admin-photon"
    >
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-slate-100">{t("admin.photon.title")}</h3>
        <ActiveBadge active={active} />
      </header>

      <dl className="text-xs grid grid-cols-2 gap-y-1 text-slate-400">
        <dt>{t("admin.photon.endpoint")}</dt>
        <dd className="text-slate-200 font-mono break-all">{data.photon.url}</dd>
        <dt>{t("admin.photon.lastImport")}</dt>
        <dd className="text-slate-200 font-mono">
          {data.photon.last_import
            ? new Date(data.photon.last_import).toLocaleString()
            : "—"}
        </dd>
        <dt>{t("admin.status")}</dt>
        <dd className={statusClass(data.photon.status)}>{data.photon.status}</dd>
      </dl>

      {(probing || hasError) && data.photon.status_message && (
        <p
          className={`text-xs ${
            hasError ? "text-rose-300" : "text-slate-300"
          } font-mono break-words`}
        >
          {data.photon.status_message}
        </p>
      )}

      <p className="text-[11px] text-slate-500">{t("admin.photon.deployHint")}</p>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => probe.mutate()}
          disabled={probing || probe.isPending}
          data-testid="photon-probe"
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white px-3 py-1.5 rounded-md transition"
        >
          {probing ? t("admin.photon.probing") : t("admin.photon.probe")}
        </button>
        {data.photon.available && !active && (
          <button
            type="button"
            onClick={() => useThis.mutate()}
            disabled={useThis.isPending}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-emerald-100 px-3 py-1.5 rounded-md transition"
          >
            {t("admin.useThis")}
          </button>
        )}
        {active && (
          <button
            type="button"
            onClick={() => useNominatim.mutate()}
            disabled={useNominatim.isPending}
            className="text-xs bg-slate-800 hover:bg-slate-700 ring-1 ring-slate-700 text-slate-200 px-3 py-1.5 rounded-md transition"
          >
            {t("admin.photon.backToNominatim")}
          </button>
        )}
      </div>
    </article>
  );
}

function LiveProgress({
  bytesWritten,
  totalBytes,
}: {
  bytesWritten: number;
  totalBytes: number;
}) {
  const { t } = useTranslation();
  // Track previous reading to derive instantaneous rate client-side.
  const prevRef = useRef<{ bytes: number; ts: number } | null>(null);
  const [rateMbS, setRateMbS] = useState<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (prevRef.current && now > prevRef.current.ts) {
      const dt = (now - prevRef.current.ts) / 1000;
      const db = bytesWritten - prevRef.current.bytes;
      if (dt > 0 && db >= 0) {
        // Exponential smoothing so the number doesn't flicker
        const inst = db / 1024 / 1024 / dt;
        setRateMbS((r) => (r === null ? inst : 0.6 * r + 0.4 * inst));
      }
    }
    prevRef.current = { bytes: bytesWritten, ts: now };
  }, [bytesWritten]);

  const pct = totalBytes > 0 ? (bytesWritten * 100) / totalBytes : 0;
  const writtenMib = (bytesWritten / 1024 / 1024).toFixed(0);
  const totalMib = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(0) : "?";
  let etaStr = "";
  if (rateMbS && rateMbS > 0 && totalBytes > 0) {
    const remainingMib = (totalBytes - bytesWritten) / 1024 / 1024;
    const etaS = Math.max(0, remainingMib / rateMbS);
    const h = Math.floor(etaS / 3600);
    const m = Math.floor((etaS % 3600) / 60);
    etaStr = h ? ` · ETA ${h}h ${m}m` : ` · ETA ${m}m`;
  }

  return (
    <div className="space-y-1">
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${Math.min(100, pct).toFixed(2)}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-400 font-mono">
        {pct.toFixed(2)}% — {writtenMib} / {totalMib} MiB
        {rateMbS !== null ? ` @ ${rateMbS.toFixed(1)} MB/s` : ""}
        {etaStr}
        {" "}
        <span className="text-slate-600">({t("admin.live")})</span>
      </p>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-mono ${
        active
          ? "bg-emerald-900/60 ring-1 ring-emerald-700/60 text-emerald-300"
          : "bg-slate-800 ring-1 ring-slate-700 text-slate-400"
      }`}
    >
      {active ? t("admin.active") : t("admin.inactive")}
    </span>
  );
}

function statusClass(s: "idle" | "running" | "error") {
  return s === "error"
    ? "text-rose-300"
    : s === "running"
      ? "text-amber-300"
      : "text-emerald-300";
}
