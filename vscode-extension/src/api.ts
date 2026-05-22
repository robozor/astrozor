import * as fs from "node:fs";
import * as path from "node:path";

export interface WhoAmI {
  user_email: string;
  token_name: string;
  scopes: string[];
}

export interface PublishArticleInput {
  title: string;
  summary?: string;
  language?: string;
  license?: string;
  content_md: string;
  tags?: string[];
}

export interface PublishArticleResult {
  article_slug: string;
  article_id: string;
  doi: string;
  status: string;
  url: string;
}

export interface PublishQuartoInput {
  zipPath: string;
  title: string;
  slug?: string;
  summary?: string;
  language?: string;
  engine?: "quarto" | "rmarkdown" | "jupyter";
  license?: string;
}

export interface PublishQuartoResult {
  article_slug: string;
  article_id: string;
  status: string;
  url: string;
  asset_url: string;
}

export class AstrozorApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Astrozor API ${status}: ${detail}`);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body === "object" && body && "detail" in body) {
      return String((body as { detail: unknown }).detail);
    }
    return JSON.stringify(body);
  } catch {
    try {
      return await response.text();
    } catch {
      return response.statusText;
    }
  }
}

export async function whoami(baseUrl: string, token: string): Promise<WhoAmI> {
  const response = await fetch(`${baseUrl}/api/v1/publish/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new AstrozorApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as WhoAmI;
}

export async function publishArticle(
  baseUrl: string,
  token: string,
  input: PublishArticleInput,
): Promise<PublishArticleResult> {
  const response = await fetch(`${baseUrl}/api/v1/publish/articles`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      schema_version: "1",
      title: input.title,
      summary: input.summary ?? "",
      language: input.language ?? "cs",
      engine: "markdown",
      license: input.license ?? "CC BY 4.0",
      tags: input.tags ?? [],
      content_md: input.content_md,
    }),
  });
  if (!response.ok) {
    throw new AstrozorApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as PublishArticleResult;
}

export async function publishQuarto(
  baseUrl: string,
  token: string,
  input: PublishQuartoInput,
): Promise<PublishQuartoResult> {
  const buf = await fs.promises.readFile(input.zipPath);
  const blob = new Blob([buf], { type: "application/zip" });
  const form = new FormData();
  form.append("bundle", blob, path.basename(input.zipPath));
  form.append("title", input.title);
  form.append("slug", input.slug ?? "");
  form.append("summary", input.summary ?? "");
  form.append("language", input.language ?? "cs");
  form.append("engine", input.engine ?? "quarto");
  form.append("license", input.license ?? "CC BY 4.0");
  form.append("published_via", "vscode");

  const response = await fetch(`${baseUrl}/api/v1/publish/quarto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new AstrozorApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as PublishQuartoResult;
}
