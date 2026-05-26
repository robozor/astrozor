import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  admin,
  places as placesApi,
  type AdminPlace,
  type ImportPreviewOut,
  type ImportPreviewRow,
  type ImportRowDecision,
  type Me,
} from "../lib/api";
import { PlaceFormModal } from "./PlaceFormModal";

/** Admin panel: datagrid of all places + CSV export/import. */
export function AdminPlacesPanel({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminPlace | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminPlace | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({
    queryKey: ["admin", "places", q],
    queryFn: () => admin.listPlaces(q),
  });

  const del = useMutation({
    mutationFn: (slug: string) => placesApi.remove(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "places"] });
      qc.invalidateQueries({ queryKey: ["places"] });
      setConfirmDelete(null);
    },
  });

  return (
    <article
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid="admin-places"
    >
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-medium text-slate-100">{t("admin.places.title")}</h3>
          <p className="text-xs text-slate-500 mt-1">
            {t("admin.places.subtitle", { count: list.data?.length ?? 0 })}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin.places.searchPlaceholder")}
            className="bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded px-2 py-1 text-xs text-slate-100"
          />
          <a
            href={admin.exportPlacesCsvUrl()}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
            data-testid="admin-places-export"
          >
            ⬇ {t("admin.places.exportCsv")}
          </a>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="text-xs px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white"
            data-testid="admin-places-import"
          >
            ⬆ {t("admin.places.importCsv")}
          </button>
        </div>
      </header>

      <div className="max-h-[40rem] overflow-y-auto dark-scroll ring-1 ring-slate-800 rounded">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900 ring-1 ring-slate-800">
            <tr>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium">
                {t("admin.places.col.name")}
              </th>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium">
                {t("admin.places.col.kind")}
              </th>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium">
                {t("admin.places.col.gps")}
              </th>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium">
                {t("admin.places.col.bortle")}
              </th>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium">
                {t("admin.places.col.owner")}
              </th>
              <th className="text-right px-2 py-1.5 text-slate-400 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((p) => (
              <tr
                key={p.id}
                className="border-t border-slate-800 hover:bg-slate-900/30"
                data-testid={`admin-places-row-${p.slug}`}
              >
                <td className="px-2 py-1.5 text-slate-100">
                  <div>{p.name}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{p.slug}</div>
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {t(`places.kind.${p.kind}`)}
                </td>
                <td className="px-2 py-1.5 font-mono text-slate-400">
                  {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                </td>
                <td className="px-2 py-1.5 font-mono">
                  <span className="text-indigo-300">{p.bortle_class_manual?.toFixed(1) ?? "—"}</span>
                  <span className="text-slate-600 mx-0.5">/</span>
                  <span className="text-slate-400">{p.bortle_class_map?.toFixed(1) ?? "—"}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-500 text-[11px]">
                  {p.owner_email || "—"}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="text-[11px] px-1.5 py-0.5 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
                    data-testid={`admin-places-edit-${p.slug}`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(p)}
                    className="ml-1 text-[11px] px-1.5 py-0.5 rounded ring-1 ring-rose-900/60 hover:bg-rose-950/40 text-rose-300"
                    data-testid={`admin-places-delete-${p.slug}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                  {t("admin.places.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PlaceFormModal
          mode="edit"
          initial={{
            slug: editing.slug,
            name: editing.name,
            kind: editing.kind,
            lat: editing.lat,
            lon: editing.lon,
            elevation_m: editing.elevation_m,
          }}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["admin", "places"] });
            qc.invalidateQueries({ queryKey: ["places"] });
          }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="bg-slate-900 ring-1 ring-rose-900/60 rounded-xl p-4 max-w-md">
            <p className="text-sm text-slate-100">
              {t("admin.places.confirmDelete", { name: confirmDelete.name })}
            </p>
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded ring-1 ring-slate-700 text-slate-300 text-xs hover:bg-slate-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => del.mutate(confirmDelete.slug)}
                disabled={del.isPending}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs"
              >
                {del.isPending ? "…" : t("admin.places.deleteYes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <CsvImportWizard onClose={() => setImportOpen(false)} />
      )}
    </article>
  );
}

function CsvImportWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<ImportPreviewOut | null>(null);
  // Map of row_index → "import" | "skip"
  const [decisions, setDecisions] = useState<Record<number, boolean>>({});

  const upload = useMutation({
    mutationFn: (file: File) => admin.importPlacesPreview(file),
    onSuccess: (data) => {
      setPreview(data);
      // Default decisions: import everything that's not a duplicate and has no errors
      const d: Record<number, boolean> = {};
      for (const r of data.rows) {
        d[r.row_index] = r.errors.length === 0 && r.duplicates.length === 0;
      }
      setDecisions(d);
    },
  });

  const commit = useMutation({
    mutationFn: (rows: ImportRowDecision[]) => admin.importPlacesCommit(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "places"] });
      qc.invalidateQueries({ queryKey: ["places"] });
    },
  });

  const selectedCount = useMemo(
    () => Object.values(decisions).filter(Boolean).length,
    [decisions],
  );

  function submitCommit() {
    if (!preview) return;
    const rows: ImportRowDecision[] = preview.rows
      .filter((r) => decisions[r.row_index] && r.errors.length === 0)
      .map((r) => ({
        row_index: r.row_index,
        name: r.name,
        kind: r.kind || "spot_permanent",
        lat: r.lat!,
        lon: r.lon!,
        description: r.description,
        address: r.address,
        website: r.website,
        elevation_m: r.elevation_m,
        bortle_manual: r.bortle_manual,
        owner_email: r.owner_email,
      }));
    commit.mutate(rows);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16"
      // Backdrop click no longer closes — CSV import preview with
      // per-row decisions; misclick used to silently discard the whole
      // preview. Close via ✕ / Cancel (#20).
      data-testid="admin-places-import-modal"
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden p-5 flex flex-col"
      >
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              {t("admin.places.import.title")}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {t("admin.places.import.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100"
          >
            ✕
          </button>
        </header>

        {!preview && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                className="px-4 py-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
              >
                {upload.isPending
                  ? t("admin.places.import.parsing")
                  : t("admin.places.import.pickFile")}
              </button>
              {upload.isError && (
                <p className="text-xs text-rose-400 mt-2">
                  {(upload.error as Error)?.message}
                </p>
              )}
            </div>
          </div>
        )}

        {preview && !commit.isSuccess && (
          <>
            <div className="text-xs text-slate-300 mb-2 flex flex-wrap gap-3 items-center">
              <span>
                {t("admin.places.import.summary.total")}:{" "}
                <strong>{preview.summary.total}</strong>
              </span>
              <span className="text-emerald-300">
                {t("admin.places.import.summary.new")}: {preview.summary.new}
              </span>
              <span className="text-amber-300">
                {t("admin.places.import.summary.duplicates", {
                  count: preview.summary.duplicates,
                  radius: preview.summary.duplicate_radius_m,
                })}
              </span>
              {preview.summary.errors > 0 && (
                <span className="text-rose-300">
                  {t("admin.places.import.summary.errors")}: {preview.summary.errors}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  const d = { ...decisions };
                  for (const r of preview.rows)
                    if (r.errors.length === 0) d[r.row_index] = true;
                  setDecisions(d);
                }}
                className="text-[11px] px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
              >
                {t("admin.places.import.bulk.importAll")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = { ...decisions };
                  for (const r of preview.rows)
                    if (r.duplicates.length > 0) d[r.row_index] = false;
                  setDecisions(d);
                }}
                className="text-[11px] px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
              >
                {t("admin.places.import.bulk.skipDupes")}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto dark-scroll ring-1 ring-slate-800 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-slate-400">
                      {t("admin.places.import.col.import")}
                    </th>
                    <th className="px-2 py-1.5 text-left text-slate-400">Row</th>
                    <th className="px-2 py-1.5 text-left text-slate-400">
                      {t("admin.places.col.name")}
                    </th>
                    <th className="px-2 py-1.5 text-left text-slate-400">
                      {t("admin.places.col.kind")}
                    </th>
                    <th className="px-2 py-1.5 text-left text-slate-400">
                      {t("admin.places.col.gps")}
                    </th>
                    <th className="px-2 py-1.5 text-left text-slate-400">
                      {t("admin.places.import.col.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <PreviewRow
                      key={r.row_index}
                      row={r}
                      checked={!!decisions[r.row_index]}
                      onToggle={(c) =>
                        setDecisions((d) => ({ ...d, [r.row_index]: c }))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="mt-3 flex items-center gap-2">
              <span className="text-xs text-slate-400">
                {t("admin.places.import.selected", { count: selectedCount })}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800 text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submitCommit}
                disabled={commit.isPending || selectedCount === 0}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm"
                data-testid="admin-places-import-commit"
              >
                {commit.isPending ? "…" : t("admin.places.import.commit", { count: selectedCount })}
              </button>
            </footer>

            {commit.isError && (
              <p className="text-xs text-rose-400 mt-2">
                {(commit.error as Error)?.message}
              </p>
            )}
          </>
        )}

        {commit.isSuccess && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-lg text-emerald-300 mb-2">
              ✓ {t("admin.places.import.done", { count: commit.data?.created_count ?? 0 })}
            </p>
            {commit.data && commit.data.failed.length > 0 && (
              <details className="text-xs text-rose-300">
                <summary>{commit.data.failed.length} failed</summary>
                <ul className="mt-2 space-y-1">
                  {commit.data.failed.map((f, i) => (
                    <li key={i}>row {f.row_index}: {f.error}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
            >
              {t("common.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  checked,
  onToggle,
}: {
  row: ImportPreviewRow;
  checked: boolean;
  onToggle: (c: boolean) => void;
}) {
  const { t } = useTranslation();
  const hasErrors = row.errors.length > 0;
  const isDup = row.duplicates.length > 0;
  return (
    <tr
      className={`border-t border-slate-800 ${
        hasErrors ? "bg-rose-950/20" : isDup ? "bg-amber-950/10" : ""
      }`}
    >
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={hasErrors}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </td>
      <td className="px-2 py-1.5 text-slate-500 font-mono">{row.row_index}</td>
      <td className="px-2 py-1.5 text-slate-100">{row.name || "—"}</td>
      <td className="px-2 py-1.5 text-slate-300">{row.kind}</td>
      <td className="px-2 py-1.5 font-mono text-slate-400">
        {row.lat !== null && row.lon !== null
          ? `${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}`
          : "—"}
      </td>
      <td className="px-2 py-1.5 text-[11px]">
        {hasErrors && (
          <span className="text-rose-300">{row.errors.join("; ")}</span>
        )}
        {!hasErrors && isDup && (
          <span className="text-amber-300">
            {t("admin.places.import.duplicateOf", {
              name: row.duplicates[0]!.name,
              distance: Math.round(row.duplicates[0]!.distance_m),
            })}
          </span>
        )}
        {!hasErrors && !isDup && <span className="text-emerald-300">✓ new</span>}
      </td>
    </tr>
  );
}
