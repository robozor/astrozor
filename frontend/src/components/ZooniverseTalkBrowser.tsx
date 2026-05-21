import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  type ZooniverseTalkBoard,
  type ZooniverseTalkDiscussion,
  zooniverse,
} from "../lib/api";
import { MediaBrowser } from "./MediaBrowser";

// Talk content is read-only and rarely changes — cache aggressively
// so back/forward inside the browser is instant and re-mounting the
// widget (e.g. when switching between project pages) doesn't trigger
// a refetch storm. ``staleTime`` controls the "fresh" window before
// a background refetch; ``gcTime`` keeps the data around even when
// the component is unmounted, so coming back is also instant.
const TALK_QUERY_OPTS = {
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/**
 * Read-only Zooniverse Talk browser.
 *
 * Three nested view states inside one column:
 *
 *   boards  →  discussions in board  →  discussion detail (comments)
 *
 * Plus a special "subject view" branch when a discussion is focused
 * on a Zooniverse subject — the subject media is shown above the
 * thread, mirroring ``/talk/subjects/<id>`` on Zooniverse itself.
 *
 * Posting is not supported (no Zooniverse OAuth relay in Astrozor);
 * the "Reply on Zooniverse" CTA opens the official Talk UI in a
 * new tab so signed-in users can join the conversation upstream.
 */
type View =
  | { kind: "boards" }
  | { kind: "board"; board: ZooniverseTalkBoard; page: number }
  | { kind: "discussion"; discussionId: number; title: string; backToBoard: ZooniverseTalkBoard | null };

export function ZooniverseTalkBrowser({ zid }: { zid: number }) {
  const [view, setView] = useState<View>({ kind: "boards" });
  if (view.kind === "boards") {
    return (
      <BoardsView
        zid={zid}
        onPickBoard={(b) => setView({ kind: "board", board: b, page: 1 })}
      />
    );
  }
  if (view.kind === "board") {
    return (
      <BoardDiscussionsView
        board={view.board}
        page={view.page}
        onSetPage={(p) =>
          setView({ kind: "board", board: view.board, page: p })
        }
        onBack={() => setView({ kind: "boards" })}
        onPickDiscussion={(d) =>
          setView({
            kind: "discussion",
            discussionId: d.id,
            title: d.title,
            backToBoard: view.board,
          })
        }
      />
    );
  }
  return (
    <DiscussionDetailView
      discussionId={view.discussionId}
      title={view.title}
      onBack={() => {
        if (view.backToBoard) {
          setView({ kind: "board", board: view.backToBoard, page: 1 });
        } else {
          setView({ kind: "boards" });
        }
      }}
    />
  );
}

// -- Boards list ------------------------------------------------------------

function BoardsView({
  zid,
  onPickBoard,
}: {
  zid: number;
  onPickBoard: (b: ZooniverseTalkBoard) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const boardsQ = useQuery({
    queryKey: ["zoo-talk-boards", zid],
    queryFn: () => zooniverse.talkBoards(zid),
    ...TALK_QUERY_OPTS,
  });

  // Hover-prefetch the first page of discussions so clicking a board
  // is effectively instant. Cheap — fires at most once per (board)
  // per cache window thanks to React Query's dedup.
  const prefetchBoard = (boardId: number) => {
    qc.prefetchQuery({
      queryKey: ["zoo-talk-discussions", boardId, 1],
      queryFn: () => zooniverse.talkDiscussions(boardId, 1, 20),
      ...TALK_QUERY_OPTS,
    });
  };
  const boards = boardsQ.data?.boards ?? [];
  const sorted = [...boards].sort((a, b) => {
    if (a.subject_default !== b.subject_default) return a.subject_default ? -1 : 1;
    return b.comments_count - a.comments_count;
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          {t("citizen.talk.heading")}
        </div>
        {boardsQ.data?.talk_url && (
          <a
            href={boardsQ.data.talk_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition"
          >
            {t("citizen.talk.openOnZooniverse")} ↗
          </a>
        )}
      </div>
      <p className="text-[10px] text-slate-500 leading-snug">
        {t("citizen.talk.subtitle")}
      </p>
      {boardsQ.isLoading && (
        <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
      )}
      {boardsQ.isSuccess && sorted.length === 0 && (
        <p className="text-[11px] text-slate-500 italic">
          {t("citizen.talk.empty")}
        </p>
      )}
      <ul className="space-y-1.5">
        {sorted.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onPickBoard(b)}
              onMouseEnter={() => prefetchBoard(b.id)}
              onFocus={() => prefetchBoard(b.id)}
              className="w-full text-left block bg-slate-900/40 hover:bg-slate-900/80 ring-1 ring-slate-800 rounded p-2 transition"
              data-testid={`talk-board-${b.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-200 font-medium truncate">
                  {b.title}
                </span>
                {b.subject_default && (
                  <span className="text-[9px] bg-fuchsia-900/40 text-fuchsia-200 ring-1 ring-fuchsia-900/60 px-1 py-0.5 rounded">
                    {t("citizen.talk.subjectDefaultBadge")}
                  </span>
                )}
              </div>
              {b.description && (
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                  {b.description}
                </p>
              )}
              <div className="text-[10px] text-slate-500 font-mono mt-1 flex gap-2">
                <span>
                  {t("citizen.talk.discussions", { count: b.discussions_count })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {t("citizen.talk.comments", { count: b.comments_count })}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -- Board discussions list -------------------------------------------------

function BoardDiscussionsView({
  board,
  page,
  onSetPage,
  onBack,
  onPickDiscussion,
}: {
  board: ZooniverseTalkBoard;
  page: number;
  onSetPage: (p: number) => void;
  onBack: () => void;
  onPickDiscussion: (d: ZooniverseTalkDiscussion) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["zoo-talk-discussions", board.id, page],
    queryFn: () => zooniverse.talkDiscussions(board.id, page, 20),
    placeholderData: keepPreviousData,
    ...TALK_QUERY_OPTS,
  });
  const data = listQ.data;

  const prefetchDiscussion = (d: ZooniverseTalkDiscussion) => {
    qc.prefetchQuery({
      queryKey: ["zoo-talk-discussion", d.id, 1],
      queryFn: () => zooniverse.talkDiscussion(d.id, 1, 30),
      ...TALK_QUERY_OPTS,
    });
    if (d.focus_type === "Subject" && d.focus_id) {
      qc.prefetchQuery({
        queryKey: ["zoo-talk-subject-media", d.focus_id],
        queryFn: () => zooniverse.talkSubject(d.focus_id),
        ...TALK_QUERY_OPTS,
      });
    }
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
      >
        ← {t("citizen.talk.backToBoards")}
      </button>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-200">{board.title}</h4>
        <a
          href={board.talk_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition"
        >
          {t("citizen.talk.openOnZooniverse")} ↗
        </a>
      </div>
      {listQ.isLoading && (
        <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
      )}
      {data && data.items.length === 0 && (
        <p className="text-[11px] text-slate-500 italic">
          {t("citizen.talk.boardEmpty")}
        </p>
      )}
      <ul className="space-y-1.5">
        {(data?.items ?? []).map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onPickDiscussion(d)}
              onMouseEnter={() => prefetchDiscussion(d)}
              onFocus={() => prefetchDiscussion(d)}
              className="w-full text-left block bg-slate-900/40 hover:bg-slate-900/80 ring-1 ring-slate-800 rounded p-2 transition"
              data-testid={`talk-discussion-${d.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-200 font-medium truncate flex items-center gap-1.5">
                  {d.sticky && <span aria-hidden>📌</span>}
                  {d.locked && <span aria-hidden>🔒</span>}
                  {d.title}
                </span>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {d.comments_count}
                </span>
              </div>
              {d.latest_comment_excerpt && (
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                  {d.latest_comment_excerpt}
                </p>
              )}
              <div className="text-[10px] text-slate-500 font-mono mt-1 flex gap-2">
                <span>{d.user_login || "anon"}</span>
                <span aria-hidden>·</span>
                <span>
                  {new Date(d.last_comment_created_at).toLocaleDateString(
                    i18n.language,
                    { day: "numeric", month: "short", year: "numeric" },
                  )}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {data && data.page_count > 1 && (
        <Pager
          page={data.page}
          pageCount={data.page_count}
          onSetPage={onSetPage}
        />
      )}
    </div>
  );
}

// -- Discussion detail (comments + subject media if applicable) -------------

function DiscussionDetailView({
  discussionId,
  title,
  onBack,
}: {
  discussionId: number;
  title: string;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const detailQ = useQuery({
    queryKey: ["zoo-talk-discussion", discussionId, page],
    queryFn: () => zooniverse.talkDiscussion(discussionId, page, 30),
    placeholderData: keepPreviousData,
    ...TALK_QUERY_OPTS,
  });
  const d = detailQ.data;
  // When the thread is focused on a subject (the common Notes case)
  // we fetch the subject media so the discussion reads with full
  // visual context — that's what Zooniverse Talk does at /talk/subjects/<id>.
  const isSubjectFocused = d?.focus_type === "Subject" && d?.focus_id;
  const subjectQ = useQuery({
    queryKey: ["zoo-talk-subject-media", d?.focus_id],
    queryFn: () => zooniverse.talkSubject(d!.focus_id),
    enabled: !!isSubjectFocused,
    ...TALK_QUERY_OPTS,
  });
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
      >
        ← {t("citizen.talk.backToList")}
      </button>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-200 flex items-center gap-1.5 flex-wrap">
          {d?.sticky && <span aria-hidden>📌</span>}
          {d?.locked && <span aria-hidden>🔒</span>}
          {d?.title || title}
        </h4>
        {d?.talk_url && (
          <a
            href={d.talk_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition shrink-0"
          >
            {t("citizen.talk.replyOnZooniverse")} ↗
          </a>
        )}
      </div>
      {isSubjectFocused && subjectQ.data && (
        <div className="bg-slate-950/60 ring-1 ring-fuchsia-900/40 rounded-md p-2 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/70">
            {t("citizen.talk.subjectFocus", { id: d.focus_id })}
          </div>
          <MediaBrowser
            media={subjectQ.data.subject.media}
            locations={subjectQ.data.subject.locations}
            size="lg"
            alt={`Subject #${d.focus_id}`}
          />
          <div className="flex flex-wrap gap-1.5">
            {subjectQ.data.subject.classify_url && (
              <a
                href={subjectQ.data.subject.classify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition"
              >
                🔭 {t("citizen.sprints.chat.subjectClassify")}
              </a>
            )}
            {subjectQ.data.subject.talk_url && (
              <a
                href={subjectQ.data.subject.talk_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-2 py-0.5 rounded transition"
              >
                💬 {t("citizen.sprints.chat.subjectTalk")}
              </a>
            )}
          </div>
        </div>
      )}
      {detailQ.isLoading && (
        <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
      )}
      {d && d.comments.length === 0 && (
        <p className="text-[11px] text-slate-500 italic">
          {t("citizen.talk.noComments")}
        </p>
      )}
      <ul className="space-y-2">
        {(d?.comments ?? []).map((c) => (
          <li
            key={c.id}
            className="bg-slate-900/60 ring-1 ring-slate-800 rounded p-2 space-y-1"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="text-slate-200 font-medium">
                {c.user_display_name || c.user_login || "anon"}
              </span>
              <span>
                {new Date(c.created_at).toLocaleString(i18n.language, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div
              className="text-xs text-slate-200 prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_a]:text-indigo-300 [&_a]:underline [&_img]:max-w-full [&_img]:my-1 [&_img]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-slate-700 [&_blockquote]:pl-2"
              /* Server-sanitised via bleach inside the backend's
                  Talk render pipeline. */
              dangerouslySetInnerHTML={{ __html: c.body_html }}
            />
            {c.upvotes > 0 && (
              <div className="text-[10px] text-slate-500">▲ {c.upvotes}</div>
            )}
          </li>
        ))}
      </ul>
      {d && d.comments_page_count > 1 && (
        <Pager
          page={d.comments_page}
          pageCount={d.comments_page_count}
          onSetPage={setPage}
        />
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onSetPage,
}: {
  page: number;
  pageCount: number;
  onSetPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onSetPage(page - 1)}
        className="text-[11px] text-slate-400 hover:text-slate-200 disabled:text-slate-700 disabled:cursor-not-allowed"
      >
        ← {t("common.previous")}
      </button>
      <span className="text-[10px] text-slate-500 font-mono">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onSetPage(page + 1)}
        className="text-[11px] text-slate-400 hover:text-slate-200 disabled:text-slate-700 disabled:cursor-not-allowed"
      >
        {t("common.next")} →
      </button>
    </div>
  );
}
