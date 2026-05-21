import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** A minimal contentEditable rich-text editor for chat messages.
 *
 * Supports the formatting set the user asked for:
 *  - bold, italic, underline, strikethrough
 *  - bullet list, numbered list
 *  - hyperlink (inserts `<a href>` around selection)
 *  - inline image (insert via toolbar; once placed, click it to resize)
 *
 * Output: HTML string. The backend allowlist (chat/api.py) drops anything
 * that doesn't match the safe tag/attr set, so we don't have to be
 * paranoid here — the editor is allowed to be permissive.
 *
 * Image resizing: clicking an embedded <img> selects it and shows a
 * single right-edge handle. Dragging the handle updates inline
 * `style="width: Npx"`. Aspect ratio is preserved by leaving height
 * unset (auto).
 */
export function ChatRichEditor({
  value,
  onChange,
  placeholder,
  onInsertImage,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Called when toolbar 🖼 is clicked. Should upload + return the URL
   * of an image hosted on our own MEDIA_URL, or null to cancel. */
  onInsertImage: () => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);

  // Sync the value prop into the editor only when externally cleared
  // (e.g. after submit). Avoid forcing innerHTML on every render because
  // that would blow away the cursor.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === "" && el.innerHTML !== "") {
      el.innerHTML = "";
    }
  }, [value]);

  function emitChange() {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function exec(command: string, arg?: string) {
    editorRef.current?.focus();
    // execCommand is deprecated but still the simplest path for a small
    // editor like this and is supported in all modern browsers. The
    // alternatives (Selection API + manual DOM mutation) would 5x the
    // code without behavioural improvement for our use case.
    document.execCommand(command, false, arg);
    emitChange();
  }

  function insertLink() {
    const url = window.prompt(t("place.chat.linkPromptUrl"), "https://");
    if (!url) return;
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith("mailto:")) {
      normalized = "https://" + normalized;
    }
    exec("createLink", normalized);
    // Force target=_blank on the just-created link
    const sel = window.getSelection();
    const node = sel?.anchorNode?.parentElement;
    if (node && node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      emitChange();
    }
  }

  async function insertImage() {
    const url = await onInsertImage();
    if (!url) return;
    editorRef.current?.focus();
    // Insert with a sensible default width so a 4000px wide upload doesn't
    // explode the chat viewport. User can drag the resize handle from there.
    const html = `<img src="${url}" alt="" style="width: 320px" />`;
    document.execCommand("insertHTML", false, html);
    emitChange();
  }

  function onEditorClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).tagName === "IMG") {
      setSelectedImg(e.target as HTMLImageElement);
    } else {
      setSelectedImg(null);
    }
  }

  return (
    <div className="space-y-1">
      <div
        role="toolbar"
        className="flex flex-wrap items-center gap-0.5 bg-slate-950/60 ring-1 ring-slate-700 rounded-md px-1 py-1"
        onMouseDown={(e) => e.preventDefault() /* keep selection */}
      >
        <ToolbarBtn onClick={() => exec("bold")} title={t("place.chat.fmt.bold")}>
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("italic")} title={t("place.chat.fmt.italic")}>
          <em>I</em>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("underline")} title={t("place.chat.fmt.underline")}>
          <u>U</u>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("strikeThrough")} title={t("place.chat.fmt.strike")}>
          <s>S</s>
        </ToolbarBtn>
        <span className="w-px h-4 bg-slate-700 mx-0.5" />
        <ToolbarBtn onClick={() => exec("insertUnorderedList")} title={t("place.chat.fmt.bullet")}>
          • —
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("insertOrderedList")} title={t("place.chat.fmt.number")}>
          1.
        </ToolbarBtn>
        <span className="w-px h-4 bg-slate-700 mx-0.5" />
        <ToolbarBtn onClick={insertLink} title={t("place.chat.fmt.link")}>
          🔗
        </ToolbarBtn>
        <ToolbarBtn onClick={insertImage} title={t("place.chat.fmt.image")}>
          🖼
        </ToolbarBtn>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emitChange}
        onClick={onEditorClick}
        onKeyDown={(e) => {
          if (e.key === "Escape") setSelectedImg(null);
        }}
        suppressContentEditableWarning
        className="chat-rich-editor w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none text-xs min-h-[5rem] max-h-48 overflow-y-auto dark-scroll"
        data-testid="chat-rich-editor"
      />
      {selectedImg && (
        <ImageResizeBar
          img={selectedImg}
          onResize={() => emitChange()}
          onDeselect={() => setSelectedImg(null)}
        />
      )}
    </div>
  );
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* keep editor selection */}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="text-xs px-1.5 py-0.5 rounded text-slate-300 hover:bg-slate-800 hover:text-slate-100"
    >
      {children}
    </button>
  );
}

/** Inline width slider that appears below the editor when an image is
 * clicked. Updates the image's `style="width: Npx"` in place. */
function ImageResizeBar({
  img,
  onResize,
  onDeselect,
}: {
  img: HTMLImageElement;
  onResize: () => void;
  onDeselect: () => void;
}) {
  const { t } = useTranslation();
  const initial = parseInt(img.style.width || `${img.clientWidth}`, 10) || 320;
  const [width, setWidth] = useState(initial);
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-300 bg-slate-900/60 ring-1 ring-slate-800 rounded-md px-2 py-1">
      <span className="text-slate-500">{t("place.chat.fmt.imgWidth")}:</span>
      <input
        type="range"
        min={80}
        max={640}
        step={10}
        value={width}
        onChange={(e) => {
          const v = Number(e.target.value);
          setWidth(v);
          img.style.width = `${v}px`;
          onResize();
        }}
        className="flex-1 accent-indigo-500"
      />
      <span className="font-mono w-12 text-right">{width}px</span>
      <button
        type="button"
        onClick={onDeselect}
        aria-label="Close"
        className="text-slate-500 hover:text-slate-200"
      >
        ✕
      </button>
    </div>
  );
}
