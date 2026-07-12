// #964: fail-closed tarball extraction for downloaded module artifacts. The tarball is
// attacker-shaped input even though it came from our own release URL (a compromised
// release is exactly the threat model): only File/Directory entries, no absolute paths,
// no "..", bounded entry count and total extracted size (zip-bomb guard).
import { statSync } from "node:fs";

import * as tar from "tar";

export const EXTRACT_MAX_RATIO = 4;
export const EXTRACT_MAX_ENTRIES = 2000;

export type ModuleTarballErrorCode = "entry-type" | "entry-path" | "too-many-entries" | "too-large";

export class ModuleTarballError extends Error {
  constructor(
    readonly code: ModuleTarballErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ModuleTarballError";
  }
}

const isSafeEntryPath = (path: string): boolean => {
  if (path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return false;
  return !segments.includes("..");
};

export async function safeExtractModuleTarball(
  tarballPath: string,
  destDir: string
): Promise<void> {
  const maxTotalBytes = statSync(tarballPath).size * EXTRACT_MAX_RATIO;
  let entryCount = 0;
  let totalBytes = 0;
  let violation: ModuleTarballError | null = null;
  // Validation pass BEFORE extraction: nothing touches disk until every entry passes.
  // Violations are RECORDED, never thrown, inside onReadEntry: node-tar's list() wraps
  // the callback as `e => { onReadEntry(e); e.resume(); }` — a synchronous throw here
  // skips that trailing resume(), so the entry's data stream never drains (a 30s hang)
  // and the throw surfaces as an uncaught exception instead of rejecting tar.t()'s
  // promise. Recording + returning normally lets tar auto-resume every entry; we throw
  // once, after the full pass completes.
  await tar.t({
    file: tarballPath,
    onReadEntry: (entry) => {
      if (violation) return;
      entryCount += 1;
      if (entryCount > EXTRACT_MAX_ENTRIES) {
        violation = new ModuleTarballError(
          "too-many-entries",
          `more than ${EXTRACT_MAX_ENTRIES} entries`
        );
        return;
      }
      if (entry.type !== "File" && entry.type !== "Directory") {
        violation = new ModuleTarballError(
          "entry-type",
          `forbidden entry type ${entry.type}: ${entry.path}`
        );
        return;
      }
      if (!isSafeEntryPath(String(entry.path))) {
        violation = new ModuleTarballError("entry-path", `unsafe entry path: ${entry.path}`);
        return;
      }
      totalBytes += entry.size ?? 0;
      if (totalBytes > maxTotalBytes) {
        violation = new ModuleTarballError(
          "too-large",
          `extracted size exceeds ${EXTRACT_MAX_RATIO}x tarball size`
        );
      }
    }
  });
  if (violation) throw violation;
  // Extraction pass re-applies the path/type filter — defense in depth against a
  // tar library reading entries differently across the two passes.
  await tar.x({
    file: tarballPath,
    cwd: destDir,
    filter: (path, entry) =>
      // tar.x's filter type is `Stats | ReadEntry` (Stats has no `.type`) — narrow first.
      "type" in entry &&
      (entry.type === "File" || entry.type === "Directory") &&
      isSafeEntryPath(String(path))
  });
}
