// #964: fail-closed tarball extraction for downloaded module artifacts. The tarball is
// attacker-shaped input even though it came from our own release URL (a compromised
// release is exactly the threat model): only File/Directory entries, no absolute paths,
// no "..", bounded entry count and total extracted size (zip-bomb guard).
import { statSync } from "node:fs";

import * as tar from "tar";

// #999: a flat 4x ratio rejected the first real published module (job-search 0.1.0, 38,243 B
// tarball -> 170,118 B extracted = 4.45x) — gzip on JS/JSON routinely compresses 5-8x, so 4x was
// under-calibrated for legitimate modules, not an extra-safe margin. 10x covers that with headroom.
export const EXTRACT_MAX_RATIO = 10;
// #999: absolute floor so small tarballs aren't penalized by ratio math (a 4x cap on a ~40 KB
// tarball is ~160 KB, far below what a trivial legitimate module needs). The real decompression-
// bomb defenses are the 50 MiB ARTIFACT_MAX_BYTES download cap (enforced upstream before this
// function runs) and EXTRACT_MAX_ENTRIES below; this ratio+floor guard is a secondary control.
export const EXTRACT_MIN_ABSOLUTE = 4 * 1024 * 1024;
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
  // #999: floor prevents small legitimate tarballs from being penalized by ratio math alone.
  const maxTotalBytes = Math.max(
    statSync(tarballPath).size * EXTRACT_MAX_RATIO,
    EXTRACT_MIN_ABSOLUTE
  );
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
        // #999: reference the computed cap, not a stale "4x" literal — it's a max() of a ratio
        // and an absolute floor, so no single fixed multiplier describes it for every tarball size.
        violation = new ModuleTarballError(
          "too-large",
          `extracted size exceeds ${maxTotalBytes} byte cap (${EXTRACT_MAX_RATIO}x tarball size, floor ${EXTRACT_MIN_ABSOLUTE} bytes)`
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
