// Path containment for serving untrusted external-module web assets (#918).
// Threat model: a hostile package (or hostile request) using ".." segments,
// absolute paths, or symlinks placed inside the package to read arbitrary host
// files via GET /api/modules/:moduleId/web/*. Mirrors external/hash.ts's
// realpath+prefix containment and node.ts's never-leak-raw-fs-errors rule.
import { existsSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, sep } from "node:path";

export const MODULE_WEB_ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

export type ModuleAssetRejectionReason =
  | "empty"
  | "absolute"
  | "traversal"
  | "unsupported-type"
  | "not-found"
  | "outside-package";

export class ModuleAssetPathError extends Error {
  constructor(readonly reason: ModuleAssetRejectionReason) {
    // Reason token only — never the requested path or any resolved on-disk path.
    super(`module asset rejected: ${reason}`);
    this.name = "ModuleAssetPathError";
  }
}

export interface ResolvedModuleAsset {
  readonly absPath: string;
  readonly contentType: string;
}

export function resolveModuleAssetPath(moduleDir: string, relPath: string): ResolvedModuleAsset {
  if (relPath.length === 0 || relPath.includes("\0")) throw new ModuleAssetPathError("empty");
  // POSIX-relative only: reject absolute paths and backslash separators outright.
  if (isAbsolute(relPath) || relPath.includes("\\")) throw new ModuleAssetPathError("absolute");
  // Segment-level traversal check BEFORE any filesystem call. Fastify has
  // already percent-decoded the wildcard param, so encoded "..%2f" arrives
  // here as a literal ".." segment and is caught.
  if (relPath.split("/").some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
    throw new ModuleAssetPathError("traversal");
  }
  const contentType = MODULE_WEB_ASSET_CONTENT_TYPES[extname(relPath).toLowerCase()];
  if (!contentType) throw new ModuleAssetPathError("unsupported-type");

  // Realpath BOTH ends, then prefix-check — the same containment algorithm
  // external/hash.ts uses when packaging. This is what defeats symlinks: a
  // link inside the package pointing outside resolves to a real path that
  // fails the prefix check.
  const rootReal = realpathSync(moduleDir);
  const abs = join(rootReal, relPath);
  if (!existsSync(abs)) throw new ModuleAssetPathError("not-found");
  const real = realpathSync(abs);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    throw new ModuleAssetPathError("outside-package");
  }
  return { absPath: real, contentType };
}
