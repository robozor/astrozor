import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  chat,
  type ChatAttachment,
  type ChatMessage,
  type Sprint,
  type ZooniverseCollection,
  type ZooniverseSubjectResolved,
  zooniverse,
} from "../lib/api";
import { MediaBrowser } from "./MediaBrowser";

/**
 * Members-only sprint chat. List + threaded composer + per-message
 * delete (owner only). Supports a special ``zoo_subject`` attachment
 * resolved from a Zooniverse subject ID/URL — the subject's preview
 * image becomes the root of a thread the members can comment under.
 *
 * Polls the list every 10 s via React Query — same cadence as place
 * chat (real-time delivery is on the post-MVP roadmap, ADR-006).
 */
export function SprintChat({
  sprint,
  currentUserEmail,
}: {
  sprint: Sprint;
  /** Drives owner-only edit/delete buttons. Server is authoritative
   *  (PATCH/DELETE return 403 if not owner); this is purely a UX
   *  signal to hide buttons the user can't use. */
  currentUserEmail?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["sprint-chat", sprint.slug],
    queryFn: () => zooniverse.listSprintChat(sprint.slug),
    refetchInterval: 10_000,
  });
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const messages = listQ.data?.items ?? [];
  const roots = messages.filter((m) => !m.parent_id);
  const repliesByRoot = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.parent_id) {
      const arr = repliesByRoot.get(m.parent_id) ?? [];
      arr.push(m);
      repliesByRoot.set(m.parent_id, arr);
    }
  }

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["sprint-chat", sprint.slug] });

  return (
    <div className="bg-slate-950/60 ring-1 ring-slate-800 rounded-lg p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {t("citizen.sprints.chat.heading")}
      </div>
      {listQ.isLoading && (
        <p className="text-xs text-slate-500">{t("common.loading")}</p>
      )}
      {listQ.isError && (
        <p className="text-xs text-rose-400">
          {(listQ.error as ApiError)?.detail || t("common.error")}
        </p>
      )}
      {listQ.isSuccess && roots.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          {t("citizen.sprints.chat.empty")}
        </p>
      )}

      <ul className="space-y-3">
        {roots.map((m) => (
          <MessageNode
            key={m.id}
            message={m}
            replies={repliesByRoot.get(m.id) ?? []}
            currentUserEmail={currentUserEmail}
            onReply={(parent) => setReplyTo(parent)}
            onRefresh={refresh}
          />
        ))}
      </ul>

      <SprintChatComposer
        sprint={sprint}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onPosted={refresh}
      />
    </div>
  );
}

function MessageNode({
  message,
  replies,
  currentUserEmail,
  onReply,
  onRefresh,
}: {
  message: ChatMessage;
  replies: ChatMessage[];
  currentUserEmail?: string;
  onReply: (m: ChatMessage) => void;
  onRefresh: () => void;
}) {
  return (
    <li className="space-y-2">
      <MessageBubble
        message={message}
        currentUserEmail={currentUserEmail}
        onReply={onReply}
        onRefresh={onRefresh}
      />
      {replies.length > 0 && (
        <ul className="space-y-2 pl-4 border-l border-slate-800">
          {replies.map((r) => (
            <MessageBubble
              key={r.id}
              message={r}
              currentUserEmail={currentUserEmail}
              onReply={onReply}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MessageBubble({
  message,
  currentUserEmail,
  onReply,
  onRefresh,
}: {
  message: ChatMessage;
  currentUserEmail?: string;
  onReply: (m: ChatMessage) => void;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isOwner = !!currentUserEmail && currentUserEmail === message.user_email;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [editError, setEditError] = useState<string>("");
  const remove = useMutation({
    mutationFn: () => chat.remove(message.id),
    onSuccess: onRefresh,
  });
  const edit = useMutation({
    mutationFn: () =>
      chat.edit(message.id, {
        text: draft.trim(),
        // Attachments stay as-is on edit; we don't currently let the
        // user re-pick a subject attachment from the edit form. The
        // server preserves attachments only if we re-send them.
        attachments: message.attachments,
      }),
    onSuccess: () => {
      setEditing(false);
      setEditError("");
      onRefresh();
    },
    onError: (err) => {
      setEditError((err as ApiError)?.detail || t("common.error"));
    },
  });
  const created = new Date(message.created_at);
  const subjectAttachments = (message.attachments || []).filter(
    (a) => a.kind === "zoo_subject",
  );
  const otherAttachments = (message.attachments || []).filter(
    (a) => a.kind !== "zoo_subject",
  );
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-400">
          <span className="text-slate-200 font-medium">
            {message.user_display_name}
          </span>{" "}
          ·{" "}
          {created.toLocaleString(i18n.language, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {message.edited_at && (
            <span
              className="ml-1 text-slate-500 italic"
              title={new Date(message.edited_at).toLocaleString(i18n.language)}
            >
              · {t("citizen.sprints.chat.editedBadge")}
            </span>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => onReply(message)}
              className="text-slate-400 hover:text-slate-200"
            >
              {t("citizen.sprints.chat.reply")}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  setDraft(message.text);
                  setEditError("");
                  setEditing(true);
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                {t("citizen.sprints.chat.edit")}
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("citizen.sprints.chat.deleteConfirm"))) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
                className="text-rose-400 hover:text-rose-300"
              >
                {t("citizen.sprints.chat.deleteOwn")}
              </button>
            )}
          </div>
        )}
      </div>
      {subjectAttachments.map((a, i) => (
        <SubjectAttachmentCard key={i} attachment={a} />
      ))}
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(2, draft.split("\n").length)}
            className="w-full bg-slate-950/60 ring-1 ring-slate-800 focus:ring-indigo-500 rounded p-2 text-xs text-slate-100 outline-none transition"
            data-testid={`sprint-chat-edit-${message.id}`}
            autoFocus
          />
          {editError && (
            <p className="text-[11px] text-rose-400">{editError}</p>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditError("");
                setDraft(message.text);
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-0.5"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={
                edit.isPending ||
                (!draft.trim() && subjectAttachments.length === 0 && otherAttachments.length === 0)
              }
              onClick={() => edit.mutate()}
              className="text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-2.5 py-0.5 rounded transition"
            >
              {edit.isPending ? t("common.saving") : t("citizen.sprints.chat.editSave")}
            </button>
          </div>
        </div>
      ) : (
        message.text && (
          <div
            className="text-xs text-slate-200 whitespace-pre-wrap leading-snug"
            /* Text is server-sanitised via bleach; safe to render raw. */
            dangerouslySetInnerHTML={{ __html: message.text }}
          />
        )
      )}
      {otherAttachments.map((a, i) => (
        <BasicAttachment key={i} attachment={a} />
      ))}
    </div>
  );
}

function SubjectAttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-950/60 ring-1 ring-fuchsia-900/40 rounded-md p-2 space-y-2">
      <MediaBrowser
        media={attachment.media}
        locations={attachment.locations}
        size="md"
        alt={attachment.title || `Subject #${attachment.subject_id}`}
      />
      <div className="flex flex-wrap items-start gap-2 justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/70">
            {t("citizen.sprints.chat.subjectKicker")}
          </div>
          <div className="text-xs text-slate-200 font-medium break-words">
            {attachment.title || `Subject #${attachment.subject_id}`}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            ID {attachment.subject_id}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {attachment.classify_url && (
            <a
              href={attachment.classify_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition"
            >
              🔭 {t("citizen.sprints.chat.subjectClassify")}
            </a>
          )}
          {attachment.talk_url && (
            <a
              href={attachment.talk_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-2 py-0.5 rounded transition"
            >
              💬 {t("citizen.sprints.chat.subjectTalk")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function BasicAttachment({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === "youtube") {
    return (
      <div className="aspect-video w-full max-w-md">
        <iframe
          src={`https://www.youtube.com/embed/${attachment.video_id || ""}`}
          title={attachment.title || "YouTube video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full rounded ring-1 ring-slate-800"
        />
      </div>
    );
  }
  if (attachment.kind === "image") {
    return (
      <img
        src={attachment.url}
        alt={attachment.title || ""}
        className="max-w-md max-h-64 rounded ring-1 ring-slate-800"
      />
    );
  }
  if (attachment.kind === "video") {
    return (
      <video
        src={attachment.url}
        controls
        className="max-w-md max-h-64 rounded ring-1 ring-slate-800"
      />
    );
  }
  return null;
}

function SprintChatComposer({
  sprint,
  replyTo,
  onClearReply,
  onPosted,
}: {
  sprint: Sprint;
  replyTo: ChatMessage | null;
  onClearReply: () => void;
  onPosted: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [pendingSubject, setPendingSubject] =
    useState<ZooniverseSubjectResolved | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [postError, setPostError] = useState<string>("");

  const send = useMutation({
    mutationFn: async () => {
      const attachments: ChatAttachment[] = [];
      if (pendingSubject) {
        attachments.push({
          kind: "zoo_subject",
          subject_id: pendingSubject.subject_id,
          project_zid: pendingSubject.project_zid,
          media: pendingSubject.media,
          locations: pendingSubject.locations,
          classify_url: pendingSubject.classify_url,
          talk_url: pendingSubject.talk_url,
          title: pendingSubject.title,
          url: pendingSubject.locations[0] || pendingSubject.media[0]?.url || "",
        });
      }
      return zooniverse.postSprintChat(sprint.slug, {
        text: text.trim(),
        attachments,
        parent_id: replyTo?.id ?? null,
      });
    },
    onSuccess: () => {
      setText("");
      setPendingSubject(null);
      onClearReply();
      setPostError("");
      onPosted();
    },
    onError: (err) => {
      setPostError((err as ApiError)?.detail || t("common.error"));
    },
  });

  const canSend =
    !send.isPending && (text.trim().length > 0 || pendingSubject !== null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
      className="space-y-2"
    >
      {replyTo && (
        <div className="text-[11px] text-slate-400 bg-slate-900/60 rounded px-2 py-1 flex items-center justify-between gap-2">
          <span>
            ↳ {t("citizen.sprints.chat.replyingTo", {
              name: replyTo.user_display_name,
            })}
          </span>
          <button
            type="button"
            onClick={onClearReply}
            className="text-slate-500 hover:text-slate-300"
          >
            ×
          </button>
        </div>
      )}
      {pendingSubject && (
        <div className="text-[11px] bg-fuchsia-950/40 ring-1 ring-fuchsia-900/60 rounded px-2 py-1 flex items-center justify-between gap-2">
          <span className="text-fuchsia-200">
            📎 Subject #{pendingSubject.subject_id} —{" "}
            {pendingSubject.title || t("citizen.sprints.chat.subjectKicker")}
          </span>
          <button
            type="button"
            onClick={() => setPendingSubject(null)}
            className="text-slate-500 hover:text-slate-300"
          >
            ×
          </button>
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("citizen.sprints.chat.placeholder")}
        rows={2}
        className="w-full bg-slate-900/60 ring-1 ring-slate-800 focus:ring-indigo-500 rounded p-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition"
        data-testid="sprint-chat-text"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-2.5 py-1 rounded transition"
        >
          {t("citizen.sprints.chat.attachSubject")}
        </button>
        <button
          type="submit"
          disabled={!canSend}
          className="text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-3 py-1 rounded transition"
          data-testid="sprint-chat-send"
        >
          {send.isPending
            ? t("common.saving")
            : t("citizen.sprints.chat.send")}
        </button>
      </div>
      {postError && (
        <p className="text-[11px] text-rose-400">{postError}</p>
      )}
      {pickerOpen && (
        <SubjectPickerDialog
          projectZid={sprint.zooniverse_project_zid}
          onClose={() => setPickerOpen(false)}
          onPicked={(s) => {
            setPendingSubject(s);
            setPickerOpen(false);
          }}
        />
      )}
    </form>
  );
}

type PickerTab = "paste" | "favorites" | "collections" | "recent";

function SubjectPickerDialog({
  projectZid,
  onClose,
  onPicked,
}: {
  projectZid: number | null;
  onClose: () => void;
  onPicked: (s: ZooniverseSubjectResolved) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PickerTab>("paste");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-800 rounded-lg p-4 w-full max-w-3xl max-h-[90vh] flex flex-col space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-slate-200">
            {t("citizen.sprints.chat.attachDialogTitle")}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
          >
            ×
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-800 flex-wrap">
          <PickerTabButton
            active={tab === "paste"}
            onClick={() => setTab("paste")}
            label={t("citizen.sprints.chat.pickerTabPaste")}
          />
          <PickerTabButton
            active={tab === "recent"}
            onClick={() => setTab("recent")}
            label={t("citizen.sprints.chat.pickerTabRecent")}
          />
          <PickerTabButton
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
            label={t("citizen.sprints.chat.pickerTabFavorites")}
          />
          <PickerTabButton
            active={tab === "collections"}
            onClick={() => setTab("collections")}
            label={t("citizen.sprints.chat.pickerTabCollections")}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "paste" && <PastePicker onPicked={onPicked} />}
          {tab === "recent" && (
            <RecentClassificationsPicker
              projectZid={projectZid}
              onPicked={onPicked}
            />
          )}
          {tab === "favorites" && (
            <FavoritesPicker
              projectZid={projectZid}
              onPicked={onPicked}
            />
          )}
          {tab === "collections" && (
            <CollectionsPicker
              projectZid={projectZid}
              onPicked={onPicked}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PickerTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 -mb-px border-b-2 transition ${
        active
          ? "border-indigo-500 text-slate-100"
          : "border-transparent text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function PastePicker({
  onPicked,
}: {
  onPicked: (s: ZooniverseSubjectResolved) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>("");
  const resolve = useMutation({
    mutationFn: () => zooniverse.resolveSubject(q.trim()),
    onSuccess: (s) => {
      setError("");
      onPicked(s);
    },
    onError: (err) => {
      setError(
        (err as ApiError)?.detail ||
          t("citizen.sprints.chat.attachResolveFailed"),
      );
    },
  });
  return (
    <div className="space-y-3 pt-2">
      <p className="text-[11px] text-slate-500 leading-snug">
        {t("citizen.sprints.chat.attachDialogHint")}
      </p>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="12345678 / https://www.zooniverse.org/talk/subjects/..."
        className="w-full bg-slate-950/60 ring-1 ring-slate-800 focus:ring-indigo-500 rounded p-2 text-sm text-slate-100 placeholder-slate-500 font-mono outline-none"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (q.trim()) resolve.mutate();
          }
        }}
      />
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!q.trim() || resolve.isPending}
          onClick={() => resolve.mutate()}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white px-3 py-1 rounded transition"
        >
          {resolve.isPending
            ? t("common.loading")
            : t("citizen.sprints.chat.attachResolve")}
        </button>
      </div>
    </div>
  );
}

function ZooReconnectNotice() {
  const { t } = useTranslation();
  return (
    <div className="bg-amber-950/40 ring-1 ring-amber-900/60 rounded-md p-3 mt-3 space-y-1.5">
      <p className="text-xs font-medium text-amber-200">
        🔌 {t("citizen.sprints.chat.reconnectTitle")}
      </p>
      <p className="text-[11px] text-amber-100/80 leading-snug whitespace-pre-line">
        {t("citizen.sprints.chat.reconnectBody")}
      </p>
    </div>
  );
}

function RecentClassificationsPicker({
  projectZid,
  onPicked,
}: {
  projectZid: number | null;
  onPicked: (s: ZooniverseSubjectResolved) => void;
}) {
  const { t } = useTranslation();
  const recentQ = useQuery({
    queryKey: ["zoo-my-recent", projectZid ?? 0],
    queryFn: () =>
      zooniverse.myRecentClassifications(projectZid ?? undefined, 24),
    staleTime: 60_000,
  });
  if (recentQ.isLoading) {
    return (
      <p className="text-xs text-slate-500 pt-3">{t("common.loading")}</p>
    );
  }
  if (recentQ.data?.needs_reconnect) {
    return <ZooReconnectNotice />;
  }
  if (!recentQ.data || recentQ.data.items.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic pt-3">
        {t("citizen.sprints.chat.recentEmpty")}
      </p>
    );
  }
  return <SubjectGrid items={recentQ.data.items} onPick={onPicked} />;
}

function FavoritesPicker({
  projectZid,
  onPicked,
}: {
  projectZid: number | null;
  onPicked: (s: ZooniverseSubjectResolved) => void;
}) {
  const { t } = useTranslation();
  const favoritesQ = useQuery({
    queryKey: ["zoo-my-favorites", projectZid ?? 0],
    queryFn: () =>
      zooniverse.myFavoriteSubjects(1, 24, projectZid ?? undefined),
    staleTime: 60_000,
  });
  if (favoritesQ.isLoading) {
    return (
      <p className="text-xs text-slate-500 pt-3">{t("common.loading")}</p>
    );
  }
  if (favoritesQ.data?.needs_reconnect) {
    return <ZooReconnectNotice />;
  }
  if (!favoritesQ.data || favoritesQ.data.items.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic pt-3">
        {t("citizen.sprints.chat.favoritesEmpty")}
      </p>
    );
  }
  return (
    <SubjectGrid
      items={favoritesQ.data.items}
      onPick={onPicked}
    />
  );
}

function CollectionsPicker({
  projectZid,
  onPicked,
}: {
  projectZid: number | null;
  onPicked: (s: ZooniverseSubjectResolved) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ZooniverseCollection | null>(null);
  const listQ = useQuery({
    queryKey: ["zoo-my-collections", projectZid ?? 0],
    queryFn: () => zooniverse.myCollections(projectZid ?? undefined),
    staleTime: 60_000,
  });
  const subjectsQ = useQuery({
    queryKey: ["zoo-collection-subjects", selected?.id ?? 0],
    queryFn: () => zooniverse.collectionSubjects(selected!.id, 1, 24),
    enabled: !!selected,
    staleTime: 60_000,
  });

  if (selected) {
    return (
      <div className="space-y-2 pt-2">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-[11px] text-slate-400 hover:text-slate-200"
        >
          ← {t("citizen.sprints.chat.backToCollections")}
        </button>
        <div className="text-sm text-slate-200 font-medium">
          {selected.display_name}
        </div>
        {subjectsQ.isLoading && (
          <p className="text-xs text-slate-500">{t("common.loading")}</p>
        )}
        {subjectsQ.data && subjectsQ.data.items.length > 0 ? (
          <SubjectGrid items={subjectsQ.data.items} onPick={onPicked} />
        ) : (
          subjectsQ.isSuccess && (
            <p className="text-xs text-slate-500 italic">
              {t("citizen.sprints.chat.collectionEmpty")}
            </p>
          )
        )}
      </div>
    );
  }

  if (listQ.isLoading) {
    return (
      <p className="text-xs text-slate-500 pt-3">{t("common.loading")}</p>
    );
  }
  if (listQ.data?.needs_reconnect) {
    return <ZooReconnectNotice />;
  }
  if (!listQ.data || listQ.data.items.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic pt-3">
        {t("citizen.sprints.chat.collectionsEmpty")}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
      {listQ.data.items.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => setSelected(c)}
            className="w-full text-left bg-slate-900/60 hover:bg-slate-900 ring-1 ring-slate-800 rounded p-3 transition"
          >
            <div className="text-sm text-slate-200 font-medium truncate">
              📁 {c.display_name}
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-1">
              {t("citizen.sprints.chat.subjectsCount", {
                count: c.subjects_count,
              })}
              {c.private && (
                <span className="ml-2 text-slate-600">🔒</span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SubjectGrid({
  items,
  onPick,
}: {
  items: ZooniverseSubjectResolved[];
  onPick: (s: ZooniverseSubjectResolved) => void;
}) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pt-2">
      {items.map((s) => (
        <li key={s.subject_id}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="w-full text-left bg-slate-900/60 hover:bg-slate-900 ring-1 ring-slate-800 hover:ring-fuchsia-700 rounded p-2 transition space-y-1"
            data-testid={`subject-grid-${s.subject_id}`}
          >
            <MediaBrowser
              media={s.media}
              locations={s.locations}
              size="sm"
              autoplay
              intervalMs={900}
              alt={s.title || `Subject #${s.subject_id}`}
            />
            <div className="text-[10px] text-slate-500 font-mono truncate">
              #{s.subject_id}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

