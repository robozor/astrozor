// Minimal ambient module declaration for `markdownz` (Zooniverse's React
// markdown renderer — https://github.com/zooniverse/markdownz). The package
// ships only CJS + PropTypes, no .d.ts. We use the <Markdown /> component
// to render Zooniverse project descriptions with their custom flavour
// (=NNNx image sizing, +tab+ links, GFM tables). Other exports
// (MarkdownEditor, MarkdownHelp, useMarkdownz) are not yet used.
declare module "markdownz" {
  import type { ComponentType, ReactNode } from "react";

  interface MarkdownProps {
    content?: string;
    children?: ReactNode;
    className?: string;
    tag?: keyof JSX.IntrinsicElements;
    baseURI?: string;
    relNoFollow?: boolean;
    inline?: boolean;
    idPrefix?: string;
    project?: object | null;
    settings?: object;
    debug?: boolean;
  }

  export const Markdown: ComponentType<MarkdownProps>;
}
