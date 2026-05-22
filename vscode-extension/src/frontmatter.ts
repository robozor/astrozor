import * as fs from "node:fs";

const FENCE = /^---\s*$/;

export interface Frontmatter {
  title?: string;
  language?: string;
  runtime?: string;
  summary?: string;
}

/**
 * Lightweight YAML frontmatter reader for top-level scalar keys. Skips
 * nested keys (indented lines). Returns undefined when the document has
 * no frontmatter or the file can't be read.
 */
export function readFrontmatter(filePath: string): Frontmatter {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  return parseFrontmatter(text);
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FENCE.test(lines[0]!)) {
    return {};
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (FENCE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {};
  }
  const result: Frontmatter = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]!;
    if (/^\s+/.test(line)) continue; // nested
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const raw = m[2]!.trim();
    const value = stripQuotes(raw);
    if (!value) continue;
    if (key === "title") result.title = value;
    else if (key === "lang" || key === "language") result.language = value;
    else if (key === "runtime") result.runtime = value;
    else if (key === "subtitle" || key === "description" || key === "summary") {
      if (!result.summary) result.summary = value;
    }
  }
  return result;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const H1 = /^#\s+(.+?)\s*$/;

/** Fallback title extraction: first H1 in a markdown document. */
export function firstH1(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const m = H1.exec(raw);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
