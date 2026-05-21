import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  campaigns,
  zooniverse,
  type Campaign,
  type Contribution,
  type Me,
} from "../lib/api";
import { DateTimePicker } from "./DateTimePicker";
import { TagFilter, TagInput, TagsList } from "./Tags";

type View = { kind: "list" } | { kind: "detail"; slug: string } | { kind: "new" };

export function CampaignsPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "detail") {
    return <CampaignDetail slug={view.slug} me={me} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "new") {
    return (
      <CampaignEditor
        onDone={(slug) => setView({ kind: "detail", slug })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }
  return (
    <CampaignList
      onOpen={(slug) => setView({ kind: "detail", slug })}
      onNew={() => setView({ kind: "new" })}
    />
  );
}

function CampaignList({
  onOpen,
  onNew,
}: {
  onOpen: (slug: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => campaigns.list() });
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const filtered = (list.data ?? []).filter((c) => {
    if (tagFilter.length === 0) return true;
    const tagSet = new Set((c.tags ?? []).map((t) => t.toLowerCase()));
    return tagFilter.every((t) => tagSet.has(t.toLowerCase()));
  });

  return (
    <section data-testid="campaigns-list">
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-xl font-semibold">{t("campaigns.title")}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <TagFilter kind="campaigns" selected={tagFilter} onChange={setTagFilter} />
          <button
            type="button"
            onClick={onNew}
            data-testid="campaign-new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-md transition"
          >
            {t("campaigns.new")}
          </button>
        </div>
      </header>

      {list.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {list.isSuccess && list.data.length === 0 && (
        <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">{t("campaigns.empty")}</p>
          <p className="text-slate-500 text-xs mt-2">{t("campaigns.emptyHint")}</p>
        </div>
      )}

      <ul className="space-y-3">
        {filtered.map((c) => (
          <li
            key={c.id}
            className="bg-slate-950/60 ring-1 ring-slate-800 hover:ring-slate-700 rounded-xl p-4 cursor-pointer transition"
            onClick={() => onOpen(c.slug)}
            data-testid={`campaign-card-${c.slug}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-slate-100 truncate">{c.title}</h3>
                <p className="text-xs text-slate-500">
                  {c.project_slug} · {t("campaigns.coordinator")}: {c.coordinator_email}
                </p>
              </div>
              <div className="text-xs text-slate-500 flex flex-col items-end gap-1 shrink-0">
                <span className="font-mono">{c.status}</span>
                <span>
                  {c.accepted_count} / {c.contribution_count} ✓
                </span>
              </div>
            </div>
            {c.description && (
              <p className="text-sm text-slate-400 mt-2 line-clamp-2">{c.description}</p>
            )}
            {c.tags && c.tags.length > 0 && (
              <div className="mt-2">
                <TagsList tags={c.tags} size="xs" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CampaignDetail({
  slug,
  me,
  onBack,
}: {
  slug: string;
  me: Me;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const campaign = useQuery({ queryKey: ["campaign", slug], queryFn: () => campaigns.get(slug) });
  const contributions = useQuery({
    queryKey: ["contributions", slug],
    queryFn: () => campaigns.contributions(slug),
  });

  const isCoordinator = campaign.data?.coordinator_email === me.user.email;

  return (
    <section data-testid="campaign-detail">
      <button
        type="button"
        onClick={onBack}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.back")}
      </button>

      {campaign.isLoading && <p className="text-slate-500 text-sm">{t("common.loading")}</p>}
      {campaign.isSuccess && (
        <article className="space-y-4">
          <header>
            <h2 className="text-2xl font-semibold text-slate-100">{campaign.data.title}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {campaign.data.project_slug} ·{" "}
              <span className="font-mono">{campaign.data.status}</span> ·{" "}
              {t("campaigns.coordinator")}: {campaign.data.coordinator_email}
            </p>
          </header>

          {campaign.data.description && (
            <p className="text-slate-300 whitespace-pre-wrap">{campaign.data.description}</p>
          )}
          {campaign.data.methodology && (
            <div>
              <h3 className="font-medium text-slate-200 text-sm mb-1">
                {t("campaigns.methodology")}
              </h3>
              <p className="text-slate-400 text-sm whitespace-pre-wrap">
                {campaign.data.methodology}
              </p>
            </div>
          )}

          {campaign.data.status === "open" && (
            <ContributionForm campaignSlug={slug} schema={campaign.data.contribution_schema} />
          )}

          <div>
            <h3 className="font-medium text-slate-200 mb-2">
              {t("campaigns.contributions")} ({contributions.data?.length ?? 0})
            </h3>
            <ul className="space-y-2">
              {contributions.data?.map((co) => (
                <ContributionCard
                  key={co.id}
                  contribution={co}
                  canReview={isCoordinator}
                  campaignSlug={slug}
                />
              ))}
            </ul>
            {contributions.isSuccess && contributions.data.length === 0 && (
              <p className="text-slate-500 text-sm">{t("campaigns.noContributions")}</p>
            )}
          </div>
        </article>
      )}
    </section>
  );
}

function ContributionForm({
  campaignSlug,
  schema,
}: {
  campaignSlug: string;
  schema: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [dataJson, setDataJson] = useState(
    Object.keys(schema).length > 0 ? JSON.stringify(schema, null, 2) : "{}",
  );
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(dataJson);
      } catch {
        // Submit empty if invalid — server will reject if it cares
      }
      return campaigns.submit(campaignSlug, { title, data: parsed, comment });
    },
    onSuccess: () => {
      setTitle("");
      setComment("");
      qc.invalidateQueries({ queryKey: ["contributions", campaignSlug] });
      qc.invalidateQueries({ queryKey: ["campaign", campaignSlug] });
    },
  });

  return (
    <form
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) submit.mutate();
      }}
    >
      <h3 className="font-medium text-slate-200 text-sm">{t("campaigns.submitContribution")}</h3>
      <label className="block">
        <span className="text-xs text-slate-400 mb-1 block">{t("campaigns.field.title")}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-sm text-slate-100 outline-none transition"
          data-testid="contribution-title"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400 mb-1 block">{t("campaigns.field.data")}</span>
        <textarea
          value={dataJson}
          onChange={(e) => setDataJson(e.target.value)}
          rows={6}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-xs font-mono text-slate-100 outline-none transition"
          data-testid="contribution-data"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400 mb-1 block">{t("campaigns.field.comment")}</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-sm text-slate-100 outline-none transition"
        />
      </label>
      {submit.error && (
        <p className="text-xs text-rose-400">{(submit.error as Error).message}</p>
      )}
      <button
        type="submit"
        disabled={submit.isPending || !title.trim()}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-3 py-1.5 rounded-md transition"
        data-testid="contribution-submit"
      >
        {submit.isPending ? "…" : t("campaigns.submit")}
      </button>
    </form>
  );
}

function ContributionCard({
  contribution,
  canReview,
  campaignSlug,
}: {
  contribution: Contribution;
  canReview: boolean;
  campaignSlug: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reviewComment, setReviewComment] = useState(contribution.review_comment);

  const review = useMutation({
    mutationFn: (status: "accepted" | "rejected" | "needs_revision") =>
      campaigns.review(contribution.id, { status, review_comment: reviewComment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contributions", campaignSlug] });
      qc.invalidateQueries({ queryKey: ["campaign", campaignSlug] });
    },
  });

  const statusColor: Record<Contribution["status"], string> = {
    submitted: "text-sky-400",
    accepted: "text-emerald-400",
    rejected: "text-rose-400",
    needs_revision: "text-amber-400",
  };

  return (
    <li
      className="bg-slate-950/60 ring-1 ring-slate-800 rounded-xl p-3"
      data-testid={`contribution-${contribution.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-100 truncate">{contribution.title}</p>
          <p className="text-xs text-slate-500">
            {contribution.user_display_name} ·{" "}
            {new Date(contribution.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`text-xs font-mono shrink-0 ${statusColor[contribution.status]}`}>
          {contribution.status}
        </span>
      </div>
      {contribution.comment && (
        <p className="text-xs text-slate-400 mt-1">{contribution.comment}</p>
      )}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-slate-500 hover:text-slate-300 mt-1"
      >
        {expanded ? "▾" : "▸"} {t("campaigns.dataLabel")}
      </button>
      {expanded && (
        <pre className="text-xs font-mono bg-slate-900 rounded p-2 mt-1 overflow-auto text-slate-300">
          {JSON.stringify(contribution.data, null, 2)}
        </pre>
      )}
      {contribution.review_comment && (
        <p className="text-xs text-slate-400 mt-2 italic">
          {t("campaigns.reviewComment")}: {contribution.review_comment}
        </p>
      )}
      {canReview && contribution.status === "submitted" && (
        <div className="mt-2 space-y-2">
          <textarea
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            placeholder={t("campaigns.reviewCommentPlaceholder")}
            rows={2}
            className="w-full bg-slate-900 ring-1 ring-slate-700 rounded-md px-2 py-1 text-xs text-slate-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => review.mutate("accepted")}
              disabled={review.isPending}
              className="text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-2 py-1 rounded-md transition"
            >
              ✓ {t("campaigns.accept")}
            </button>
            <button
              type="button"
              onClick={() => review.mutate("needs_revision")}
              disabled={review.isPending}
              className="text-xs bg-amber-800 hover:bg-amber-700 text-amber-100 px-2 py-1 rounded-md transition"
            >
              ↻ {t("campaigns.needsRevision")}
            </button>
            <button
              type="button"
              onClick={() => review.mutate("rejected")}
              disabled={review.isPending}
              className="text-xs bg-rose-800 hover:bg-rose-700 text-rose-100 px-2 py-1 rounded-md transition"
            >
              ✗ {t("campaigns.reject")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function CampaignEditor({
  onDone,
  onCancel,
}: {
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [projectSlug, setProjectSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [methodology, setMethodology] = useState("");
  const [kind, setKind] = useState("observation");
  const [schemaJson, setSchemaJson] = useState('{\n  "target_object": "",\n  "magnitude": 0\n}');
  const [tags, setTags] = useState<string[]>([]);
  // Date range — campaign as a time-boxed sprint. Optional; an empty
  // value means "ongoing" / no fixed end.
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // Optional Zooniverse linkage. When set, the campaign appears on the
  // matching project detail under "Astrozor campaigns for this project"
  // and lands on the events calendar.
  const [zooniverseZid, setZooniverseZid] = useState<number | null>(null);
  const [zooniverseWorkflowId, setZooniverseWorkflowId] = useState<number | null>(null);

  const zooProjects = useQuery({
    queryKey: ["zooniverse-projects"],
    queryFn: () => zooniverse.listProjects(false),
    staleTime: 5 * 60_000,
  });

  // Workflows for the currently selected project. Filter to active
  // ones because campaigns target whatever's currently runnable.
  const activeWorkflows = useMemo(() => {
    if (!zooniverseZid) return [];
    const p = (zooProjects.data ?? []).find((x) => x.zooniverse_id === zooniverseZid);
    return (p?.workflows ?? []).filter((w) => w.active);
  }, [zooniverseZid, zooProjects.data]);

  const create = useMutation({
    mutationFn: () => {
      let schema: Record<string, unknown> = {};
      try {
        schema = JSON.parse(schemaJson);
      } catch {
        schema = {};
      }
      return campaigns.create({
        project_slug: projectSlug.trim(),
        title,
        description,
        methodology,
        kind,
        contribution_schema: schema,
        tags,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        zooniverse_project_zid: zooniverseZid,
        zooniverse_workflow_id: zooniverseWorkflowId,
      });
    },
    onSuccess: (c: Campaign) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      onDone(c.slug);
    },
  });

  return (
    <section data-testid="campaign-editor">
      <button
        type="button"
        onClick={onCancel}
        className="text-slate-400 hover:text-slate-200 text-sm mb-3"
      >
        ← {t("common.cancel")}
      </button>
      <h2 className="text-xl font-semibold mb-4">{t("campaigns.new")}</h2>
      <form
        className="space-y-3 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && projectSlug.trim()) create.mutate();
        }}
      >
        <Input
          label={t("campaigns.field.projectSlug")}
          value={projectSlug}
          onChange={setProjectSlug}
          required
          placeholder="my-project"
        />
        <Input
          label={t("campaigns.field.title")}
          value={title}
          onChange={setTitle}
          required
          testId="campaign-title"
        />
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("campaigns.field.description")}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("campaigns.field.methodology")}
          </span>
          <textarea
            value={methodology}
            onChange={(e) => setMethodology(e.target.value)}
            rows={3}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">{t("campaigns.field.kind")}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
          >
            <option value="observation">observation</option>
            <option value="photometry">photometry</option>
            <option value="meteor_count">meteor_count</option>
            <option value="sky_quality">sky_quality</option>
            <option value="generic">generic</option>
          </select>
        </label>

        {/* Date range — from / to. Empty = ongoing. Used by the
            calendar dot and "Astrozor campaigns for this project"
            listings on the Zooniverse project detail. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">
              {t("campaigns.field.startsAt")}
            </span>
            <DateTimePicker
              value={startsAt}
              onChange={setStartsAt}
              testId="campaign-starts"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">
              {t("campaigns.field.endsAt")}
            </span>
            <DateTimePicker
              value={endsAt}
              onChange={setEndsAt}
              testId="campaign-ends"
            />
          </label>
        </div>

        {/* Zooniverse linkage — optional. Dropdown of catalogued
            projects (loaded via the same query the grid uses, so it's
            already cached on a typical navigation). Workflow picker
            depends on the chosen project. */}
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("campaigns.field.zooniverseProject")}
          </span>
          <select
            value={zooniverseZid ?? ""}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : null;
              setZooniverseZid(Number.isFinite(v) ? v : null);
              setZooniverseWorkflowId(null);
            }}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
            data-testid="campaign-zooniverse-project"
          >
            <option value="">{t("campaigns.field.zooniverseProjectNone")}</option>
            {(zooProjects.data ?? []).map((p) => (
              <option key={p.zooniverse_id} value={p.zooniverse_id}>
                {p.title} (#{p.zooniverse_id})
              </option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 mt-1 block">
            {t("campaigns.field.zooniverseProjectHint")}
          </span>
        </label>

        {zooniverseZid !== null && activeWorkflows.length > 0 && (
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">
              {t("campaigns.field.zooniverseWorkflow")}
            </span>
            <select
              value={zooniverseWorkflowId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? parseInt(e.target.value, 10) : null;
                setZooniverseWorkflowId(Number.isFinite(v) ? v : null);
              }}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
              data-testid="campaign-zooniverse-workflow"
            >
              <option value="">{t("campaigns.field.zooniverseWorkflowAny")}</option>
              {activeWorkflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.display_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">
            {t("campaigns.field.schema")}
          </span>
          <textarea
            value={schemaJson}
            onChange={(e) => setSchemaJson(e.target.value)}
            rows={5}
            className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-xs font-mono text-slate-100 outline-none transition"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">🏷 Tagy</span>
          <TagInput value={tags} onChange={setTags} />
        </label>
        {create.error && (
          <p className="text-xs text-rose-400 bg-rose-950/40 ring-1 ring-rose-900/50 rounded-md px-3 py-2">
            {(create.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending || !title.trim() || !projectSlug.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-4 py-2 rounded-md transition"
          data-testid="campaign-create"
        >
          {create.isPending ? "…" : t("campaigns.create")}
        </button>
      </form>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition"
      />
    </label>
  );
}
