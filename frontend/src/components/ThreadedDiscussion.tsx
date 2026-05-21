import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  uploads,
  type ChatAttachment,
  type Me,
} from "../lib/api";
import { ChatRichEditor } from "./ChatRichEditor";
import { TimeDisplay } from "./TimeDisplay";
import { UserNameLink } from "./UserNameLink";

/** A minimal "message-like" item that fits both place-chat messages and
 * article comments. The parent component normalizes whichever backend
 * type it has into this shape before passing to `<ThreadedDiscussion>`. */
export type ThreadedItem = {
  id: string;
  parent_id: string | null;
  user_display_name: string;
  user_email: string;
  text: string;
  attachments: ChatAttachment[];
  created_at: string;
};

type Node = ThreadedItem & { children: Node[] };

function buildTree(items: ThreadedItem[]): Node[] {
  const byId = new Map<string, Node>();
  for (const m of items) byId.set(m.id, { ...m, children: [] });
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const YT_RE =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,32})/i;

function extractYouTubeId(url: string): string | null {
  const m = url.trim().match(YT_RE);
  return m && m[1] ? m[1] : null;
}

function isHtmlEmpty(html: string) {
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return stripped.length === 0;
}

/** Shared threaded-discussion UI used by:
 *  - PlaceDetailPanel chat (place-scoped messages)
 *  - ArticleDetail comments (article-scoped comments)
 *
 * Both surfaces share: tree rendering, reply-to, rich-text composer
 * (ChatRichEditor), inline media attachments (image upload / video
 * upload / YouTube link), and the same backend allowlist + length
 * limit (MapInfra.chat_text_max_length).
 *
 * Caller provides `onPost` and `queryKey` so this component stays
 * agnostic about whether it's writing chat messages or article comments.
 */
export function ThreadedDiscussion({
  items,
  me,
  queryKey,
  onPost,
  onDelete,
  emptyLabel,
  testidPrefix = "thread",
  entityTimezone,
}: {
  items: ThreadedItem[];
  me: Me | null;
  /** Query key to invalidate after successful post/delete */
  queryKey: unknown[];
  onPost: (body: {
    text: string;
    attachments: ChatAttachment[];
    parent_id: string | null;
  }) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  emptyLabel: string;
  testidPrefix?: string;
  /** IANA TZ of the host entity (place / event) — when set, message
   * timestamps render a "Local" row next to UTC + user. Article
   * comments leave this undefined since articles aren't location-bound. */
  entityTimezone?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<ThreadedItem | null>(null);
  const tree = useMemo(() => buildTree(items), [items]);

  const onPosted = () => {
    setReplyTo(null);
    qc.invalidateQueries({ queryKey });
  };

  return (
    <div className="flex flex-col h-full min-h-[20rem]">
      <ul
        className="flex-1 overflow-y-auto dark-scroll space-y-3 pr-1 mb-3"
        data-testid={`${testidPrefix}-list`}
      >
        {tree.length === 0 && (
          <li className="text-xs text-slate-500 text-center py-8">{emptyLabel}</li>
        )}
        {tree.map((node) => (
          <ItemNode
            key={node.id}
            node={node}
            depth={0}
            me={me}
            onReply={(m) => setReplyTo(m)}
            onDelete={onDelete}
            testidPrefix={testidPrefix}
            entityTimezone={entityTimezone}
          />
        ))}
      </ul>

      {me ? (
        <Composer
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onPost={onPost}
          onPosted={onPosted}
          testidPrefix={testidPrefix}
        />
      ) : (
        <p className="mt-3 text-xs text-slate-500 text-center">
          {t("place.chat.loginToPost")}
        </p>
      )}
    </div>
  );
}

function ItemNode({
  node,
  depth,
  me,
  onReply,
  onDelete,
  testidPrefix,
  entityTimezone,
}: {
  node: Node;
  depth: number;
  me: Me | null;
  onReply: (n: ThreadedItem) => void;
  onDelete: ((id: string) => Promise<unknown>) | undefined;
  testidPrefix: string;
  entityTimezone?: string;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const indent = Math.min(depth, 6) * 14;
  const isOwn = !!me && me.user.email.toLowerCase() === (node.user_email || "").toLowerCase();
  const delMut = useMutation({
    mutationFn: () => onDelete!(node.id),
  });

  return (
    <li>
      <div
        className="text-xs"
        style={{ paddingLeft: indent }}
        data-testid={`${testidPrefix}-msg-${node.id}`}
      >
        <div className="border-l-2 border-slate-800 pl-2">
          <div className="text-slate-500 mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <UserNameLink
              email={node.user_email}
              displayName={node.user_display_name}
              className="text-slate-300 font-semibold"
              testid={`${testidPrefix}-author-${node.id}`}
            />
            {/* Three-tz timestamp inline next to the author. Each row
                visible respects the user's show_utc / show_local /
                show_user toggles. No entity TZ available for chat
                messages — they're posted "from nowhere" — so the
                Local row is naturally suppressed; UTC + user remain. */}
            <TimeDisplay
              iso={node.created_at}
              entityTimezone={entityTimezone}
              me={me}
              inline
              className="text-[10px] text-slate-500"
              testid={`${testidPrefix}-time-${node.id}`}
            />
          </div>
          {node.text && (
            <div
              className="chat-msg-body text-slate-200 break-words"
              dangerouslySetInnerHTML={{ __html: node.text }}
            />
          )}
          {node.attachments && node.attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {node.attachments.map((a, i) => (
                <AttachmentView key={i} att={a} />
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3">
            {me && (
              <button
                type="button"
                onClick={() => onReply(node)}
                className="text-[11px] text-slate-500 hover:text-indigo-300"
                data-testid={`${testidPrefix}-reply-${node.id}`}
              >
                ↩ {t("place.chat.reply")}
              </button>
            )}
            {isOwn && onDelete && (
              <button
                type="button"
                onClick={() => delMut.mutate()}
                disabled={delMut.isPending}
                className="text-[11px] text-rose-400 hover:text-rose-300 disabled:opacity-50"
                data-testid={`${testidPrefix}-delete-${node.id}`}
              >
                ✕ {t("common.delete") || t("place.actions.delete")}
              </button>
            )}
            {node.children.length > 0 && (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >
                {collapsed
                  ? t("place.chat.expandReplies", { count: node.children.length })
                  : t("place.chat.collapseReplies")}
              </button>
            )}
          </div>
        </div>
      </div>

      {!collapsed && node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <ItemNode
              key={child.id}
              node={child}
              depth={depth + 1}
              me={me}
              onReply={onReply}
              onDelete={onDelete}
              testidPrefix={testidPrefix}
              entityTimezone={entityTimezone}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function AttachmentView({ att }: { att: ChatAttachment }) {
  if (att.kind === "image") {
    return (
      <a href={att.url} target="_blank" rel="noreferrer" className="block">
        <img
          src={att.url}
          alt={att.title || ""}
          className="max-w-full max-h-72 rounded-md ring-1 ring-slate-800"
          loading="lazy"
        />
      </a>
    );
  }
  if (att.kind === "video") {
    return (
      <video
        src={att.url}
        controls
        preload="metadata"
        className="max-w-full max-h-72 rounded-md ring-1 ring-slate-800 bg-black"
      />
    );
  }
  if (att.kind === "youtube" && att.video_id) {
    return (
      <div className="aspect-video w-full rounded-md overflow-hidden ring-1 ring-slate-800 bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${att.video_id}`}
          title="YouTube"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
          loading="lazy"
        />
      </div>
    );
  }
  return null;
}

function Composer({
  replyTo,
  onCancelReply,
  onPost,
  onPosted,
  testidPrefix,
}: {
  replyTo: ThreadedItem | null;
  onCancelReply: () => void;
  onPost: (body: {
    text: string;
    attachments: ChatAttachment[];
    parent_id: string | null;
  }) => Promise<unknown>;
  onPosted: () => void;
  testidPrefix: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: () =>
      onPost({
        text: isHtmlEmpty(text) ? "" : text,
        attachments: drafts,
        parent_id: replyTo?.id ?? null,
      }),
    onSuccess: () => {
      setText("");
      setDrafts([]);
      setError(null);
      onPosted();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function uploadFile(kind: "image" | "video", file: File) {
    setBusy(t("place.chat.uploading"));
    setError(null);
    try {
      const result = await uploads.media(file);
      setDrafts((d) => [
        ...d,
        { kind, url: result.url, mime: result.mime, title: file.name },
      ]);
    } catch (e) {
      setError(
        t("place.chat.uploadFailed", {
          message: e instanceof Error ? e.message : "unknown",
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  function addYouTube() {
    const url = window.prompt(t("place.chat.youtubePromptUrl"));
    if (!url) return;
    const vid = extractYouTubeId(url);
    if (!vid) {
      setError(t("place.chat.youtubeInvalid"));
      return;
    }
    setDrafts((d) => [
      ...d,
      { kind: "youtube", url: `https://www.youtube.com/watch?v=${vid}`, video_id: vid },
    ]);
  }

  return (
    <form
      className="border-t border-slate-800 pt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (isHtmlEmpty(text) && drafts.length === 0) return;
        post.mutate();
      }}
      data-testid={`${testidPrefix}-composer`}
    >
      {replyTo && (
        <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/50 ring-1 ring-slate-800 rounded-md px-2 py-1">
          <span>↩ {t("place.chat.replying", { name: replyTo.user_display_name })}</span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-slate-500 hover:text-slate-200"
          >
            {t("place.chat.cancelReply")}
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="space-y-1">
          {drafts.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[11px] text-slate-300 bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2 py-1"
            >
              <span className="font-mono text-slate-500">[{a.kind}]</span>
              <span className="truncate flex-1">{a.title || a.url}</span>
              <button
                type="button"
                onClick={() => setDrafts((d) => d.filter((_, j) => j !== i))}
                className="text-slate-500 hover:text-rose-400"
                aria-label="Remove attachment"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <ChatRichEditor
        value={text}
        onChange={setText}
        placeholder={t("place.chat.placeholder")}
        onInsertImage={async () => {
          return new Promise<string | null>((resolve) => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.accept = "image/*";
            inp.onchange = async () => {
              const f = inp.files?.[0];
              if (!f) return resolve(null);
              try {
                const r = await uploads.media(f);
                resolve(r.url);
              } catch {
                resolve(null);
              }
            };
            inp.click();
          });
        }}
      />

      <div className="flex flex-wrap items-center gap-1">
        <FilePickerButton accept="image/*" onPick={(f) => uploadFile("image", f)}>
          🖼 {t("place.chat.attachImage")}
        </FilePickerButton>
        <FilePickerButton accept="video/*" onPick={(f) => uploadFile("video", f)}>
          🎞 {t("place.chat.attachVideo")}
        </FilePickerButton>
        <button
          type="button"
          onClick={addYouTube}
          disabled={!!busy}
          className="text-[11px] px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-50"
        >
          ▶ {t("place.chat.attachYoutube")}
        </button>
        <span className="flex-1" />
        <button
          type="submit"
          disabled={(isHtmlEmpty(text) && drafts.length === 0) || post.isPending || !!busy}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-xs px-3 py-1.5 rounded-md transition"
          data-testid={`${testidPrefix}-send`}
        >
          {post.isPending ? "…" : t("place.chat.send")}
        </button>
      </div>

      {busy && <p className="text-[11px] text-slate-400">{busy}</p>}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </form>
  );
}

function FilePickerButton({
  accept,
  onPick,
  children,
}: {
  accept: string;
  onPick: (f: File) => void;
  children: React.ReactNode;
}) {
  const id = useMemo(
    () => `fp-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );
  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => document.getElementById(id)?.click()}
        className="text-[11px] px-2 py-1 rounded-md ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300"
      >
        {children}
      </button>
    </>
  );
}
