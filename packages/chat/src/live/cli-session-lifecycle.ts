import { join } from "node:path";

import type { TmuxIo } from "@jarv1s/ai";

export const SESSION_PREFIX = "jarv1s-live-";

/** Kill only the exact canonical mux session, even when no engine object survives. */
export async function killMuxSessionByName(
  io: Pick<TmuxIo, "run">,
  sessionKey: string
): Promise<void> {
  const name = `${SESSION_PREFIX}${sanitizeSessionKey(sessionKey)}`;
  await io.run("tmux", ["kill-session", "-t", `=${name}`]);
}

/** Enumerate live canonical session keys from the multiplexer. */
export async function listLiveMuxSessions(io: Pick<TmuxIo, "run">): Promise<string[]> {
  const listed = await io.run("tmux", ["list-sessions", "-F", "#{session_name}"]);
  if (listed.code !== 0) return [];
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(SESSION_PREFIX))
    .map((name) => name.slice(SESSION_PREFIX.length))
    .filter((key) => key.length > 0);
}

/** Remove one sanitized session's neutral directory. */
export async function removeNeutralDir(
  io: Pick<TmuxIo, "run">,
  neutralBase: string,
  sessionKey: string
): Promise<void> {
  await io.run("rm", ["-rf", deriveNeutralDir(neutralBase, sessionKey)]);
}

export function deriveNeutralDir(neutralBase: string, sessionKey: string): string {
  return join(neutralBase, sanitizeSessionKey(sessionKey));
}

export function sanitizeSessionKey(sessionKey: string): string {
  if (
    sessionKey.length === 0 ||
    sessionKey.includes("/") ||
    sessionKey.includes("\\") ||
    sessionKey.includes("\0") ||
    sessionKey === "." ||
    sessionKey === ".." ||
    sessionKey.includes("..")
  ) {
    throw new Error("invalid sessionKey");
  }
  return sessionKey;
}
