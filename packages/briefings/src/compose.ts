import { randomUUID } from "node:crypto";

import type { AiRepository, AiSecretCipher } from "@jarv1s/ai";
import { HttpApiAdapter } from "@jarv1s/ai";
import type { ChatTurn, GenerateChatInput, ProviderKind } from "@jarv1s/ai";
import type { BriefingDefinition, BriefingRunStatus, DataContextDb } from "@jarv1s/db";
import type { MemoryRetriever } from "@jarv1s/memory";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { isBehaviorEnabled, type SourceBehaviorPolicyDeps } from "@jarv1s/source-behaviors";
import { normalizePersonaSettings, renderPersonaText } from "@jarv1s/shared";

import { timezoneFor } from "./schedule.js";

// ── Caps (one conservative economy budget) ─────────────────────────────────────
const SECTION_ITEM_CAP = 8;
const SECTION_CHAR_CAP = 1200;
const VAULT_CHUNK_CAP = 6;
const VAULT_EXCERPT_CHARS = 400;
// Output budget for the economy tier. Bounds the synthesized narrative so a runaway
// generation can't blow the economy cost envelope. Wired into the adapter via
// GenerateChatInput.maxOutputTokens (A5b) — the adapter clamps its provider
// max_tokens to this when present.
const ECONOMY_MAX_OUTPUT_TOKENS = 1024;

export type GenerateChatFn = (input: GenerateChatInput) => Promise<{ readonly text: string }>;

export interface ComposeDeps {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly memoryRetriever: MemoryRetriever;
  readonly personaRepository?: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  };
  readonly sourceBehaviorPolicy?: SourceBehaviorPolicyDeps;
  readonly resolveUserName?: (scopedDb: DataContextDb, actorUserId: string) => Promise<string>;
  /** Injectable for tests; defaults to constructing a real HttpApiAdapter. */
  readonly createAdapter?: (
    kind: ProviderKind,
    apiKey: string,
    baseUrl: string | null
  ) => { generateChat: GenerateChatFn };
}

export interface ComposeRunInput {
  readonly runKind: "manual" | "scheduled";
  readonly runId?: string;
  readonly jobId?: string;
  /** Single captured "now" from the caller so lock-day, idempotency, and the local-day
   *  content window all agree across a midnight boundary. Defaults to a fresh Date(). */
  readonly now?: Date;
}

export interface BriefingGap {
  readonly source: string;
  // No `empty_cache`: we cannot distinguish synced-empty from not-synced-yet until the
  // connector-sync slice lands cache state, so an empty source is just `empty`.
  readonly reason: "tool_failed" | "truncated" | "empty";
}

export interface ComposeResult {
  readonly status: BriefingRunStatus;
  readonly summaryText: string;
  readonly sourceMetadata: Record<string, unknown>;
}

interface Section {
  readonly key: string;
  readonly label: string;
  readonly lines: readonly string[];
  readonly count: number;
}

function ctxFor(definition: BriefingDefinition, input: ComposeRunInput) {
  return {
    actorUserId: definition.owner_user_id,
    requestId: input.jobId ? `pgboss:${input.jobId}` : `briefing:${input.runId ?? randomUUID()}`,
    chatSessionId: ""
  };
}

/**
 * Authoritative per-user local-day check for a field we are EXPLICITLY day-bounding.
 * `timeZone` is the definition's IANA tz (from `timezoneFor(...)`). An item whose
 * timestamp falls on a different local calendar day than `now` is excluded. FAILS
 * CLOSED: a missing/unparseable timestamp on a day-bound field cannot be confirmed to
 * be "today", so it is EXCLUDED (a stale row with no usable date must not leak into a
 * today-bounded section).
 */
function withinLocalDay(isoOrDate: unknown, now: Date, timeZone: string): boolean {
  if (typeof isoOrDate !== "string" || isoOrDate.trim() === "") {
    return false;
  }
  const ts = new Date(isoOrDate);
  if (Number.isNaN(ts.getTime())) {
    return false;
  }
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  return fmt(ts) === fmt(now);
}

function findExecute(manifests: readonly JarvisModuleManifest[], toolName: string) {
  return manifests.flatMap((m) => m.assistantTools ?? []).find((t) => t.name === toolName);
}

function capLines(lines: string[]): { lines: string[]; truncated: boolean } {
  const itemCapped = lines.slice(0, SECTION_ITEM_CAP);
  let total = 0;
  const out: string[] = [];
  let truncated = lines.length > SECTION_ITEM_CAP;
  for (const line of itemCapped) {
    if (total + line.length > SECTION_CHAR_CAP) {
      truncated = true;
      break;
    }
    out.push(line);
    total += line.length;
  }
  return { lines: out, truncated };
}

function emptySection(key: string, label: string): Section {
  return { key, label, lines: [], count: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstObjectArray(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function formatGenericItem(item: Record<string, unknown>): string {
  return Object.entries(item)
    .filter(([key]) => !/(^id$|Id$|_id$|metadata|secret|credential|ciphertext)/i.test(key))
    .map(([, value]) => str(value))
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
}

async function sourceIncludedInBriefings(
  scopedDb: DataContextDb,
  deps: ComposeDeps,
  behaviorId: string
): Promise<boolean> {
  if (!deps.sourceBehaviorPolicy) {
    return true;
  }
  return isBehaviorEnabled(scopedDb, deps.sourceBehaviorPolicy, behaviorId);
}

/** Gather one tool-backed section; never throws — failures become gaps. */
async function gatherToolSection(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: ComposeRunInput,
  deps: ComposeDeps,
  args: {
    readonly key: string;
    readonly label: string;
    readonly toolName: string;
    /** When set, items are filtered to the definition's local day on this field. */
    readonly localDayField?: string;
  },
  gaps: BriefingGap[],
  now: Date,
  timeZone: string
): Promise<Section> {
  const tool = findExecute(deps.moduleManifests, args.toolName);
  if (!tool?.execute) {
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0 };
  }
  try {
    const result = await tool.execute(scopedDb, {}, ctxFor(definition, input));
    const data = isRecord(result.data) ? result.data : {};
    let items = firstObjectArray(data);
    // Authoritative per-user local-day bound (tools return all visible rows; sync
    // slice not built yet so there is no source-side date filter — compose enforces it).
    if (args.localDayField) {
      items = items.filter((it) => withinLocalDay(it[args.localDayField!], now, timeZone));
    }
    if (items.length === 0) {
      // Neutral `empty` only: we cannot distinguish "synced and empty" from
      // "not synced yet" until the connector-sync slice lands cache state. Do NOT
      // claim `empty_cache` — that would over-state knowledge we don't have.
      gaps.push({ source: args.key, reason: "empty" });
      return { key: args.key, label: args.label, lines: [], count: 0 };
    }
    const allLines = items.map(formatGenericItem).filter((line) => line.length > 0);
    const { lines, truncated } = capLines(allLines);
    if (truncated) {
      gaps.push({ source: args.key, reason: "truncated" });
    }
    return { key: args.key, label: args.label, lines, count: items.length };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "briefing_tool_failed",
        tool: args.toolName,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0 };
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function composeBriefing(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: ComposeRunInput,
  deps: ComposeDeps
): Promise<ComposeResult> {
  const gaps: BriefingGap[] = [];
  // Use the caller's captured `now` (so the idempotency lock-day and the content window
  // agree); fall back to a fresh Date() for a direct/manual call that omits it.
  const now = input.now ?? new Date();
  // Per-user IANA tz — the SAME helper the scheduler uses, so cron fire time and the
  // local-day content window agree. No cross-user read: tz comes off this definition.
  const timeZone = timezoneFor(definition.schedule_metadata);

  const commitments = await gatherToolSection(
    scopedDb,
    definition,
    input,
    deps,
    {
      key: "commitments",
      label: "COMMITMENTS",
      toolName: "commitments.listVisible"
    },
    gaps,
    now,
    timeZone
  );

  const tasks = await gatherToolSection(
    scopedDb,
    definition,
    input,
    deps,
    {
      key: "tasks",
      label: "TASKS",
      // There is no `tasks.listVisible` tool (verified against tasks/manifest.ts).
      toolName: "tasks.list"
    },
    gaps,
    now,
    timeZone
  );

  const includeCalendar = await sourceIncludedInBriefings(scopedDb, deps, "calendar.briefings");
  const calendar = includeCalendar
    ? await gatherToolSection(
        scopedDb,
        definition,
        input,
        deps,
        {
          key: "calendar",
          label: "CALENDAR",
          toolName: "calendar.listVisibleEvents",
          // "Today's calendar": bound to the definition's local day on the event start.
          localDayField: "startsAt"
        },
        gaps,
        now,
        timeZone
      )
    : emptySection("calendar", "CALENDAR");

  const includeEmail = await sourceIncludedInBriefings(scopedDb, deps, "email.briefings");
  const email = includeEmail
    ? await gatherToolSection(
        scopedDb,
        definition,
        input,
        deps,
        {
          key: "email",
          label: "EMAIL SUMMARIES + SIGNALS",
          // Email "signals" = recent unread/important; keep the source's own recency
          // (no day-bound — a 2-day-old unresolved thread is still a morning signal).
          toolName: "email.listVisibleMessages"
        },
        gaps,
        now,
        timeZone
      )
    : emptySection("email", "EMAIL SUMMARIES + SIGNALS");

  // Vault: semantic ∪ recency, deduped by id/source path. Best-effort.
  const vaultLines: string[] = [];
  const vaultNotes: Array<{ path: string; id: string; excerpt: string }> = [];
  try {
    const query = [...commitments.lines, ...tasks.lines, ...calendar.lines].join(" ").slice(0, 500);
    const semantic = query.trim()
      ? await deps.memoryRetriever.retrieve(scopedDb, query, VAULT_CHUNK_CAP, "vault")
      : [];
    const recent = await deps.memoryRetriever.retrieveRecent(scopedDb, VAULT_CHUNK_CAP, "vault");
    const seen = new Set<string>();
    for (const chunk of [...semantic, ...recent]) {
      const dedupeKey = chunk.id || `${chunk.sourcePath}:${chunk.lineStart}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const excerpt = chunk.text.slice(0, VAULT_EXCERPT_CHARS).replace(/\s+/g, " ").trim();
      vaultLines.push(`${chunk.sourcePath} · ${excerpt}`);
      vaultNotes.push({ path: chunk.sourcePath, id: chunk.id, excerpt });
      if (vaultLines.length >= VAULT_CHUNK_CAP) break;
    }
    if (vaultLines.length === 0) {
      gaps.push({ source: "vault", reason: "empty" });
    }
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "briefing_tool_failed",
        tool: "vault",
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
    gaps.push({ source: "vault", reason: "tool_failed" });
  }
  const vault: Section = {
    key: "vault",
    label: "VAULT",
    lines: vaultLines,
    count: vaultLines.length
  };

  const chats = await gatherToolSection(
    scopedDb,
    definition,
    input,
    deps,
    {
      key: "chats",
      label: "THE DAY'S CHATS",
      toolName: "chat.listTodaysTurns",
      // Authoritative local-day bound on the turn timestamp (the tool over-includes 36h).
      localDayField: "createdAt"
    },
    gaps,
    now,
    timeZone
  );

  const sections: Section[] = [commitments, tasks, calendar, email, vault, chats];

  // ── Resolve the model (provider-agnostic) ────────────────────────────────────
  const model = await deps.aiRepository.selectModelForCapability(
    scopedDb,
    "summarization",
    "economy"
  );
  if (!model) {
    return fallback(
      sections,
      gaps,
      "no_model",
      commitments,
      tasks,
      calendar,
      email,
      vault,
      chats,
      vaultNotes
    );
  }

  // ── Decrypt credential in worker scope only ──────────────────────────────────
  let apiKey: string;
  let baseUrl: string | null;
  try {
    const provider = await deps.aiRepository.selectProviderWithCredential(
      scopedDb,
      model.provider_config_id
    );
    if (!provider?.encrypted_credential) {
      return fallback(
        sections,
        gaps,
        "credential_error",
        commitments,
        tasks,
        calendar,
        email,
        vault,
        chats,
        vaultNotes
      );
    }
    const decrypted = deps.cipher.decryptJson(provider.encrypted_credential);
    const key = decrypted.apiKey;
    if (typeof key !== "string" || key.length === 0) {
      return fallback(
        sections,
        gaps,
        "credential_error",
        commitments,
        tasks,
        calendar,
        email,
        vault,
        chats,
        vaultNotes
      );
    }
    apiKey = key;
    baseUrl = provider.base_url;
  } catch {
    // Never log the raw error — it can carry the decrypted key.
    return fallback(
      sections,
      gaps,
      "credential_error",
      commitments,
      tasks,
      calendar,
      email,
      vault,
      chats,
      vaultNotes
    );
  }

  // ── Synthesize ───────────────────────────────────────────────────────────────
  const messages = await buildMessages(scopedDb, definition, sections, deps);
  try {
    const adapter = (deps.createAdapter ?? defaultCreateAdapter)(
      model.provider_kind as ProviderKind,
      apiKey,
      baseUrl
    );
    const { text } = await adapter.generateChat({
      model: { provider_kind: model.provider_kind, provider_model_id: model.provider_model_id },
      messages,
      maxOutputTokens: ECONOMY_MAX_OUTPUT_TOKENS
    });
    return {
      status: "succeeded",
      summaryText: text,
      sourceMetadata: {
        commitmentCount: commitments.count,
        taskCount: tasks.count,
        calendarCount: calendar.count,
        emailCount: email.count,
        vaultCount: vault.count,
        chatTurnCount: chats.count,
        notes: vaultNotes,
        aiModel: { id: model.id, displayName: model.display_name, tier: model.tier },
        gaps,
        degraded: false
      }
    };
  } catch {
    return fallback(
      sections,
      gaps,
      "synthesis_failed",
      commitments,
      tasks,
      calendar,
      email,
      vault,
      chats,
      vaultNotes
    );
  }
}

function defaultCreateAdapter(kind: ProviderKind, apiKey: string, baseUrl: string | null) {
  return new HttpApiAdapter(kind, apiKey, baseUrl ? { baseUrl } : {});
}

async function buildMessages(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  sections: readonly Section[],
  deps: ComposeDeps
): Promise<ChatTurn[]> {
  const system =
    "You are a calm morning-briefing writer. Synthesize a concise, scannable morning briefing " +
    "with light section headers. Ground strictly in the provided items; do not invent. Where a " +
    "section is empty, note it briefly. Keep it warm and non-judgmental about missed or at-risk items.";
  const personaBlock = await buildPersonaBlock(scopedDb, definition, deps);
  const body = sections
    .map(
      (s) =>
        `## ${s.label}\n${s.lines.length > 0 ? s.lines.map((l) => `- ${l}`).join("\n") : "(none today)"}`
    )
    .join("\n\n");
  return [{ role: "user", content: [system, personaBlock, body].filter(Boolean).join("\n\n") }];
}

async function buildPersonaBlock(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  deps: ComposeDeps
): Promise<string> {
  if (!deps.personaRepository || !deps.resolveUserName) {
    return "";
  }
  const [stored, userName] = await Promise.all([
    deps.personaRepository.get(scopedDb, "persona.bundle"),
    deps.resolveUserName(scopedDb, definition.owner_user_id)
  ]);
  const persona = normalizePersonaSettings(stored);
  return renderPersonaText({
    assistantName: persona.assistantName,
    personaText: persona.personaText,
    userName
  });
}

function fallback(
  sections: readonly Section[],
  gaps: BriefingGap[],
  reason: "no_model" | "credential_error" | "synthesis_failed",
  commitments: Section,
  tasks: Section,
  calendar: Section,
  email: Section,
  vault: Section,
  chats: Section,
  vaultNotes: Array<{ path: string; id: string; excerpt: string }>
): ComposeResult {
  const text = sections
    .map(
      (s) =>
        `${s.label}: ${s.count} item${s.count === 1 ? "" : "s"}${s.lines.length > 0 ? `\n${s.lines.map((l) => `- ${l}`).join("\n")}` : ""}`
    )
    .join("\n\n");
  return {
    status: "succeeded",
    summaryText: text || "Briefing did not produce visible source items.",
    sourceMetadata: {
      commitmentCount: commitments.count,
      taskCount: tasks.count,
      calendarCount: calendar.count,
      emailCount: email.count,
      vaultCount: vault.count,
      chatTurnCount: chats.count,
      notes: vaultNotes,
      aiModel: null,
      gaps,
      degraded: true,
      degradedReason: reason
    }
  };
}
