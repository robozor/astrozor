import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  admin,
  adminUsers,
  zooniverse,
  type AdminUser,
  type Me,
  type MapInfraOut,
  type ZooniverseDisconnectResult,
  type ZooniverseProject,
  type ZooniverseProjectPreview,
} from "../lib/api";
import { AdminPlacesPanel } from "./AdminPlacesPanel";

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
      <UsersPanel me={me} />
      <AdminPlacesPanel me={me} />
      <ZooniverseProjectsPanel />
      <MapInfraPanel />
    </section>
  );
}

function ZooniverseProjectsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("astronomy");
  const dq = useDeferredValue(q);
  // ID of the project the admin is reviewing in the import modal.
  // Set when "Add" is clicked in the search list; cleared on close.
  // The modal fetches the full preview lazily so we don't pre-load
  // every search result.
  const [reviewZid, setReviewZid] = useState<number | null>(null);
  // ZooniverseProject the admin is about to disconnect — drives the
  // disconnect-confirmation modal. ``null`` = no modal open.
  const [disconnectProject, setDisconnectProject] = useState<ZooniverseProject | null>(
    null,
  );
  // Optional flash banner after a successful disconnect — keeps the
  // user oriented in the admin panel where the row they just deleted
  // is now gone.
  const [disconnectFlash, setDisconnectFlash] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["admin", "zooniverse-projects"],
    queryFn: () => zooniverse.listProjects(false),
  });
  // Search-as-you-type. Empty query still returns top astronomy projects
  // by classifications_count — useful first-visit discovery.
  const search = useQuery({
    queryKey: ["admin", "zooniverse-search", dq, tagFilter],
    queryFn: () => zooniverse.adminSearch({ q: dq, tags: tagFilter }),
    staleTime: 30_000,
  });
  const add = useMutation({
    mutationFn: (idOrUrl: string) => zooniverse.adminAdd(idOrUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "zooniverse-projects"] });
      qc.invalidateQueries({ queryKey: ["admin", "zooniverse-search"] });
      qc.invalidateQueries({ queryKey: ["zooniverse-projects"] });
    },
  });
  const patch = useMutation({
    mutationFn: (args: { zid: number; data: { is_featured?: boolean; tags?: string[] } }) =>
      zooniverse.adminPatch(args.zid, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "zooniverse-projects"] });
      qc.invalidateQueries({ queryKey: ["zooniverse-projects"] });
    },
  });
  const remove = useMutation({
    mutationFn: (zid: number) => zooniverse.adminRemove(zid),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin", "zooniverse-projects"] });
      qc.invalidateQueries({ queryKey: ["zooniverse-projects"] });
      qc.invalidateQueries({ queryKey: ["admin", "zooniverse-search"] });
      setDisconnectFlash(
        t("citizen.disconnect.result.success", {
          sprints: result.deleted_sprints,
          participants: result.deleted_participants,
          snapshots: result.deleted_snapshots,
        }),
      );
      setDisconnectProject(null);
      window.setTimeout(() => setDisconnectFlash(null), 6000);
    },
  });

  return (
    <section
      className="bg-slate-950/40 ring-1 ring-slate-800 rounded-xl p-4"
      data-testid="admin-zooniverse"
    >
      <header className="mb-3">
        <h3 className="font-medium text-slate-100">Zooniverse projekty</h3>
        <p className="text-xs text-slate-500 mt-1">
          Vyhledej projekt na Zooniverse a klikni „Přidat". Defaultní filtr je{" "}
          <code className="text-slate-300">astronomy</code> tag — uprav podle potřeby
          (např. <code className="text-slate-300">physics</code>,{" "}
          <code className="text-slate-300">space,nature</code>, nebo prázdný řetězec pro vše).
        </p>
      </header>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hledat (např. galaxy, asteroid, supernova)…"
          className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 text-sm outline-none"
          data-testid="admin-zooniverse-search"
        />
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="tag(y), prázdné = vše"
          className="w-44 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-1.5 text-slate-100 text-xs outline-none"
          data-testid="admin-zooniverse-tags"
        />
      </div>

      {add.isError && (
        <p className="mb-3 text-xs text-rose-400">
          {(add.error as Error).message || "Přidání selhalo."}
        </p>
      )}

      {/* Search results */}
      <div className="mb-4 space-y-1 max-h-80 overflow-y-auto bg-slate-950/60 ring-1 ring-slate-800 rounded-md">
        {search.isLoading && (
          <p className="text-xs text-slate-500 px-3 py-2">Hledám…</p>
        )}
        {search.isSuccess && search.data.length === 0 && (
          <p className="text-xs text-slate-500 px-3 py-2">Žádné projekty.</p>
        )}
        {search.isSuccess &&
          search.data.map((r) => (
            <div
              key={r.zooniverse_id}
              className={`flex items-center gap-3 px-3 py-2 border-b border-slate-800/60 last:border-0 ${
                r.already_in_catalogue ? "opacity-50" : ""
              }`}
              data-testid={`admin-zooniverse-search-row-${r.zooniverse_id}`}
            >
              {r.avatar_url ? (
                <img
                  src={r.avatar_url}
                  alt=""
                  className="w-10 h-10 rounded object-cover ring-1 ring-slate-800 shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-slate-800 ring-1 ring-slate-700 flex items-center justify-center text-slate-600 shrink-0">
                  🔭
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <strong className="text-sm text-slate-100 truncate">{r.title}</strong>
                  <span className="text-[10px] text-slate-500">#{r.zooniverse_id}</span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-1">{r.description}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  <span className="font-mono">{r.classifications_count.toLocaleString("cs-CZ")}</span> klasifikací · {r.state} · {r.primary_language?.toUpperCase()}
                </p>
                {!r.launch_approved && (
                  <p
                    className="text-[10px] text-amber-300/90 mt-0.5"
                    title="launch_approved = false na Panoptes"
                  >
                    ⚠ neoficiální / pravděpodobně neaktivní
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={r.already_in_catalogue}
                onClick={() => setReviewZid(r.zooniverse_id)}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-2.5 py-1 rounded transition shrink-0"
                data-testid={`admin-zooniverse-search-add-${r.zooniverse_id}`}
              >
                {r.already_in_catalogue ? "✓ V katalogu" : "Přidat…"}
              </button>
            </div>
          ))}
      </div>

      {list.isLoading && (
        <p className="text-xs text-slate-500">Načítám…</p>
      )}
      {list.isSuccess && list.data.length === 0 && (
        <p className="text-xs text-slate-500">Katalog je prázdný — přidej první projekt výše.</p>
      )}
      {list.isSuccess && list.data.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500 text-left">
            <tr>
              <th className="py-1.5 px-2">Projekt</th>
              <th className="py-1.5 px-2">Klasifikace</th>
              <th className="py-1.5 px-2">Featured</th>
              <th className="py-1.5 px-2">Stav</th>
              <th className="py-1.5 px-2 text-right">Akce</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((p: ZooniverseProject) => (
              <tr
                key={p.id}
                className="border-t border-slate-800/60"
                data-testid={`admin-zooniverse-row-${p.zooniverse_id}`}
              >
                <td className="py-1.5 px-2">
                  <div className="font-medium text-slate-100">{p.title || `#${p.zooniverse_id}`}</div>
                  <div className="text-[11px] text-slate-500">{p.slug}</div>
                </td>
                <td className="py-1.5 px-2 font-mono text-slate-300">
                  {p.classifications_count.toLocaleString("cs-CZ")}
                </td>
                <td className="py-1.5 px-2">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.is_featured}
                      onChange={(e) =>
                        patch.mutate({
                          zid: p.zooniverse_id,
                          data: { is_featured: e.target.checked },
                        })
                      }
                      className="accent-indigo-500"
                    />
                    <span className="text-slate-400">{p.is_featured ? "ano" : "ne"}</span>
                  </label>
                </td>
                <td className="py-1.5 px-2 text-slate-400">{p.state || "—"}</td>
                <td className="py-1.5 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => setDisconnectProject(p)}
                    className="text-rose-400 hover:text-rose-300 text-[11px]"
                    data-testid={`zooniverse-disconnect-${p.zooniverse_id}`}
                  >
                    Odpojit…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reviewZid !== null && (
        <ZooniverseImportReviewModal
          zid={reviewZid}
          isAdding={add.isPending}
          addError={add.error as Error | null}
          onClose={() => setReviewZid(null)}
          onConfirm={() => {
            add.mutate(String(reviewZid), {
              onSuccess: () => setReviewZid(null),
            });
          }}
        />
      )}

      {disconnectProject && (
        <ZooniverseDisconnectModal
          project={disconnectProject}
          isPending={remove.isPending}
          error={remove.error as Error | null}
          onClose={() => setDisconnectProject(null)}
          onConfirm={() => remove.mutate(disconnectProject.zooniverse_id)}
        />
      )}

      {disconnectFlash && (
        <div
          data-testid="zooniverse-disconnect-flash"
          className="fixed bottom-4 right-4 z-40 bg-emerald-950/90 ring-1 ring-emerald-900/60 text-emerald-100 text-sm px-4 py-3 rounded-md shadow-lg max-w-md"
          role="status"
        >
          {disconnectFlash}
        </div>
      )}
    </section>
  );
}

/**
 * Pre-import preview modal — fetches full Panoptes metadata via the
 * dry-run endpoint and lets the admin decide whether to commit the
 * project to the Astrozor catalogue. Surfaces the same warnings the
 * runtime detail view would later show (zombie, not launch-approved),
 * so a bad import never makes it past the admin.
 */
function ZooniverseImportReviewModal({
  zid,
  isAdding,
  addError,
  onClose,
  onConfirm,
}: {
  zid: number;
  isAdding: boolean;
  addError: Error | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
  const preview = useQuery({
    queryKey: ["admin", "zooniverse-preview", zid],
    queryFn: () => zooniverse.adminPreview(String(zid)),
    staleTime: 60_000,
  });
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  // Close on Escape — typical modal behaviour. Click on backdrop also
  // closes via the wrapper onClick + stopPropagation on the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p: ZooniverseProjectPreview | undefined = preview.data;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="zooniverse-import-review-modal"
    >
      <div
        className="w-full max-w-2xl bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              {t("citizen.importReview.title")}
            </h3>
            <p className="text-[11px] text-slate-500">
              {t("citizen.importReview.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {preview.isLoading && (
            <p className="text-sm text-slate-400">{t("citizen.importReview.loading")}</p>
          )}
          {preview.isError && (
            <p className="text-sm text-rose-400">
              {t("citizen.importReview.fetchError")}
            </p>
          )}
          {p && (
            <>
              {/* Header row: banner + title + meta */}
              <div className="flex items-start gap-3">
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt=""
                    className="w-16 h-16 rounded-md ring-1 ring-slate-800 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-slate-800 ring-1 ring-slate-700 flex items-center justify-center text-3xl shrink-0">
                    🔭
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-100 leading-tight">
                    {p.title}{" "}
                    <span className="text-[11px] text-slate-500 ml-1">#{p.zooniverse_id}</span>
                  </h4>
                  {p.owner_login && (
                    <p className="text-[11px] text-slate-500">@{p.owner_login}</p>
                  )}
                  {p.description && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-3">
                      {p.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Status badges */}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <StatusBadge
                  ok={p.launch_approved}
                  label={
                    p.launch_approved
                      ? t("citizen.importReview.launchApproved")
                      : t("citizen.importReview.launchApprovedNo")
                  }
                />
                {p.beta_approved && (
                  <StatusBadge ok={true} label={t("citizen.importReview.betaApproved")} accent="sky" />
                )}
                {p.private && (
                  <StatusBadge ok={false} label={t("citizen.importReview.private")} accent="amber" />
                )}
                <span className="text-slate-500 px-2 py-1 rounded bg-slate-950 ring-1 ring-slate-800">
                  state: <span className="font-mono text-slate-300">{p.state || "—"}</span>
                </span>
                <span className="text-slate-500 px-2 py-1 rounded bg-slate-950 ring-1 ring-slate-800">
                  lang: <span className="font-mono text-slate-300">{p.primary_language?.toUpperCase() || "—"}</span>
                </span>
              </div>

              {/* Counts */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase text-slate-500">
                    {t("citizen.importReview.subjectsCount")}
                  </div>
                  <div className="font-mono text-slate-200">{fmt(p.subjects_count)}</div>
                </div>
                <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase text-slate-500">
                    {t("citizen.importReview.classificationsCount")}
                  </div>
                  <div className="font-mono text-slate-200">
                    {fmt(p.classifications_count)}
                  </div>
                </div>
              </div>

              {/* Active workflows */}
              <div>
                <div className="text-[10px] uppercase text-slate-500 mb-1">
                  {t("citizen.importReview.activeWorkflows")} ({p.workflows.length})
                </div>
                {p.workflows.length === 0 ? (
                  <p className="text-xs text-rose-300">
                    {t("citizen.importReview.noActiveWorkflows")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {p.workflows.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-start justify-between gap-3 bg-slate-950/60 ring-1 ring-slate-800 rounded px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-200 font-medium">
                            {w.display_name}{" "}
                            <span className="text-[10px] text-slate-500">#{w.id}</span>
                          </div>
                          {w.description && (
                            <div className="text-[11px] text-slate-400 leading-snug line-clamp-2">
                              {w.description}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {t("citizen.importReview.workflowCompleteness", {
                            pct: Math.round((w.completeness || 0) * 100),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Zombie warning */}
              {p.zombie && (
                <div
                  role="alert"
                  className="bg-amber-950/40 ring-1 ring-amber-900/60 rounded-md px-3 py-2"
                >
                  <p className="text-xs text-amber-200">
                    ⚠ {t("citizen.importReview.zombieWarning")}
                  </p>
                </div>
              )}

              {p.already_in_catalogue && (
                <p className="text-xs text-slate-400 italic">
                  {t("citizen.importReview.alreadyInCatalogue")}
                </p>
              )}
            </>
          )}

          {addError && (
            <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
              {addError.message}
            </p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-md ring-1 ring-slate-700 transition"
          >
            {t("citizen.importReview.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isAdding || !!p?.already_in_catalogue || !p}
            data-testid="zooniverse-import-confirm"
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-md transition"
          >
            {isAdding ? "…" : t("citizen.importReview.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Disconnect confirmation modal — drops the project + linked sprints +
 * cached snapshots from Astrozor. Reassures the admin that nothing
 * happens on Zooniverse and shows the exact blast radius before
 * committing.
 */
function ZooniverseDisconnectModal({
  project,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  project: ZooniverseProject;
  isPending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
  const preview = useQuery({
    queryKey: ["admin", "zooniverse-disconnect-preview", project.zooniverse_id],
    queryFn: () => zooniverse.adminDisconnectPreview(project.zooniverse_id),
  });
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = preview.data;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="zooniverse-disconnect-modal"
    >
      <div
        className="w-full max-w-2xl bg-slate-900 ring-1 ring-rose-900/40 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between px-5 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-rose-200">
              ⚠ {t("citizen.disconnect.title")}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              {t("citizen.disconnect.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg shrink-0 ml-3"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Project header — same shape as the import-review modal so the
              admin orients quickly. */}
          <div className="flex items-start gap-3">
            {project.avatar_url ? (
              <img
                src={project.avatar_url}
                alt=""
                className="w-12 h-12 rounded-md ring-1 ring-slate-800 object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-md bg-slate-800 ring-1 ring-slate-700 flex items-center justify-center text-xl shrink-0">
                🔭
              </div>
            )}
            <div className="min-w-0">
              <h4 className="font-semibold text-slate-100">{project.title}</h4>
              <p className="text-[11px] text-slate-500">
                #{project.zooniverse_id}{" "}
                {project.slug && (
                  <span className="font-mono">· {project.slug}</span>
                )}
              </p>
            </div>
          </div>

          {preview.isLoading && (
            <p className="text-xs text-slate-500">
              {t("citizen.disconnect.loading")}
            </p>
          )}
          {preview.isError && (
            <p className="text-xs text-rose-400">
              {t("citizen.disconnect.fetchError")}
            </p>
          )}

          {data && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                  {t("citizen.disconnect.consequencesHeading")}
                </div>
                {!data.has_downstream ? (
                  <p className="text-xs text-slate-400 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-3 py-2">
                    {t("citizen.disconnect.noDownstreamHint")}
                  </p>
                ) : (
                  <ul className="text-xs text-slate-300 space-y-1 bg-rose-950/20 ring-1 ring-rose-900/40 rounded-md px-3 py-2">
                    <li className="flex items-start gap-2">
                      <span className="text-rose-400 mt-0.5">✕</span>
                      <span>
                        {t("citizen.disconnect.willDelete.project", {
                          title: data.title,
                        })}
                      </span>
                    </li>
                    {data.sprint_count > 0 && (
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 mt-0.5">✕</span>
                        <span>
                          {t("citizen.disconnect.willDelete.sprints", {
                            count: data.sprint_count,
                          })}
                        </span>
                      </li>
                    )}
                    {data.participant_count > 0 && (
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 mt-0.5">✕</span>
                        <span>
                          {t("citizen.disconnect.willDelete.participants", {
                            count: data.participant_count,
                          })}
                        </span>
                      </li>
                    )}
                    {data.stats_snapshot_count > 0 && (
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 mt-0.5">✕</span>
                        <span>
                          {t("citizen.disconnect.willDelete.snapshots", {
                            count: data.stats_snapshot_count,
                          })}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {data.sprints.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    {t("citizen.disconnect.sprintListHeading")}
                  </div>
                  <ul className="text-[11px] text-slate-400 space-y-0.5 max-h-32 overflow-y-auto bg-slate-950/40 ring-1 ring-slate-800 rounded px-2 py-1.5">
                    {data.sprints.map((s) => (
                      <li
                        key={s.slug}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{s.title}</span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {s.status} · {fmt(s.participant_count)} účast.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Zooniverse reassurance — the modal's whole point is to
                  make clear nothing happens upstream. */}
              <div className="bg-sky-950/30 ring-1 ring-sky-900/50 rounded-md px-3 py-2">
                <p className="text-xs text-sky-200 font-medium mb-1">
                  ✓ {t("citizen.disconnect.zooniverseNote")}
                </p>
                <ul
                  className="list-disc list-inside text-[11px] text-sky-100/80 space-y-0.5"
                  dangerouslySetInnerHTML={{
                    __html: t("citizen.disconnect.zooniverseNoteList"),
                  }}
                />
              </div>

              {data.has_downstream && (
                <p className="text-[11px] text-amber-300/90 italic leading-snug">
                  ⚠ {t("citizen.disconnect.irreversibleWarning")}
                </p>
              )}
            </>
          )}

          {error && (
            <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
              {error.message}
            </p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-md ring-1 ring-slate-700 transition"
          >
            {t("citizen.disconnect.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || preview.isLoading || preview.isError}
            data-testid="zooniverse-disconnect-confirm"
            className="text-xs bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-md transition"
          >
            {isPending ? "…" : t("citizen.disconnect.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function StatusBadge({
  ok,
  label,
  accent,
}: {
  ok: boolean;
  label: string;
  accent?: "emerald" | "rose" | "amber" | "sky";
}) {
  const resolved =
    accent ?? (ok ? "emerald" : "amber");
  const palette = {
    emerald: "bg-emerald-950/40 ring-emerald-900/60 text-emerald-200",
    rose: "bg-rose-950/40 ring-rose-900/60 text-rose-200",
    amber: "bg-amber-950/40 ring-amber-900/60 text-amber-200",
    sky: "bg-sky-950/40 ring-sky-900/60 text-sky-200",
  }[resolved];
  return (
    <span className={`px-2 py-1 rounded ring-1 ${palette}`}>
      {ok ? "✓ " : "⚠ "}
      {label}
    </span>
  );
}

function UsersPanel({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["admin", "users", q],
    queryFn: () => adminUsers.list(q),
  });
  const patch = useMutation({
    mutationFn: (args: { id: string; data: { is_active?: boolean; is_staff?: boolean } }) =>
      adminUsers.patch(args.id, args.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <section
      className="bg-slate-950/40 ring-1 ring-slate-800 rounded-xl p-4"
      data-testid="admin-users"
    >
      <header className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
        <h3 className="font-medium text-slate-100">{t("admin.users.title")}</h3>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.users.search")}
          className="bg-slate-950 ring-1 ring-slate-700 focus:ring-indigo-500 rounded-md px-2 py-1 text-xs text-slate-100 outline-none"
        />
      </header>

      <div className="overflow-auto max-h-[28rem] ring-1 ring-slate-800 rounded-md dark-scroll">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur z-10">
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-2 px-2 font-medium">{t("admin.users.user")}</th>
              <th className="text-left py-2 px-2 font-medium">{t("admin.users.joined")}</th>
              <th className="text-left py-2 px-2 font-medium">{t("admin.users.lastLogin")}</th>
              <th className="text-left py-2 px-2 font-medium">{t("admin.users.origin")}</th>
              <th className="text-left py-2 px-2 font-medium">{t("admin.users.storage")}</th>
              <th className="text-center py-2 px-2 font-medium">{t("admin.users.role")}</th>
              <th className="text-center py-2 px-2 font-medium">{t("admin.users.status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={u.email === me.user.email}
                onPatch={(data) => patch.mutate({ id: u.id, data })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {patch.error && (
        <p className="text-xs text-rose-400 mt-2">{(patch.error as Error).message}</p>
      )}
    </section>
  );
}

function UserRow({
  user,
  isMe,
  onPatch,
}: {
  user: AdminUser;
  isMe: boolean;
  onPatch: (data: { is_active?: boolean; is_staff?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const flag = countryEmoji(user.last_login_country_code);
  return (
    <tr className="border-b border-slate-900 hover:bg-slate-900/40" data-testid={`user-${user.id}`}>
      <td className="py-2 px-2">
        <div className="text-slate-100 font-mono">{user.email}</div>
        <div className="text-slate-500">{user.display_name}</div>
      </td>
      <td className="py-2 px-2 text-slate-400 font-mono">
        {new Date(user.created_at).toLocaleDateString()}
      </td>
      <td className="py-2 px-2 text-slate-400 font-mono">
        {user.last_login ? new Date(user.last_login).toLocaleString() : "—"}
      </td>
      <td className="py-2 px-2 text-slate-400">
        {user.last_login_ip ? (
          <div>
            <div className="font-mono text-slate-300">{user.last_login_ip}</div>
            {(user.last_login_country || user.last_login_city) && (
              <div className="text-slate-500">
                {flag && <span className="mr-1">{flag}</span>}
                {[user.last_login_city, user.last_login_country]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="py-2 px-2 min-w-[10rem]">
        <StorageBar
          used={user.storage_used_bytes}
          quota={user.storage_quota_bytes}
        />
      </td>
      <td className="py-2 px-2 text-center">
        {user.is_superuser ? (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-900/60 ring-1 ring-fuchsia-700/60 text-fuchsia-300 font-mono">
            super
          </span>
        ) : user.is_staff ? (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-900/60 ring-1 ring-indigo-700/60 text-indigo-300 font-mono">
            staff
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 ring-1 ring-slate-700 text-slate-400 font-mono">
            user
          </span>
        )}
        {!isMe && !user.is_superuser && (
          <button
            type="button"
            onClick={() => onPatch({ is_staff: !user.is_staff })}
            className="ml-2 text-[10px] text-indigo-300 hover:text-indigo-200"
          >
            {user.is_staff ? t("admin.users.revokeStaff") : t("admin.users.grantStaff")}
          </button>
        )}
      </td>
      <td className="py-2 px-2 text-center">
        {user.is_active ? (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/60 ring-1 ring-emerald-700/60 text-emerald-300 font-mono">
            {t("admin.users.active")}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-900/60 ring-1 ring-rose-700/60 text-rose-300 font-mono">
            {t("admin.users.blocked")}
          </span>
        )}
        {!isMe && (
          <button
            type="button"
            onClick={() => onPatch({ is_active: !user.is_active })}
            className="ml-2 text-[10px] text-rose-300 hover:text-rose-200"
          >
            {user.is_active ? t("admin.users.block") : t("admin.users.unblock")}
          </button>
        )}
      </td>
    </tr>
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
      const photonPhase = d?.photon.live_progress?.phase;
      const photonActive =
        photonPhase === "downloading" || photonPhase === "extracting";
      // VIIRS DNB + Black Marble downloads also stream progress through
      // status_message every ~2 s — include them so the LP card refreshes
      // tile_count / status_message / size_bytes while the job runs.
      const lpRunning =
        d?.light_pollution?.black_marble?.status === "running" ||
        d?.light_pollution?.viirs_dnb?.status === "running";
      const running =
        d?.pmtiles.status === "running" ||
        d?.photon.status === "running" ||
        photonActive ||
        lpRunning;
      return running ? 1500 : false;
    },
    refetchIntervalInBackground: true,
  });

  if (infra.isLoading) {
    return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  }
  if (!infra.data) return null;

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <PmtilesCard data={infra.data} />
        <PhotonCard data={infra.data} />
      </div>
      <LightPollutionCard data={infra.data} />
      <ChatSettingsCard data={infra.data} />
    </div>
  );
}

function ChatSettingsCard({ data }: { data: MapInfraOut }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [value, setValue] = useState<string>(String(data.chat.text_max_length));
  // Keep local input in sync if server value changes elsewhere
  useEffect(() => {
    setValue(String(data.chat.text_max_length));
  }, [data.chat.text_max_length]);

  const save = useMutation({
    mutationFn: (n: number) => admin.updateChatSettings(n),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "map-infra"] }),
  });

  const parsed = Number.parseInt(value, 10);
  const inRange = Number.isFinite(parsed) && parsed >= 200 && parsed <= 50_000;
  const dirty = parsed !== data.chat.text_max_length;

  return (
    <article
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid="admin-chat-settings"
    >
      <header>
        <h3 className="font-medium text-slate-100">{t("admin.chat.title")}</h3>
        <p className="text-xs text-slate-500 mt-1">{t("admin.chat.subtitle")}</p>
      </header>

      <div className="flex items-end gap-3">
        <label className="block flex-1 max-w-xs">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("admin.chat.maxLength")}
          </span>
          <input
            type="number"
            min={200}
            max={50000}
            step={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
            data-testid="admin-chat-max-length-input"
          />
        </label>
        <button
          type="button"
          onClick={() => inRange && save.mutate(parsed)}
          disabled={!inRange || !dirty || save.isPending}
          className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:text-slate-500 text-white text-sm"
          data-testid="admin-chat-save"
        >
          {save.isPending ? "…" : t("admin.chat.save")}
        </button>
      </div>

      {!inRange && (
        <p className="text-[11px] text-rose-300">{t("admin.chat.outOfRange")}</p>
      )}
      {save.isSuccess && !dirty && (
        <p className="text-[11px] text-emerald-300">{t("admin.chat.saved")}</p>
      )}
      {save.isError && (
        <p className="text-[11px] text-rose-400">
          {(save.error as Error)?.message}
        </p>
      )}
      <p className="text-[11px] text-slate-500">{t("admin.chat.hint")}</p>
    </article>
  );
}

function LightPollutionCard({ data }: { data: MapInfraOut }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const lp = data.light_pollution;

  const setSource = useMutation({
    mutationFn: (source: "black_marble_2016" | "viirs_dnb_latest") =>
      admin.setLightPollutionSource(source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });
  const refresh = useMutation({
    mutationFn: () => admin.refreshLightPollutionLatest(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "map-infra"] });
      qc.invalidateQueries({ queryKey: ["map-config"] });
    },
  });

  return (
    <article
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      data-testid="admin-light-pollution"
    >
      <header>
        <h3 className="font-medium text-slate-100">{t("admin.lp.title")}</h3>
        <p className="text-xs text-slate-500 mt-1">{t("admin.lp.subtitle")}</p>
      </header>

      {/* Side-by-side on screens that have the room — stacks on narrow.
          The two cards aren't very wide so two-up uses the admin pane
          space better. md ≈ 768 px is the breakpoint where the admin
          right pane is typically wider than ~640 px. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <LpSourceOption
          source="black_marble_2016"
          active={lp.source === "black_marble_2016"}
          onSelect={() => setSource.mutate("black_marble_2016")}
          disabled={setSource.isPending}
          extra={<LpDownloadSection source="black_marble_2016" data={lp.black_marble} />}
        />
        <LpSourceOption
          source="viirs_dnb_latest"
          active={lp.source === "viirs_dnb_latest"}
          onSelect={() => setSource.mutate("viirs_dnb_latest")}
          disabled={setSource.isPending}
          extra={
            <div className="mt-2 space-y-2">
              <div className="text-[11px] text-slate-300 font-mono">
                {t("admin.lp.dnbDate")}:{" "}
                <span className="text-slate-100">
                  {lp.dnb_date || t("admin.notReady")}
                </span>
                {lp.last_check && (
                  <span className="text-slate-500 ml-2">
                    ({t("admin.lp.lastCheck")}:{" "}
                    {new Date(lp.last_check).toLocaleString()})
                  </span>
                )}
              </div>
              {lp.status_message && (
                <p className="text-[11px] text-slate-400 italic">
                  {lp.status_message}
                </p>
              )}
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="text-xs px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
                data-testid="admin-lp-refresh"
              >
                {refresh.isPending
                  ? t("admin.lp.refreshing")
                  : t("admin.lp.refreshLatest")}
              </button>
              {refresh.isError && (
                <p className="text-[11px] text-rose-400">
                  {(refresh.error as Error)?.message}
                </p>
              )}
              {lp.dnb_date && (
                <LpDownloadSection source="viirs_dnb_latest" data={lp.viirs_dnb} />
              )}
            </div>
          }
        />
      </div>
    </article>
  );
}

function LpDownloadSection({
  source,
  data,
}: {
  source: "black_marble_2016" | "viirs_dnb_latest";
  data: MapInfraOut["light_pollution"]["black_marble"];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showEstimate, setShowEstimate] = useState(false);

  const estimate = useQuery({
    queryKey: ["admin", "lp-estimate", source],
    queryFn: () => admin.estimateLpDownloadSize(source),
    enabled: showEstimate,
  });
  const download = useMutation({
    mutationFn: () => admin.triggerLpDownload(source),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "map-infra"] }),
  });

  const downloading = data.status === "running";
  const sizeMib = data.size_bytes / 1024 / 1024;

  return (
    <div className="mt-2 border-t border-slate-800 pt-2 space-y-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">{t("admin.lp.localCache")}:</span>
        {data.cached ? (
          <span className="text-emerald-300">
            ✓ {data.tile_count} {t("admin.lp.tiles")} · {sizeMib.toFixed(1)} MiB
            {data.last_update && (
              <span className="text-slate-500 ml-1">
                ({new Date(data.last_update).toLocaleDateString()})
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-500">{t("admin.lp.notCached")}</span>
        )}
      </div>

      {downloading && data.status_message && (
        <p className="text-slate-300 font-mono break-words">
          {data.status_message}
        </p>
      )}
      {data.status === "error" && data.status_message && (
        <p className="text-rose-300 font-mono">{data.status_message}</p>
      )}

      {!showEstimate && !downloading && (
        <button
          type="button"
          onClick={() => setShowEstimate(true)}
          className="px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
          data-testid={`admin-lp-estimate-${source}`}
        >
          {data.cached
            ? t("admin.lp.redownload")
            : t("admin.lp.downloadBtn")}
        </button>
      )}

      {showEstimate && (
        <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2 space-y-1.5">
          {estimate.isLoading && (
            <p className="text-slate-400">{t("admin.lp.estimating")}</p>
          )}
          {estimate.data && (
            <>
              <p className="text-slate-200">
                {t("admin.lp.willDownload", {
                  tiles: estimate.data.total_tiles,
                  mib: (estimate.data.total_bytes_estimate / 1024 / 1024).toFixed(1),
                })}
              </p>
              <p className="text-slate-500">
                {t("admin.lp.bboxLabel", {
                  zoom_min: estimate.data.zoom_min,
                  zoom_max: estimate.data.zoom_max,
                })}
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    download.mutate();
                    setShowEstimate(false);
                  }}
                  disabled={download.isPending}
                  className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
                  data-testid={`admin-lp-download-${source}`}
                >
                  {t("admin.lp.confirmDownload")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEstimate(false)}
                  className="px-2 py-1 rounded-md ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </>
          )}
          {estimate.isError && (
            <p className="text-rose-300">{(estimate.error as Error)?.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function LpSourceOption({
  source,
  active,
  onSelect,
  disabled,
  extra,
}: {
  source: "black_marble_2016" | "viirs_dnb_latest";
  active: boolean;
  onSelect: () => void;
  disabled: boolean;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const sourceLink: Record<string, string> = {
    black_marble_2016:
      "https://earthobservatory.nasa.gov/features/NightLights",
    viirs_dnb_latest:
      "https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/#viirs",
  };
  return (
    <label
      className={`block rounded-md ring-1 p-3 cursor-pointer transition ${
        active
          ? "bg-indigo-950/40 ring-indigo-600/60"
          : "bg-slate-900/40 ring-slate-800 hover:ring-slate-700"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          name="lp-source"
          checked={active}
          onChange={onSelect}
          disabled={disabled}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-100">
              {t(`admin.lp.source.${source}.title`)}
            </span>
            {active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">
                {t("admin.active")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {t(`admin.lp.source.${source}.description`)}
          </p>
          <ul className="text-[11px] mt-2 space-y-0.5">
            <li className="text-emerald-300">
              + {t(`admin.lp.source.${source}.pros`)}
            </li>
            <li className="text-rose-300">
              − {t(`admin.lp.source.${source}.cons`)}
            </li>
            <li className="text-slate-500">
              <a
                href={sourceLink[source]}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-slate-300"
              >
                {t("admin.lp.sourceLink")}
              </a>
            </li>
          </ul>
          {extra}
        </div>
      </div>
    </label>
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
          title={
            data.pmtiles.size_bytes > 0 ? t("admin.pmtiles.refreshHint") : ""
          }
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
            title={t("admin.pmtiles.backToOsmHint")}
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

      {data.photon.live_progress && (
        <PhotonLiveProgress progress={data.photon.live_progress} />
      )}

      {(probing || hasError) && data.photon.status_message && (
        <p
          className={`text-xs ${
            hasError ? "text-rose-300" : "text-slate-300"
          } font-mono break-words`}
        >
          {data.photon.status_message}
        </p>
      )}

      {!data.photon.live_progress && (
        <p className="text-[11px] text-slate-500">{t("admin.photon.deployHint")}</p>
      )}

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
            title={t("admin.photon.backToNominatimHint")}
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

function PhotonLiveProgress({
  progress,
}: {
  progress: NonNullable<MapInfraOut["photon"]["live_progress"]>;
}) {
  if (progress.phase === "downloading" && progress.bytes_written && progress.total_bytes) {
    return (
      <LiveProgress
        bytesWritten={progress.bytes_written}
        totalBytes={progress.total_bytes}
      />
    );
  }
  const colour =
    progress.phase === "ready"
      ? "text-emerald-300"
      : progress.phase === "extracting" || progress.phase === "downloading"
        ? "text-amber-300"
        : progress.phase === "stopped"
          ? "text-rose-300"
          : "text-slate-300";
  return (
    <p className={`text-xs font-mono ${colour}`} data-testid="photon-live-progress">
      {progress.phase === "extracting" && "📦 "}
      {progress.phase === "ready" && "✓ "}
      {progress.label}
    </p>
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

function StorageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const fill =
    pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div>
      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden ring-1 ring-slate-800">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
        {formatBytes(used)} / {formatBytes(quota)}
        <span className="ml-1 text-slate-600">({pct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** ISO-3166 2-letter country code → Unicode flag emoji (CZ → 🇨🇿). */
function countryEmoji(code: string): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(
    A + code.toUpperCase().charCodeAt(0),
    A + code.toUpperCase().charCodeAt(1),
  );
}
