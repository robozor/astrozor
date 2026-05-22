import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications, type Notification } from "../lib/api";

export function NotificationsBell({ onOpenLink }: { onOpenLink?: (link: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Refetch every 15 s so the bell stays current without WebSocket.
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notifications.list({ limit: 20 }),
    refetchInterval: 15_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => notifications.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => notifications.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = list.data?.unread_count ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="notifications-bell"
        aria-label="Notifications"
        className="relative p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            data-testid="notifications-unread-count"
            className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notifications-dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] overflow-y-auto bg-slate-900 ring-1 ring-slate-700 rounded-lg shadow-xl z-40"
        >
          <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800 sticky top-0 bg-slate-900">
            <h3 className="text-sm font-medium">{t("notifications.title")}</h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </header>

          {list.isLoading && (
            <p className="px-4 py-6 text-xs text-slate-500">{t("common.loading")}</p>
          )}
          {list.isSuccess && list.data.items.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-slate-500">
              {t("notifications.empty")}
            </p>
          )}

          <ul>
            {list.data?.items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onClick={() => {
                  markOne.mutate(n.id);
                  if (onOpenLink && n.link) onOpenLink(n.link);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, onClick }: { n: Notification; onClick: () => void }) {
  const isUnread = n.read_at === null;
  const time = new Date(n.created_at).toLocaleString();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-4 py-3 hover:bg-slate-800/60 border-b border-slate-800 last:border-0 transition ${
          isUnread ? "bg-indigo-950/30" : ""
        }`}
      >
        <div className="flex items-start gap-2">
          {isUnread && (
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate font-medium">{n.title}</p>
            {n.body && <p className="text-xs text-slate-400 line-clamp-2 mt-0.5">{n.body}</p>}
            <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-wide">
              {n.kind} · {time}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
