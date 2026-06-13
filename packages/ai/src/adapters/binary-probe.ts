/**
 * createBinaryProbe — eagerly scans PATH once for the multiplexer binaries and
 * caches the result. No shell, no execFile: it stats `${dir}/${bin}` for each PATH
 * entry through an injectable fs seam, so it is deterministic and unit-testable.
 */
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface BinaryProbe {
  has(bin: "tmux" | "herdr"): boolean;
}

export interface BinaryProbeIo {
  /** True if `path` exists and is executable by this process. */
  isExecutable(path: string): boolean;
}

export function createRealBinaryProbeIo(): BinaryProbeIo {
  return {
    isExecutable(path: string): boolean {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function createBinaryProbe(
  env: NodeJS.ProcessEnv = process.env,
  io: BinaryProbeIo = createRealBinaryProbeIo()
): BinaryProbe {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const found = (bin: string): boolean => dirs.some((d) => io.isExecutable(join(d, bin)));
  const cache = { tmux: found("tmux"), herdr: found("herdr") };
  return { has: (bin) => cache[bin] };
}
