import { homedir } from "node:os";
import { join } from "node:path";

import { agyPrintTranscriptRoot, transcriptGlobDir, type TmuxIo } from "@jarv1s/ai";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODEX_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATED_CONVERSATION_PATTERN =
  /\bCreated conversation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/gi;
// Codex v0.141.0 surrounds the /status UUID with ANSI SGR resets; #1076 keeps parsing the raw pane because composer evidence also needs its ANSI bytes.
const CODEX_STATUS_SESSION_PATTERN =
  // eslint-disable-next-line no-control-regex -- terminal panes contain ANSI SGR escapes by design.
  /\bSession:\s+(?:\x1b\[[0-9;]*m)*([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\x1b\[[0-9;]*m)*(?=\s|$|│)/gi;

export const AGY_SESSION_LOG_FILENAME = ".jarvis-agy-session.log";
export const AGY_IDENTITY_FILENAME = ".jarvis-agy-conversation-id";
export const CODEX_IDENTITY_FILENAME = ".jarvis-codex-session-id";

export function parseAgyConversationUuid(log: string): string | null {
  const ids = new Set<string>();
  for (const match of log.matchAll(CREATED_CONVERSATION_PATTERN)) {
    if (match[1]) ids.add(match[1].toLowerCase());
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

export async function captureAgyConversationIdentity(
  io: Pick<TmuxIo, "readFile" | "writeFile" | "run">,
  neutralDir: string
): Promise<string | null> {
  let log: string;
  try {
    log = await io.readFile(join(neutralDir, AGY_SESSION_LOG_FILENAME));
  } catch {
    return null;
  }
  const uuid = parseAgyConversationUuid(log);
  if (uuid === null) return null;
  await persistIdentity(io, neutralDir, AGY_IDENTITY_FILENAME, uuid, "AGY conversation");
  return uuid;
}

export async function readAgyConversationIdentity(
  io: Pick<TmuxIo, "readFile">,
  neutralDir: string
): Promise<string | null> {
  try {
    const uuid = (await io.readFile(join(neutralDir, AGY_IDENTITY_FILENAME))).trim();
    return UUID_PATTERN.test(uuid) ? uuid.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function purgeAgyBrainDir(
  io: Pick<TmuxIo, "run">,
  capturedUuid: string | null | undefined,
  homeBase?: string
): Promise<boolean> {
  if (!capturedUuid || !UUID_PATTERN.test(capturedUuid)) return false;
  const removed = await io.run("rm", [
    "-rf",
    join(agyPrintTranscriptRoot(homeBase), capturedUuid.toLowerCase())
  ]);
  return removed.code === 0;
}

export function parseCodexSessionUuid(pane: string): string | null {
  const ids = new Set<string>();
  for (const match of pane.matchAll(CODEX_STATUS_SESSION_PATTERN)) {
    if (match[1]) ids.add(match[1].toLowerCase());
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

export async function persistCodexSessionIdentity(
  io: Pick<TmuxIo, "writeFile" | "run">,
  neutralDir: string,
  uuid: string
): Promise<void> {
  if (!CODEX_UUID_PATTERN.test(uuid)) throw new Error("invalid Codex session identity");
  await persistIdentity(
    io,
    neutralDir,
    CODEX_IDENTITY_FILENAME,
    uuid.toLowerCase(),
    "Codex session"
  );
}

export async function readCodexSessionIdentity(
  io: Pick<TmuxIo, "readFile">,
  neutralDir: string
): Promise<string | null> {
  try {
    const uuid = (await io.readFile(join(neutralDir, CODEX_IDENTITY_FILENAME))).trim();
    return CODEX_UUID_PATTERN.test(uuid) ? uuid.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function codexTranscriptPath(uuid: string, homeBase: string = homedir()): string {
  if (!CODEX_UUID_PATTERN.test(uuid)) throw new Error("invalid Codex session identity");
  const timestamp = Number(BigInt(`0x${uuid.replaceAll("-", "").slice(0, 12)}`));
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("invalid Codex session identity");
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return join(
    codexSessionsRoot(homeBase),
    year,
    month,
    day,
    `rollout-${year}-${month}-${day}T${hour}-${minute}-${second}-${uuid.toLowerCase()}.jsonl`
  );
}

export function codexTranscriptMatchesIdentity(
  jsonl: string,
  expectedUuid: string,
  expectedCwd: string
): boolean {
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
    return payload["id"] === expectedUuid && payload["cwd"] === expectedCwd;
  }
  return false;
}

export async function purgeCodexTranscript(
  io: Pick<TmuxIo, "run" | "readFile">,
  neutralDir: string,
  capturedUuid: string | null | undefined,
  homeBase?: string
): Promise<boolean> {
  if (!capturedUuid || !CODEX_UUID_PATTERN.test(capturedUuid)) return false;
  const uuid = capturedUuid.toLowerCase();
  const path = codexTranscriptPath(uuid, homeBase);
  const exists = await io.run("test", ["-e", path]);
  if (exists.code !== 0) return true;
  const jsonl = await io.readFile(path);
  if (!codexTranscriptMatchesIdentity(jsonl, uuid, neutralDir)) return false;
  const removed = await io.run("rm", ["-f", path]);
  return removed.code === 0;
}

export async function purgePrivateTranscripts(
  io: Pick<TmuxIo, "run" | "readFile">,
  neutralBase: string,
  sessionKey: string,
  homeBase?: string
): Promise<void> {
  const neutralDir = deriveNeutralDir(neutralBase, sessionKey);
  await removeChecked(io, ["-rf", transcriptGlobDir("anthropic", neutralDir, homeBase)]);
  await removeChecked(io, ["-f", join(neutralDir, "codex-exec-transcript.jsonl")]);

  const codexUuid = await readCodexSessionIdentity(io, neutralDir);
  if (codexUuid !== null) {
    if (!(await purgeCodexTranscript(io, neutralDir, codexUuid, homeBase)))
      throw new Error("Codex transcript identity mismatch");
    await removeChecked(io, ["-f", join(neutralDir, CODEX_IDENTITY_FILENAME)]);
  }

  const agyUuid = await readAgyConversationIdentity(io, neutralDir);
  if (agyUuid !== null) {
    if (!(await purgeAgyBrainDir(io, agyUuid, homeBase))) {
      throw new Error("Could not purge AGY conversation transcript");
    }
    await removeChecked(io, ["-f", join(neutralDir, AGY_IDENTITY_FILENAME)]);
  }
}

export async function purgePrivateTranscriptMarkers(
  io: Pick<TmuxIo, "run" | "readFile">,
  neutralBase: string,
  homeBase?: string
): Promise<boolean> {
  const listed = await io.run("ls", ["-A", neutralBase]).catch(() => ({
    code: 1,
    stdout: ""
  }));
  if (listed.code !== 0) return true;
  let purged = true;
  for (const sessionKey of listed.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      sanitizeSessionKey(sessionKey);
    } catch {
      continue;
    }
    try {
      await purgePrivateTranscripts(io, neutralBase, sessionKey, homeBase);
    } catch {
      purged = false;
    }
  }
  return purged;
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

async function persistIdentity(
  io: Pick<TmuxIo, "writeFile" | "run">,
  neutralDir: string,
  filename: string,
  uuid: string,
  label: string
): Promise<void> {
  const marker = join(neutralDir, filename);
  const temp = `${marker}.tmp`;
  await io.writeFile(temp, `${uuid}\n`);
  const chmod = await io.run("chmod", ["600", temp]);
  if (chmod.code !== 0) {
    await io.run("rm", ["-f", temp]);
    throw new Error(`Could not lock down ${label} identity marker`);
  }
  const moved = await io.run("mv", ["-f", temp, marker]);
  if (moved.code !== 0) {
    await io.run("rm", ["-f", temp]);
    throw new Error(`Could not persist ${label} identity marker`);
  }
}

async function removeChecked(io: Pick<TmuxIo, "run">, args: readonly string[]): Promise<void> {
  const result = await io.run("rm", args);
  if (result.code !== 0) throw new Error("Could not purge private transcript");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
