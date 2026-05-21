import { useRef, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { projects } from "../lib/api";
import { proseMarkdownClass } from "./proseClasses";

/**
 * GitHub-style markdown composer.
 *
 * A textarea + toolbar that wraps the current selection in markdown
 * syntax (bold / italic / code / link / quote / lists / heading),
 * plus a Write / Preview tab so the user can see the rendered output
 * before posting. Preview goes through the backend
 * ``/markdown/preview`` endpoint so the HTML matches exactly what
 * the rendered post will look like.
 *
 * Keyboard shortcuts (when textarea is focused):
 *   * Ctrl/Cmd-B → bold
 *   * Ctrl/Cmd-I → italic
 *   * Ctrl/Cmd-K → link
 */
export function MarkdownComposer({
  value,
  onChange,
  placeholder,
  rows = 4,
  testid,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  testid?: string;
}) {
  const { t } = useTranslation();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const preview = useMutation({
    mutationFn: () => projects.previewMarkdown(value),
  });

  /** Replace the current selection with the result of ``wrap(selected)``
   *  and restore focus / selection so the user can keep typing. */
  function applyWrap(
    wrap: (selected: string) => { text: string; selectStart: number; selectEnd: number },
  ) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const { text, selectStart, selectEnd } = wrap(selected);
    const next = before + text + after;
    onChange(next);
    // Defer cursor restore until React applies the new value.
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      taRef.current.focus();
      taRef.current.setSelectionRange(
        before.length + selectStart,
        before.length + selectEnd,
      );
    });
  }

  const wrapInline = (prefix: string, suffix = prefix, placeholderText = "text") => () =>
    applyWrap((sel) => {
      const inner = sel || placeholderText;
      return {
        text: `${prefix}${inner}${suffix}`,
        // If there was no selection, leave the cursor highlighting
        // the placeholder so the user can overwrite it directly.
        selectStart: prefix.length,
        selectEnd: prefix.length + inner.length,
      };
    });

  const wrapLine = (prefix: string, placeholderText = "text") => () =>
    applyWrap((sel) => {
      const inner = sel || placeholderText;
      // Prefix each line (handles multi-line selections gracefully).
      const lines = inner.split("\n");
      const text = lines.map((l) => `${prefix}${l}`).join("\n");
      return {
        text,
        selectStart: 0,
        selectEnd: text.length,
      };
    });

  const wrapLink = () =>
    applyWrap((sel) => {
      const label = sel || t("composer.linkText");
      const text = `[${label}](https://)`;
      // Place the cursor on the URL placeholder so the user types
      // the destination next.
      const urlStart = `[${label}](`.length;
      const urlEnd = text.length - 1;
      return { text, selectStart: urlStart, selectEnd: urlEnd };
    });

  const wrapCodeBlock = () =>
    applyWrap((sel) => {
      const inner = sel || "code";
      const text = `\n\`\`\`\n${inner}\n\`\`\`\n`;
      const start = "\n```\n".length;
      const end = start + inner.length;
      return { text, selectStart: start, selectEnd: end };
    });

  const insertTable = () =>
    applyWrap(() => {
      // GFM table template: 3 columns × 2 body rows + header. Each
      // ``Cell`` placeholder is what the user replaces; we don't try
      // to select all of them at once (no rectangular selection in
      // textareas), so we just place the cursor on the first cell.
      const text =
        "\n| Header 1 | Header 2 | Header 3 |\n" +
        "| --- | --- | --- |\n" +
        "| Cell | Cell | Cell |\n" +
        "| Cell | Cell | Cell |\n";
      const headerStart = "\n| ".length;
      const headerEnd = headerStart + "Header 1".length;
      return { text, selectStart: headerStart, selectEnd: headerEnd };
    });

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      wrapInline("**")();
    } else if (k === "i") {
      e.preventDefault();
      wrapInline("*")();
    } else if (k === "k") {
      e.preventDefault();
      wrapLink();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b border-slate-800">
        <div className="flex">
          <TabButton
            active={mode === "write"}
            onClick={() => setMode("write")}
            label={t("composer.write")}
          />
          <TabButton
            active={mode === "preview"}
            onClick={() => {
              setMode("preview");
              preview.mutate();
            }}
            label={t("composer.preview")}
          />
        </div>
        {mode === "write" && (
          <div className="flex items-center gap-0.5 flex-wrap py-1">
            <TbBtn label="B" title={t("composer.bold")} onClick={wrapInline("**")} bold />
            <TbBtn label="I" title={t("composer.italic")} onClick={wrapInline("*")} italic />
            <TbBtn label="S" title={t("composer.strike")} onClick={wrapInline("~~")} strike />
            <TbDivider />
            <TbBtn
              label="</>"
              title={t("composer.code")}
              onClick={wrapInline("`", "`", "code")}
              mono
            />
            <TbBtn
              label="{ }"
              title={t("composer.codeBlock")}
              onClick={wrapCodeBlock}
              mono
            />
            <TbBtn label="🔗" title={t("composer.link")} onClick={wrapLink} />
            <TbDivider />
            <TbBtn label="❝" title={t("composer.quote")} onClick={wrapLine("> ")} />
            <TbBtn label="•" title={t("composer.bulletList")} onClick={wrapLine("- ")} />
            <TbBtn label="1." title={t("composer.numberedList")} onClick={wrapLine("1. ")} />
            <TbBtn label="H" title={t("composer.heading")} onClick={wrapLine("### ")} />
            <TbBtn label="⊞" title={t("composer.table")} onClick={insertTable} />
          </div>
        )}
      </div>

      {mode === "write" ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          className="w-full bg-slate-950/60 ring-1 ring-slate-800 focus:ring-indigo-500 rounded p-2 text-sm text-slate-100 placeholder-slate-500 font-mono outline-none transition resize-y"
          data-testid={testid}
        />
      ) : (
        <div className="min-h-[80px] bg-slate-950/60 ring-1 ring-slate-800 rounded p-2">
          {preview.isPending && (
            <p className="text-[11px] text-slate-500">{t("common.loading")}</p>
          )}
          {preview.data?.html ? (
            <div
              className={proseMarkdownClass}
              dangerouslySetInnerHTML={{ __html: preview.data.html }}
            />
          ) : (
            !preview.isPending && (
              <p className="text-[11px] text-slate-500 italic">
                {value.trim()
                  ? t("composer.previewEmpty")
                  : t("composer.nothingToPreview")}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
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

function TbBtn({
  label,
  title,
  onClick,
  bold,
  italic,
  strike,
  mono,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}) {
  let cls = "min-w-[24px] h-6 px-1.5 text-[11px] text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition";
  if (bold) cls += " font-bold";
  if (italic) cls += " italic";
  if (strike) cls += " line-through";
  if (mono) cls += " font-mono";
  return (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {label}
    </button>
  );
}

function TbDivider() {
  return <span aria-hidden className="w-px h-4 bg-slate-800 mx-0.5" />;
}
