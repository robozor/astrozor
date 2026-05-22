import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export class RenderError extends Error {}

export interface RenderResult {
  htmlPath: string;
  stdout: string;
  stderr: string;
}

/**
 * Render a .qmd via the Quarto CLI. The Quarto CLI writes the HTML next to
 * the source (default), so after a successful exit we look for <stem>.html
 * in the same directory.
 */
export async function renderQuarto(
  qmdPath: string,
  quartoExecutable: string,
  output: vscode.OutputChannel,
): Promise<RenderResult> {
  if (!qmdPath.toLowerCase().endsWith(".qmd")) {
    throw new RenderError(`Expected a .qmd file, got: ${qmdPath}`);
  }
  const { stdout, stderr } = await runProcess(quartoExecutable, ["render", qmdPath], output);
  const html = path.join(
    path.dirname(qmdPath),
    `${path.basename(qmdPath, path.extname(qmdPath))}.html`,
  );
  if (!fs.existsSync(html)) {
    throw new RenderError(
      `Render finished but expected HTML was not found at ${html}. ` +
        `Check the Astrozor output channel for Quarto stderr.`,
    );
  }
  return { htmlPath: html, stdout, stderr };
}

function runProcess(
  cmd: string,
  args: string[],
  output: vscode.OutputChannel,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    output.appendLine(`$ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      output.append(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      output.append(text);
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new RenderError(
            `Could not run "${cmd}". Install Quarto (https://quarto.org/docs/get-started/) ` +
              `or set "astrozor.quartoExecutable" to its full path.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new RenderError(`Quarto render exited with code ${code}. See Astrozor output channel.`));
      }
    });
  });
}
