/**
 * Tailwind classes for rendered markdown HTML inside our dark-theme
 * panels.
 *
 * One source of truth so issue bodies, GH comments, and the
 * Markdown composer preview all get the same look — paragraphs,
 * code blocks, blockquotes, and (now) tables styled to match.
 * Long string by necessity; Tailwind arbitrary-variant selectors
 * are how we reach nested HTML emitted by ``dangerouslySetInnerHTML``.
 */
export const proseMarkdownClass = [
  "prose prose-invert prose-sm max-w-none text-xs text-slate-200",
  "[&_p]:my-1",
  "[&_a]:text-indigo-300 [&_a]:underline",
  "[&_img]:max-w-full [&_img]:my-1",
  "[&_pre]:bg-slate-900 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto",
  "[&_code]:font-mono [&_code]:text-[11px]",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-700 [&_blockquote]:pl-2",
  // Tables — GFM tables rendered by markdown-it. Dark borders, subtle
  // header strip, horizontal scroll on narrow screens.
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11px]",
  "[&_thead]:bg-slate-800/60",
  "[&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-slate-700 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-slate-800 [&_td]:align-top",
  "[&_tr:nth-child(even)]:bg-slate-900/30",
].join(" ");
