import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * Shared tag widgets used by all four tagged agendas (Articles, Events,
 * Campaigns, Projects). Tags are free-form strings; the backend uses
 * django-taggit (M2M shared `Tag` table) so the same suggestion endpoint
 * works for every agenda.
 *
 * Components:
 *  - `<TagsList />`      read-only chip row (cards, detail headers)
 *  - `<TagInput />`      editor input with autosuggest + Enter to add
 *  - `<TagFilter />`     multi-select filter for list pages
 */

type TagSuggestion = { name: string; slug: string; count: number };
type Kind = "articles" | "events" | "campaigns" | "projects";

async function fetchTags(kind: Kind | undefined, q: string | undefined): Promise<TagSuggestion[]> {
  const search = new URLSearchParams();
  if (kind) search.set("kind", kind);
  if (q) search.set("q", q);
  search.set("limit", "30");
  return api.get<TagSuggestion[]>(`/tags?${search.toString()}`);
}

/* ---------- read-only chip row ---------- */

export function TagsList({
  tags,
  onClick,
  size = "sm",
}: {
  tags: string[];
  onClick?: (tag: string) => void;
  size?: "sm" | "xs";
}) {
  if (!tags || tags.length === 0) return null;
  const cls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0.5"
      : "text-xs px-2 py-0.5";
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          onClick={onClick ? (e) => { e.stopPropagation(); onClick(t); } : undefined}
          className={`${cls} rounded-full bg-indigo-900/40 ring-1 ring-indigo-700/50 text-indigo-200 ${
            onClick ? "cursor-pointer hover:bg-indigo-900/60" : ""
          }`}
        >
          #{t}
        </span>
      ))}
    </div>
  );
}

/* ---------- editor input ---------- */

export function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);

  // Suggestions: the GLOBAL tag list (no `kind` filter) so a tag
  // someone created on an article shows up when tagging a project.
  // Shared dictionary across all four tagged agendas — django-taggit
  // backs every TaggableManager with one `Tag` table.
  const sug = useQuery({
    queryKey: ["tags", "all", draft],
    queryFn: () => fetchTags(undefined, draft.trim() || undefined),
    enabled: open,
    staleTime: 30_000,
  });

  function add(name: string) {
    const clean = name.trim().toLowerCase();
    if (!clean) return;
    if (value.includes(clean)) {
      setDraft("");
      return;
    }
    onChange([...value, clean]);
    setDraft("");
  }
  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  // Filter suggestions: already-picked tags shouldn't show.
  const suggestions = (sug.data ?? []).filter((s) => !value.includes(s.name));

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1 bg-slate-950 ring-1 ring-slate-700 focus-within:ring-slate-500 rounded-md px-2 py-1.5 cursor-text"
        onClick={() => ref.current?.focus()}
      >
        {value.map((t) => (
          <span
            key={t}
            className="text-xs bg-indigo-900/60 ring-1 ring-indigo-700 text-indigo-100 rounded-full pl-2 pr-1 py-0.5 flex items-center gap-1"
          >
            #{t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="text-indigo-300 hover:text-white text-[10px] px-1"
              aria-label={`remove ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={ref}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1]!);
            }
          }}
          placeholder={value.length === 0 ? placeholder ?? "Přidej tagy (Enter)" : ""}
          className="flex-1 min-w-[120px] bg-transparent text-slate-100 text-sm outline-none"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-slate-950 ring-1 ring-slate-700 rounded-md max-h-48 overflow-y-auto shadow-xl">
          {suggestions.slice(0, 12).map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // mousedown so it fires before the input's blur
                  e.preventDefault();
                  add(s.name);
                }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-900 text-slate-200 flex justify-between items-center"
              >
                <span>#{s.name}</span>
                <span className="text-slate-500 text-[10px]">{s.count}×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- list filter ---------- */

export function TagFilter({
  selected,
  onChange,
  kind,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  kind: Kind;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sug = useQuery({
    queryKey: ["tags", kind, query],
    queryFn: () => fetchTags(kind, query.trim() || undefined),
    enabled: open,
    staleTime: 30_000,
  });

  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((x) => x !== name));
    else onChange([...selected, name]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="tag-filter-toggle"
        className={`text-xs px-2.5 py-1.5 rounded ring-1 transition flex items-center gap-1 ${
          selected.length > 0
            ? "bg-indigo-600 ring-indigo-500 text-white"
            : "bg-slate-900 ring-slate-700 text-slate-300 hover:bg-slate-800"
        }`}
      >
        🏷 Tagy {selected.length > 0 && `(${selected.length})`}
      </button>
      {selected.length > 0 && (
        <span className="ml-1 inline-flex gap-1">
          {selected.map((t) => (
            <span
              key={t}
              className="text-[10px] bg-indigo-900/60 ring-1 ring-indigo-700 text-indigo-100 rounded-full pl-1.5 pr-0.5 py-0.5 inline-flex items-center gap-1"
            >
              #{t}
              <button
                type="button"
                onClick={() => toggle(t)}
                className="text-indigo-300 hover:text-white px-1"
                aria-label={`remove ${t}`}
              >
                ✕
              </button>
            </span>
          ))}
        </span>
      )}
      {open && (
        <div className="absolute z-20 right-0 mt-1 w-64 bg-slate-950 ring-1 ring-slate-700 rounded-md shadow-xl p-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat tagy…"
            className="w-full bg-slate-900 ring-1 ring-slate-800 rounded px-2 py-1 text-xs text-slate-100 mb-2"
            autoFocus
          />
          {sug.isLoading && (
            <p className="text-[11px] text-slate-500 px-2 py-1">Načítám…</p>
          )}
          {sug.data?.length === 0 && (
            <p className="text-[11px] text-slate-500 px-2 py-1 italic">
              Žádné tagy
            </p>
          )}
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {(sug.data ?? []).map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => toggle(s.name)}
                  className={`w-full text-left text-xs px-2 py-1 rounded flex justify-between items-center ${
                    selected.includes(s.name)
                      ? "bg-indigo-900/60 text-indigo-100"
                      : "text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  <span>
                    {selected.includes(s.name) && "✓ "}#{s.name}
                  </span>
                  <span className="text-slate-500 text-[10px]">{s.count}×</span>
                </button>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 text-[11px] text-rose-400 hover:text-rose-300 w-full text-left px-2"
            >
              Smazat výběr
            </button>
          )}
        </div>
      )}
    </div>
  );
}
