// Content hashing for external module packages (#917). Server-only (node:*): the
// manifest hash is the trust anchor recorded at admin-enable, and the package hash
// is compared against it on every load — any drift auto-disables the module. Both
// are deterministic and independent of filesystem ordering.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Recursively sort object keys so JSON.stringify is canonical (order-independent). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonicalManifest(manifest: unknown): string {
  return `sha256:${sha256Hex(JSON.stringify(canonicalize(manifest)))}`;
}

/** All files under `root` (recursive), returned as root-relative POSIX paths. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  }
  return out;
}

/**
 * Thrown when a hashable package path (`jarvis.module.json`, `dist/worker.js`, `dist/web`,
 * `sql`) is a symlink whose target resolves OUTSIDE the module directory (#917, Codex re-QA). The
 * approved #818 spec requires rejecting "symlinks escaping the module directory"; existsSync /
 * statSync / readFileSync all FOLLOW symlinks, so the package hash must prove containment first
 * — otherwise a symlinked package file would pull arbitrary on-disk content into the hash.
 * `relPath` is a fixed module-relative token (never an absolute path), so it is safe to surface.
 */
export class ExternalPackageEscapeError extends Error {
  constructor(readonly relPath: string) {
    super(`package path escapes the module directory: ${relPath}`);
    this.name = "ExternalPackageEscapeError";
  }
}

export function hashExternalPackage(dir: string): string {
  // #917 Codex re-QA: the module dir is already proven contained by the caller (node.ts).
  // Resolve it once so every hashable path can be proven to stay inside it. This closes the
  // symlink-follow gap: a symlinked jarvis.module.json / dist/worker.js / dist/web could
  // otherwise point at any on-disk file and be silently hashed (or its content read).
  const rootReal = realpathSync(dir);

  // Include a hashable path only if it exists AND its real target is contained. realpathSync
  // follows the final symlink; an out-of-dir target is an escape → reject the whole module.
  const includeIfContained = (rel: string): boolean => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return false;
    const real = realpathSync(abs);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) {
      throw new ExternalPackageEscapeError(rel);
    }
    return true;
  };

  // The hashable set: the manifest, the worker bundle, everything the web bundle ships, and
  // the sql migrations. Anything else in the mounted dir is ignored so unrelated files can't
  // churn the hash. Files that don't exist are simply omitted (a Slice-1 metadata-only module
  // may ship only the manifest).
  const relPaths: string[] = [];
  if (includeIfContained("jarvis.module.json")) relPaths.push("jarvis.module.json");
  if (includeIfContained(join("dist", "worker.js"))) relPaths.push("dist/worker.js");
  if (includeIfContained(join("dist", "web"))) {
    const webDir = join(dir, "dist", "web");
    // walkFiles descends real dirs and hashes real files only — a Dirent for a symlink reports
    // neither isDirectory nor isFile — so it never follows a nested symlink out of the tree.
    if (statSync(webDir).isDirectory()) {
      for (const rel of walkFiles(webDir)) relPaths.push(`dist/web/${rel}`);
    }
  }
  // #964: sql/** joins the hashable set. Module DDL is executed by the PRIVILEGED
  // installer, so a swapped migration file must invalidate the trusted package hash
  // exactly like a swapped worker bundle. Same containment discipline as dist/web.
  if (includeIfContained("sql")) {
    const sqlDir = join(dir, "sql");
    if (statSync(sqlDir).isDirectory()) {
      for (const rel of walkFiles(sqlDir)) relPaths.push(`sql/${rel}`);
    }
  }

  const digest = createHash("sha256");
  for (const rel of relPaths.sort()) {
    const fileHash = sha256Hex(readFileSync(join(dir, rel)));
    digest.update(`${rel}\0${fileHash}\n`);
  }
  return `sha256:${digest.digest("hex")}`;
}
