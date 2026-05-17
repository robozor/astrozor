import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  ListsToggle,
  DiffSourceToggleWrapper,
  Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "../styles/mdxeditor-dark.css";
import { useRef } from "react";

type Props = {
  markdown: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/**
 * Astrozor's WYSIWYG Markdown editor. Source-of-truth is Markdown — the
 * editor renders formatted text but emits Markdown via onChange, so the
 * backend pipeline (bleach sanitize → render_markdown → HTML) stays
 * unchanged.
 */
export function MarkdownEditor({ markdown, onChange, placeholder }: Props) {
  const ref = useRef<MDXEditorMethods>(null);
  return (
    <div className="astrozor-mdx bg-slate-950 ring-1 ring-slate-700 rounded-md overflow-hidden">
      <MDXEditor
        ref={ref}
        markdown={markdown}
        onChange={onChange}
        placeholder={placeholder}
        contentEditableClassName="astrozor-mdx-content"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: "python" }),
          codeMirrorPlugin({
            codeBlockLanguages: {
              python: "Python",
              r: "R",
              julia: "Julia",
              js: "JavaScript",
              ts: "TypeScript",
              sql: "SQL",
              bash: "Bash",
              "": "Plain text",
            },
          }),
          diffSourcePlugin({ viewMode: "rich-text" }),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertImage />
                <InsertTable />
                <InsertThematicBreak />
                <InsertCodeBlock />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
}
