import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { users, type UserListItem } from "../lib/api";

/**
 * Dual-list user picker for the allowlist mode of VisibilityPicker.
 *
 * Two side-by-side panes:
 *   - Left:  all active system users (search filter at the top)
 *   - Right: users currently on the allowlist
 *
 * Interactions:
 *   - Double-click a row → moves to the other pane
 *   - Drag a row from one pane → drop on the other pane to add/remove
 *
 * Owner of the entity stays implicit (they always have access via
 * `can_view`), so we exclude them from the left pane if known.
 */
export function UserAllowlistPicker({
  selectedEmails,
  onChange,
  ownerEmail,
}: {
  selectedEmails: string[];
  onChange: (emails: string[]) => void;
  ownerEmail?: string | undefined;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  // Server-side search — debounce-less because the list is small in
  // practice (a few hundred users max). React Query caches by ?q=...
  // so repeated typing of the same prefix is free after the first hit.
  const listQ = useQuery({
    queryKey: ["users-list", search],
    queryFn: () => users.list(search),
    staleTime: 30_000,
  });

  const all: UserListItem[] = listQ.data ?? [];
  const selectedSet = useMemo(
    () => new Set(selectedEmails.map((e) => e.toLowerCase())),
    [selectedEmails],
  );

  // Left pane = users not yet on the allowlist (and not the owner —
  // they always have access so showing them would be misleading).
  const leftItems = useMemo(
    () =>
      all.filter(
        (u) =>
          !selectedSet.has(u.email.toLowerCase()) &&
          (!ownerEmail || u.email.toLowerCase() !== ownerEmail.toLowerCase()),
      ),
    [all, selectedSet, ownerEmail],
  );

  // Right pane = currently selected. Hydrate display info from `all`
  // when we have it (display name + avatar); otherwise fall back to a
  // bare row showing just the email. This covers the case where the
  // allowlist contains a user whose email is outside the 500-row cap
  // of the left-pane query.
  const rightItems: UserListItem[] = useMemo(() => {
    const byEmail = new Map(all.map((u) => [u.email.toLowerCase(), u]));
    return selectedEmails.map((email) => {
      const hit = byEmail.get(email.toLowerCase());
      if (hit) return hit;
      return {
        email,
        display_name: email.split("@")[0] ?? email,
        avatar_url: "",
      };
    });
  }, [all, selectedEmails]);

  const add = (email: string) => {
    if (selectedSet.has(email.toLowerCase())) return;
    onChange([...selectedEmails, email]);
  };
  const remove = (email: string) => {
    onChange(
      selectedEmails.filter((e) => e.toLowerCase() !== email.toLowerCase()),
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <UserPane
        title={t("visibility.picker.available")}
        items={leftItems}
        loading={listQ.isLoading}
        searchValue={search}
        onSearch={setSearch}
        onActivate={add}
        onDropEmail={(email) => remove(email)}
        sourceLabel="available"
        emptyHint={t("visibility.picker.availableEmpty")}
        testid="allowlist-available"
      />
      <UserPane
        title={t("visibility.picker.granted")}
        items={rightItems}
        loading={false}
        onActivate={remove}
        onDropEmail={(email) => add(email)}
        sourceLabel="granted"
        emptyHint={t("visibility.picker.grantedEmpty")}
        testid="allowlist-granted"
      />
    </div>
  );
}

function UserPane({
  title,
  items,
  loading,
  searchValue,
  onSearch,
  onActivate,
  onDropEmail,
  sourceLabel,
  emptyHint,
  testid,
}: {
  title: string;
  items: UserListItem[];
  loading: boolean;
  searchValue?: string;
  onSearch?: (v: string) => void;
  onActivate: (email: string) => void;
  onDropEmail: (email: string) => void;
  sourceLabel: "available" | "granted";
  emptyHint: string;
  testid: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className="flex flex-col bg-slate-950 ring-1 ring-slate-700 rounded-md overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        // Only accept drops that originated in the OTHER pane to avoid
        // moving items within the same list (no-op).
        const data = e.dataTransfer.getData("text/astrozor-user");
        if (!data) return;
        try {
          const payload = JSON.parse(data) as { email: string; source: string };
          if (payload.source !== sourceLabel && payload.email) {
            onDropEmail(payload.email);
          }
        } catch {
          /* ignore malformed payload */
        }
      }}
      data-testid={testid}
    >
      <header className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900 border-b border-slate-800">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {items.length}
        </span>
      </header>
      {onSearch !== undefined && (
        <div className="px-2 py-1.5 border-b border-slate-800">
          <input
            type="search"
            value={searchValue ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="🔍 hledat…"
            className="w-full bg-slate-950 ring-1 ring-slate-800 focus:ring-slate-600 rounded px-2 py-1 text-xs text-slate-100 outline-none"
            data-testid={`${testid}-search`}
          />
        </div>
      )}
      <ul
        className={`flex-1 min-h-[8rem] max-h-[14rem] overflow-y-auto dark-scroll transition ${
          dragOver ? "bg-indigo-950/30 ring-1 ring-indigo-500 ring-inset" : ""
        }`}
      >
        {loading && (
          <li className="text-xs text-slate-500 px-3 py-4 text-center">…</li>
        )}
        {!loading && items.length === 0 && (
          <li className="text-xs text-slate-500 px-3 py-4 text-center italic">
            {emptyHint}
          </li>
        )}
        {items.map((u) => (
          <li
            key={u.email}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "text/astrozor-user",
                JSON.stringify({ email: u.email, source: sourceLabel }),
              );
              e.dataTransfer.effectAllowed = "move";
            }}
            onDoubleClick={() => onActivate(u.email)}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-900 cursor-grab active:cursor-grabbing border-b border-slate-900 last:border-b-0"
            data-testid={`${testid}-row-${u.email}`}
            title={u.email}
          >
            <div className="w-6 h-6 rounded-full bg-slate-800 ring-1 ring-slate-700 overflow-hidden flex items-center justify-center text-[10px] text-slate-400 shrink-0">
              {u.avatar_url ? (
                <img
                  src={u.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                (u.display_name || u.email).charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-slate-100">{u.display_name}</p>
              <p className="truncate text-[10px] text-slate-500 font-mono">
                {u.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onActivate(u.email)}
              className="text-slate-500 hover:text-slate-200 text-sm leading-none px-1"
              aria-label={sourceLabel === "available" ? "Přidat" : "Odebrat"}
              tabIndex={-1}
            >
              {sourceLabel === "available" ? "→" : "←"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
