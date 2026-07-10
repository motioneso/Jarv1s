// Content hashing for external module packages (#917). Server-only (node:*): the
// manifest hash is the trust anchor recorded at admin-enable, and the package hash
// is compared against it on every load — any drift auto-disables the module. Both
// are deterministic and independent of filesystem ordering.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

export function hashExternalPackage(dir: string): string {
  // The hashable set: the manifest, the worker bundle, and everything the web bundle
  // ships. Anything else in the mounted dir is ignored so unrelated files can't churn
  // the hash. Files that don't exist are simply omitted (a Slice-1 metadata-only module
  // may ship only the manifest).
  const relPaths: string[] = [];
  if (existsSync(join(dir, "jarvis.module.json"))) relPaths.push("jarvis.module.json");
  if (existsSync(join(dir, "dist", "worker.js"))) relPaths.push("dist/worker.js");
  const webDir = join(dir, "dist", "web");
  if (existsSync(webDir) && statSync(webDir).isDirectory()) {
    for (const rel of walkFiles(webDir)) relPaths.push(`dist/web/${rel}`);
  }

  const digest = createHash("sha256");
  for (const rel of relPaths.sort()) {
    const fileHash = sha256Hex(readFileSync(join(dir, rel)));
    digest.update(`${rel}\0${fileHash}\n`);
  }
  return `sha256:${digest.digest("hex")}`;
}
