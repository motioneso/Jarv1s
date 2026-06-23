/**
 * A TmuxIo whose `run` spawns subprocesses with the §7.2 SANITIZED env allowlist —
 * NOT the cli-runner server's env. This is the seam that keeps app secrets, the socket
 * path, and the RPC secret out of every tmux/CLI child the engine launches.
 *
 * It mirrors `createRealTmuxIo` (execFile, not a shell; ENOENT/exit-code tolerant) but
 * the child env is the allowlist ONLY — `opts.env` (per-call extras like a cwd-scoped
 * var) is layered OVER the allowlist, never the full `process.env`.
 */

import { execFile } from "node:child_process";
import { chown, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { TmuxIo } from "@jarv1s/ai";

import { buildSanitizedCliEnv } from "./sanitized-env.js";

const execFileAsync = promisify(execFile);

/**
 * Build a TmuxIo whose `run()` spawns every subprocess (tmux, mkdir, chmod, …) with
 * the §7.2 sanitized env. When `spawnOpts` carries a uid/gid (#347), every subprocess
 * AND every writeFile chown runs under that identity — so the launched CLI, the neutral
 * dir it lives in, and its config files are all owned by the per-user UID.
 */
export function createSanitizedTmuxIo(
  source: NodeJS.ProcessEnv = process.env,
  spawnOpts?: { uid?: number; gid?: number }
): TmuxIo {
  const baseEnv = buildSanitizedCliEnv(source);
  return {
    run: async (cmd, args, opts) => {
      const env = opts?.env ? { ...baseEnv, ...opts.env } : baseEnv;
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [...args], {
          env,
          cwd: opts?.cwd,
          uid: spawnOpts?.uid,
          gid: spawnOpts?.gid
        });
        return { code: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return {
          code: typeof e.code === "number" ? e.code : 1,
          stdout: e.stdout ?? "",
          stderr: e.stderr
        };
      }
    },
    async readFile(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
    async writeFile(path: string, content: string): Promise<void> {
      await writeFile(path, content, "utf8");
      // Chown the file to the per-user UID/GID so the CLI child (running as that UID)
      // can chmod and read it. The `chmod 600` calls in the engine run as uid spawnOpts.uid
      // and require owning the file.
      if (spawnOpts?.uid !== undefined && spawnOpts?.gid !== undefined) {
        await chown(path, spawnOpts.uid, spawnOpts.gid).catch(() => undefined);
      }
    },
    async sleep(ms: number): Promise<void> {
      return new Promise((res) => setTimeout(res, ms));
    }
  };
}
