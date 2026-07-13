import { homedir } from "node:os";
import { join } from "node:path";

import { agyPrintTranscriptRoot, transcriptGlobDir, type TmuxIo } from "@jarv1s/ai";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function purgeAgyBrainDir(
  io: Pick<TmuxIo, "run">,
  capturedUuid: string | null | undefined,
  homeBase?: string
): Promise<boolean> {
  if (!capturedUuid || !UUID_PATTERN.test(capturedUuid)) return false;
  await io.run("rm", ["-rf", join(agyPrintTranscriptRoot(homeBase), capturedUuid)]);
  return true;
}

export async function purgePrivateTranscripts(
  io: Pick<TmuxIo, "run" | "readFile">,
  neutralBase: string,
  sessionKey: string,
  homeBase?: string
): Promise<void> {
  const neutralDir = deriveNeutralDir(neutralBase, sessionKey);
  await io.run("rm", ["-rf", transcriptGlobDir("anthropic", neutralDir, homeBase)]);
  // Private transcript cleanup is intentionally scoped to Claude + interactive Codex.
  // Gemini, agy-print, and codex-exec paths stay inert here until #868 lands.
  await purgeMatchingJsonl(io, codexSessionsRoot(homeBase), neutralDir);
}

export function codexTranscriptMatchesCwd(jsonl: string, expectedCwd: string): boolean {
  for (const line of jsonl.split("\n").slice(0, 50)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record["type"] !== "session_meta") continue;
    const payload = record["payload"];
    if (!isRecord(payload)) continue;
    return payload["cwd"] === expectedCwd;
  }
  return false;
}

function codexSessionsRoot(homeBase: string = homedir()): string {
  return join(homeBase, ".codex", "sessions");
}

function deriveNeutralDir(neutralBase: string, sessionKey: string): string {
  return join(neutralBase, sanitizeSessionKey(sessionKey));
}

function sanitizeSessionKey(sessionKey: string): string {
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

async function purgeMatchingJsonl(
  io: Pick<TmuxIo, "run" | "readFile">,
  dir: string,
  expectedCwd: string
): Promise<void> {
  const listed = await io.run("find", [dir, "-type", "f", "-name", "*.jsonl"]);
  if (listed.code !== 0) return;
  const candidates = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const path of candidates) {
    try {
      const jsonl = await io.readFile(path);
      if (codexTranscriptMatchesCwd(jsonl, expectedCwd)) await io.run("rm", ["-f", path]);
    } catch {
      // best-effort: the next sweep retries any unreadable file.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
