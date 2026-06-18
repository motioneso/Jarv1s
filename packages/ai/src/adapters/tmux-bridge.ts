import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

import { type ProviderKind } from "./transcript-reader.js";

// ─── Public interface ────────────────────────────────────────────────────────

export interface RunOptions {
  /** Extra environment variables, merged over process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Working directory for the child process. */
  readonly cwd?: string;
}

export interface TmuxIo {
  /** Run an external command; resolve to { code, stdout }. */
  run(
    cmd: string,
    args: readonly string[],
    opts?: RunOptions
  ): Promise<{ code: number; stdout: string; stderr?: string }>;
  /** Read a file path to a string (may throw if not yet created). */
  readFile(path: string): Promise<string>;
  /** Write a string to a file path (overwrites). */
  writeFile(path: string, content: string): Promise<void>;
  /** Non-blocking sleep. */
  sleep(ms: number): Promise<void>;
}

const execFileAsync = promisify(execFile);

/**
 * The real TmuxIo backed by node:child_process and node:fs/promises. This is the
 * single shared production implementation used by both TmuxBridgeAdapter (one-shot
 * turns) and the live persistent-session engine; tests inject a fake instead.
 */
export function createRealTmuxIo(): TmuxIo {
  return {
    run: async (cmd, args, opts) => {
      // Use execFile (not exec) so arguments are passed directly to the process
      // without a shell re-parsing them. A shell join would mangle args containing
      // spaces, quotes, pipes, or redirects (e.g. the `bash -c "<pipeline>"` calls).
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [...args], {
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
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
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  };
}

/**
 * Resolve the path of the JSONL transcript that the CLI writes during an
 * interactive session.  These paths were discovered from real installs:
 *
 * - anthropic / Claude Code:
 *     Writes a JSONL file per session under
 *     ~/.claude/projects/<url-encoded-cwd>/<uuid>.jsonl
 *     We cannot know the session UUID before the session starts, so we look
 *     for the most-recently-modified *.jsonl under the project directory.
 *
 * - openai-compatible / Codex:
 *     Writes session rolls under
 *     ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<uuid>.jsonl
 *     Again, use the newest file under today's directory.
 *
 * - google / Gemini CLI:
 *     Writes session chats under
 *     ~/.gemini/tmp/<lowercase-project-dir-basename>/chats/session-<ISO>-<uuid>.jsonl
 *     Use the newest file under the chats directory for the given project dir.
 */
export function transcriptGlobDir(
  provider: ProviderKind,
  cwd: string,
  homeBase: string = homedir()
): string {
  switch (provider) {
    case "anthropic": {
      // Claude Code encodes the project dir by replacing both "/" and "." with
      // "-", and KEEPS the leading "-" (an absolute path starts with "/").
      // e.g. ~/Jarv1s/apps/worker -> -home-ben-Jarv1s-apps-worker
      const encoded = cwd.replace(/[/.]/g, "-");
      return join(homeBase, ".claude", "projects", encoded);
    }
    case "openai-compatible": {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return join(homeBase, ".codex", "sessions", String(y), m, d);
    }
    case "google": {
      const projectDir = basename(cwd).toLowerCase();
      return join(homeBase, ".gemini", "tmp", projectDir, "chats");
    }
  }
}
