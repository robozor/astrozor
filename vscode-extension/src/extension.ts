import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  AstrozorApiError,
  publishArticle,
  publishQuarto,
  whoami,
} from "./api";
import { bundleHtml } from "./bundle";
import {
  clearToken,
  getToken,
  readConfig,
  setBaseUrl,
  setToken,
} from "./config";
import { firstH1, readFrontmatter, slugify } from "./frontmatter";
import { RenderError, renderQuarto } from "./render";

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Astrozor");
  context.subscriptions.push(output);

  const register = (id: string, handler: (uri?: vscode.Uri) => Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (uri?: vscode.Uri) => {
        try {
          await handler(uri);
        } catch (err) {
          await reportError(err);
        }
      }),
    );

  register("astrozor.publishArticle", (uri) => publishMarkdownCommand(context, uri));
  register("astrozor.publishQuarto", (uri) => publishQuartoCommand(context, uri));
  register("astrozor.publishFolder", (uri) => publishFolderCommand(context, uri));
  register("astrozor.setToken", () => setTokenCommand(context));
  register("astrozor.clearToken", () => clearTokenCommand(context));
  register("astrozor.setBaseUrl", () => setBaseUrlCommand());
  register("astrozor.whoami", () => whoamiCommand(context));
}

export function deactivate(): void {
  // no-op
}

// ---- helpers --------------------------------------------------------------

async function reportError(err: unknown): Promise<void> {
  if (err instanceof AstrozorApiError) {
    const hint =
      err.status === 401
        ? " Run “Astrozor: Set API token” to refresh your credentials."
        : err.status === 403
          ? " The token is missing the publish:articles scope."
          : err.status === 507
            ? " Storage quota exceeded — delete older articles or ask an admin."
            : "";
    await vscode.window.showErrorMessage(`Astrozor: ${err.status} — ${err.detail}.${hint}`);
    return;
  }
  if (err instanceof RenderError) {
    await vscode.window.showErrorMessage(`Astrozor: ${err.message}`);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  await vscode.window.showErrorMessage(`Astrozor: ${msg}`);
}

async function requireToken(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const token = await getToken(context.secrets);
  if (token) return token;
  const action = await vscode.window.showWarningMessage(
    "No Astrozor API token configured. Create one in Settings → API tokens, then paste it here.",
    "Set token",
    "Cancel",
  );
  if (action === "Set token") {
    await setTokenCommand(context);
    return getToken(context.secrets);
  }
  return undefined;
}

async function resolveTargetUri(
  uri: vscode.Uri | undefined,
  fallbackExts: string[],
): Promise<vscode.Uri | undefined> {
  if (uri) return uri;
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    await vscode.window.showWarningMessage(
      `Open or right-click a ${fallbackExts.join(" / ")} file first.`,
    );
    return undefined;
  }
  if (doc.isUntitled) {
    await vscode.window.showWarningMessage("Save the file before publishing.");
    return undefined;
  }
  return doc.uri;
}

interface PublishMeta {
  title: string;
  slug: string;
  summary: string;
  language: string;
}

async function promptPublishMeta(
  defaults: PublishMeta,
  confirmEnabled: boolean,
): Promise<PublishMeta | undefined> {
  if (!confirmEnabled) return defaults;

  const title = await vscode.window.showInputBox({
    title: "Astrozor — title",
    value: defaults.title,
    prompt: "Article title (shown on Astrozor)",
    validateInput: (v) => (v.trim().length >= 2 ? undefined : "Title must be at least 2 characters."),
  });
  if (title === undefined) return undefined;

  const slug = await vscode.window.showInputBox({
    title: "Astrozor — slug (URL)",
    value: defaults.slug,
    prompt: "Re-using the same slug updates the existing article (idempotent).",
  });
  if (slug === undefined) return undefined;

  const summary = await vscode.window.showInputBox({
    title: "Astrozor — short summary (optional)",
    value: defaults.summary,
    prompt: "Shown on the article list. Leave empty to skip.",
  });
  if (summary === undefined) return undefined;

  const language = await vscode.window.showQuickPick(
    [
      { label: "cs", description: "Čeština" },
      { label: "en", description: "English" },
    ],
    {
      title: "Astrozor — language",
      placeHolder: defaults.language,
    },
  );
  if (!language) return undefined;

  return { title: title.trim(), slug: slug.trim(), summary: summary.trim(), language: language.label };
}

// ---- commands -------------------------------------------------------------

async function publishMarkdownCommand(
  context: vscode.ExtensionContext,
  rawUri?: vscode.Uri,
): Promise<void> {
  const uri = await resolveTargetUri(rawUri, [".md"]);
  if (!uri) return;
  const file = uri.fsPath;
  if (!file.toLowerCase().endsWith(".md")) {
    await vscode.window.showWarningMessage("This command only handles .md files.");
    return;
  }

  const token = await requireToken(context);
  if (!token) return;
  const cfg = readConfig();

  const text = await fs.promises.readFile(file, "utf8");
  const fm = readFrontmatter(file);
  const stem = path.basename(file, path.extname(file));
  const defaults: PublishMeta = {
    title: fm.title ?? firstH1(text) ?? stem,
    slug: slugify(stem),
    summary: fm.summary ?? "",
    language: fm.language ?? cfg.defaultLanguage,
  };

  const meta = await promptPublishMeta(defaults, cfg.confirmBeforePublish);
  if (!meta) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Astrozor — publishing ${path.basename(file)}…`,
      cancellable: false,
    },
    async () => {
      const result = await publishArticle(cfg.baseUrl, token, {
        title: meta.title,
        summary: meta.summary,
        language: meta.language,
        license: cfg.defaultLicense,
        content_md: stripFrontmatter(text),
      });
      await showPublished(cfg.baseUrl, result.url);
    },
  );
}

async function publishQuartoCommand(
  context: vscode.ExtensionContext,
  rawUri?: vscode.Uri,
): Promise<void> {
  const uri = await resolveTargetUri(rawUri, [".qmd", ".Rmd", ".rmd"]);
  if (!uri) return;
  const file = uri.fsPath;
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".qmd" && ext !== ".rmd") {
    await vscode.window.showWarningMessage("This command only handles .qmd / .Rmd files.");
    return;
  }
  if (ext === ".rmd") {
    await vscode.window.showWarningMessage(
      "RMarkdown rendering is not built into this extension. Render to .html first, then use “Astrozor: Publish folder”.",
    );
    return;
  }

  const token = await requireToken(context);
  if (!token) return;
  const cfg = readConfig();

  const fm = readFrontmatter(file);
  if (fm.runtime?.toLowerCase().includes("shiny")) {
    await vscode.window.showErrorMessage(
      `Document declares runtime: ${fm.runtime} — Shiny apps need a live R server, ` +
        `Astrozor only publishes static HTML.`,
    );
    return;
  }

  const stem = path.basename(file, path.extname(file));
  const defaults: PublishMeta = {
    title: fm.title ?? stem,
    slug: slugify(stem),
    summary: fm.summary ?? "",
    language: fm.language ?? cfg.defaultLanguage,
  };
  const meta = await promptPublishMeta(defaults, cfg.confirmBeforePublish);
  if (!meta) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Astrozor — rendering ${path.basename(file)}…`,
      cancellable: false,
    },
    async (progress) => {
      const rendered = await renderQuarto(file, cfg.quartoExecutable, output);
      progress.report({ message: "Bundling HTML…" });
      const bundle = await bundleHtml({ source: rendered.htmlPath, hint: meta.slug });
      try {
        progress.report({ message: "Uploading…" });
        const result = await publishQuarto(cfg.baseUrl, token, {
          zipPath: bundle.zipPath,
          title: meta.title,
          slug: meta.slug,
          summary: meta.summary,
          language: meta.language,
          engine: "quarto",
          license: cfg.defaultLicense,
        });
        await showPublished(cfg.baseUrl, result.url);
      } finally {
        await bundle.cleanup();
      }
    },
  );
}

async function publishFolderCommand(
  context: vscode.ExtensionContext,
  rawUri?: vscode.Uri,
): Promise<void> {
  let uri = rawUri;
  if (!uri) {
    const picks = await vscode.window.showOpenDialog({
      title: "Astrozor — pick folder containing index.html",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    uri = picks?.[0];
  }
  if (!uri) return;
  const folder = uri.fsPath;
  const stat = await fs.promises.stat(folder);
  if (!stat.isDirectory()) {
    await vscode.window.showWarningMessage("Selected path is not a folder.");
    return;
  }

  const token = await requireToken(context);
  if (!token) return;
  const cfg = readConfig();

  const stem = path.basename(folder);
  const defaults: PublishMeta = {
    title: stem,
    slug: slugify(stem),
    summary: "",
    language: cfg.defaultLanguage,
  };
  const meta = await promptPublishMeta(defaults, cfg.confirmBeforePublish);
  if (!meta) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Astrozor — bundling ${stem}…`,
      cancellable: false,
    },
    async (progress) => {
      const bundle = await bundleHtml({ source: folder, hint: meta.slug });
      try {
        progress.report({ message: "Uploading…" });
        const result = await publishQuarto(cfg.baseUrl, token, {
          zipPath: bundle.zipPath,
          title: meta.title,
          slug: meta.slug,
          summary: meta.summary,
          language: meta.language,
          engine: "quarto",
          license: cfg.defaultLicense,
        });
        await showPublished(cfg.baseUrl, result.url);
      } finally {
        await bundle.cleanup();
      }
    },
  );
}

async function setTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Astrozor — paste your API token",
    prompt: "Create one in Astrozor → Settings → API tokeny (scope: publish:articles).",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.startsWith("ast_") ? undefined : 'Astrozor tokens start with "ast_".',
  });
  if (!value) return;
  await setToken(context.secrets, value.trim());
  await vscode.window.showInformationMessage("Astrozor token stored in VS Code Secret Storage.");
}

async function clearTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  await clearToken(context.secrets);
  await vscode.window.showInformationMessage("Astrozor token removed.");
}

async function setBaseUrlCommand(): Promise<void> {
  const cfg = readConfig();
  const value = await vscode.window.showInputBox({
    title: "Astrozor — base URL",
    prompt: "e.g. https://astrozor.cz or http://astrozor.localhost",
    value: cfg.baseUrl,
    ignoreFocusOut: true,
    validateInput: (v) =>
      /^https?:\/\/[^\s]+$/.test(v) ? undefined : "Must be a full http(s):// URL.",
  });
  if (!value) return;
  await setBaseUrl(value);
  await vscode.window.showInformationMessage(`Astrozor base URL set to ${value.replace(/\/+$/, "")}.`);
}

async function whoamiCommand(context: vscode.ExtensionContext): Promise<void> {
  const token = await requireToken(context);
  if (!token) return;
  const cfg = readConfig();
  const me = await whoami(cfg.baseUrl, token);
  await vscode.window.showInformationMessage(
    `Astrozor: ${me.user_email} (token “${me.token_name}”, scopes: ${me.scopes.join(", ") || "—"}).`,
  );
}

// ---- post-publish UI ------------------------------------------------------

async function showPublished(baseUrl: string, articleUrl: string): Promise<void> {
  const full = `${baseUrl}${articleUrl}`;
  const action = await vscode.window.showInformationMessage(
    `Published: ${full}`,
    "Open in browser",
    "Copy URL",
  );
  if (action === "Open in browser") {
    await vscode.env.openExternal(vscode.Uri.parse(full));
  } else if (action === "Copy URL") {
    await vscode.env.clipboard.writeText(full);
  }
}

function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !/^---\s*$/.test(lines[0]!)) return text;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i]!)) {
      return lines.slice(i + 1).join("\n").replace(/^\s+/, "");
    }
  }
  return text;
}
