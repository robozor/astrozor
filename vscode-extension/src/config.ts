import * as vscode from "vscode";

const TOKEN_KEY = "astrozor.apiToken";

export interface AstrozorConfig {
  baseUrl: string;
  defaultLanguage: "cs" | "en";
  defaultLicense: string;
  quartoExecutable: string;
  confirmBeforePublish: boolean;
}

export function readConfig(): AstrozorConfig {
  const cfg = vscode.workspace.getConfiguration("astrozor");
  const baseUrl = (cfg.get<string>("baseUrl") ?? "https://astrozor.cz").replace(/\/+$/, "");
  return {
    baseUrl,
    defaultLanguage: (cfg.get<string>("defaultLanguage") ?? "cs") as "cs" | "en",
    defaultLicense: cfg.get<string>("defaultLicense") ?? "CC BY 4.0",
    quartoExecutable: cfg.get<string>("quartoExecutable") ?? "quarto",
    confirmBeforePublish: cfg.get<boolean>("confirmBeforePublish") ?? true,
  };
}

export async function getToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(TOKEN_KEY);
}

export async function setToken(secrets: vscode.SecretStorage, token: string): Promise<void> {
  await secrets.store(TOKEN_KEY, token);
}

export async function clearToken(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(TOKEN_KEY);
}

export async function setBaseUrl(url: string): Promise<void> {
  const cleaned = url.trim().replace(/\/+$/, "");
  await vscode.workspace
    .getConfiguration("astrozor")
    .update("baseUrl", cleaned, vscode.ConfigurationTarget.Global);
}
