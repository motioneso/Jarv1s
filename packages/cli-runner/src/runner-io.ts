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
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { TmuxIo } from "@jarv1s/ai";

import { buildSanitizedCliEnv } from "./sanitized-env.js";

const execFileAsync = promisify(execFile);

export function createSanitizedTmuxIo(source: NodeJS.ProcessEnv = process.env): TmuxIo {
  const baseEnv = buildSanitizedCliEnv(source);
  return {
    run: async (cmd, args, opts) => {
      const env = opts?.env ? { ...baseEnv, ...opts.env } : baseEnv;
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [...args], {
          env,
          cwd: opts?.cwd
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
    },
    async sleep(ms: number): Promise<void> {
      return new Promise((res) => setTimeout(res, ms));
    }
  };
}
