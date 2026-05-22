import archiver from "archiver";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ASSET_DIR_SUFFIXES = ["_files", "_cache"];
const ASSET_FIXED_DIRS = ["libs", "figures", "site_libs", "img", "images", "assets"];
const ASSET_FILE_EXTS = new Set([
  ".css",
  ".js",
  ".png",
  ".svg",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
]);

export interface BundleSource {
  /** Path to an .html file OR a directory containing one. */
  source: string;
  /** Optional explicit slug; used only to name the temp zip. */
  hint?: string;
}

export interface BundleResult {
  zipPath: string;
  cleanup: () => Promise<void>;
}

export async function bundleHtml({ source, hint }: BundleSource): Promise<BundleResult> {
  const resolved = path.resolve(source);
  const stat = await fs.promises.stat(resolved);

  let srcDir: string;
  let indexFile: string;
  if (stat.isDirectory()) {
    srcDir = resolved;
    indexFile = await pickIndexHtml(srcDir);
  } else {
    if (!resolved.toLowerCase().endsWith(".html")) {
      throw new Error(`Expected a directory or .html file, got: ${resolved}`);
    }
    srcDir = path.dirname(resolved);
    indexFile = resolved;
  }

  const stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "astrozor-bundle-"));
  await fs.promises.copyFile(indexFile, path.join(stageRoot, "index.html"));

  const stem = path.basename(indexFile, path.extname(indexFile));
  const candidateDirs = [
    ...ASSET_DIR_SUFFIXES.map((s) => path.join(srcDir, `${stem}${s}`)),
    ...ASSET_FIXED_DIRS.map((d) => path.join(srcDir, d)),
  ];
  for (const d of candidateDirs) {
    if (await pathExists(d)) {
      await copyDir(d, path.join(stageRoot, path.basename(d)));
    }
  }

  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ASSET_FILE_EXTS.has(ext)) continue;
    await fs.promises.copyFile(
      path.join(srcDir, entry.name),
      path.join(stageRoot, entry.name),
    );
  }

  const zipName = (hint || stem || "bundle").replace(/[^a-z0-9._-]/gi, "-") + ".zip";
  const zipPath = path.join(os.tmpdir(), `astrozor-${Date.now()}-${zipName}`);
  await zipDirectory(stageRoot, zipPath);

  return {
    zipPath,
    cleanup: async () => {
      await safeRm(stageRoot);
      await safeRm(zipPath);
    },
  };
}

async function pickIndexHtml(dir: string): Promise<string> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const htmls = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
    .map((e) => path.join(dir, e.name));
  if (htmls.length === 0) {
    throw new Error(`No .html file found in ${dir}`);
  }
  const index = htmls.find((h) => path.basename(h).toLowerCase() === "index.html");
  return index ?? htmls[0];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.promises.copyFile(s, d);
    }
  }
}

function zipDirectory(srcDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize().catch(reject);
  });
}

async function safeRm(p: string): Promise<void> {
  try {
    await fs.promises.rm(p, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
