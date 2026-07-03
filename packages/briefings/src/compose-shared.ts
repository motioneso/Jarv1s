import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AiRepository, AiSecretCipher } from "@jarv1s/ai";
import { HttpApiAdapter, parseAiApiKeyCredential } from "@jarv1s/ai";
import type { ChatTurn, GenerateChatInput, ProviderKind } from "@jarv1s/ai";
import type { FocusSignalInput, PriorityResult, PrioritySource } from "@jarv1s/priority";
import type { BriefingDefinition, BriefingRunStatus, BriefingType, DataContextDb } from "@jarv1s/db";
import type { CalendarSignalSettings, EmailSignalSettings } from "./signals.js";
import type { MemoryRetriever } from "@jarv1s/memory";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { isBehaviorEnabled, type SourceBehaviorPolicyDeps } from "@jarv1s/source-behaviors";
import { normalizePersonaSettings, renderPersonaText } from "@jarv1s/shared";
import { sanitizeExternal } from "./trust-boundary.js";

export type GenerateChatFn = (input: GenerateChatInput) => Promise<{ readonly text: string }>;

export const SECTION_ITEM_CAP = 8;
export const SECTION_CHAR_CAP = 1200;
export const ECONOMY_MAX_OUTPUT_TOKENS = 1024;
export interface ComposeDeps {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly memoryRetriever: MemoryRetriever;
  readonly personaRepository?: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  };
  readonly priorityPreferencesRepository?: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  };
  readonly focusReadiness?: (ctx: {
    readonly actorUserId: string;
    readonly requestId: string;
  }) => Promise<readonly FocusSignalInput[]>;
  readonly sourceBehaviorPolicy?: SourceBehaviorPolicyDeps;
  readonly resolveUserName?: (scopedDb: DataContextDb, actorUserId: string) => Promise<string>;
  /**
   * Structured logger for tool-failure observability (briefing_tool_failed events).
   * Optional for back-compat; production injects a module logger (observability spec).
   */
  readonly logger?: Pick<FastifyBaseLogger, "error">;
  readonly connectorSyncAt?: (
    scopedDb: DataContextDb,
    kind: "email" | "calendar"
  ) => Promise<Date | null>;
  readonly vaultLastWriteAt?: (scopedDb: DataContextDb) => Promise<Date | null>;
  /** Injected by the composition root; gates email/calendar cached reads to accounts with active grants. */
  readonly featureGrantService?: {
    grantedAccountIds(
      scopedDb: DataContextDb,
      feature: "email" | "calendar"
    ): Promise<ReadonlySet<string>>;
  };
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

export interface Section {
  readonly key: string;
  readonly label: string;
  readonly lines: readonly string[];
  readonly count: number;
  readonly rawItems?: readonly Record<string, unknown>[];
}


export function ctxFor(definition: BriefingDefinition, input: ComposeRunInput) {
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
export function withinLocalDay(isoOrDate: unknown, now: Date, timeZone: string): boolean {
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


export function findExecute(manifests: readonly JarvisModuleManifest[], toolName: string) {
  return manifests.flatMap((m) => m.assistantTools ?? []).find((t) => t.name === toolName);
}


export function capLines(lines: string[]): { lines: string[]; truncated: boolean } {
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


export function emptySection(key: string, label: string): Section {
  return { key, label, lines: [], count: 0 };
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export async function sourceIncludedInBriefings(
  scopedDb: DataContextDb,
  deps: ComposeDeps,
  behaviorId: string
): Promise<boolean> {
  if (!deps.sourceBehaviorPolicy) {
    return true;
  }
  return isBehaviorEnabled(scopedDb, deps.sourceBehaviorPolicy, behaviorId);
}


export async function readPreference(
  scopedDb: DataContextDb,
  deps: ComposeDeps,
  key: string
): Promise<unknown> {
  return deps.sourceBehaviorPolicy?.preferencesRepository.get(scopedDb, key) ?? null;
}


export function boolPreference(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}


export function intPreference(value: unknown, fallback: 0 | 1 | 2): 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}


export async function readCalendarSignalSettings(
  scopedDb: DataContextDb,
  deps: ComposeDeps
): Promise<CalendarSignalSettings> {
  const [lookaheadDays, suggestTasks, createTasks, suggestTimeBlocks, blockTime] =
    await Promise.all([
      readPreference(scopedDb, deps, "calendar.briefing_lookahead_days"),
      readPreference(scopedDb, deps, "calendar.signal_suggest_tasks"),
      readPreference(scopedDb, deps, "calendar.signal_create_tasks"),
      readPreference(scopedDb, deps, "calendar.signal_suggest_time_blocks"),
      readPreference(scopedDb, deps, "calendar.signal_block_time")
    ]);
  return {
    lookaheadDays: intPreference(lookaheadDays, 2),
    suggestTasks: boolPreference(suggestTasks, true),
    createTasks: boolPreference(createTasks, false),
    suggestTimeBlocks: boolPreference(suggestTimeBlocks, true),
    blockTime: boolPreference(blockTime, false)
  };
}


export async function readEmailSignalSettings(
  scopedDb: DataContextDb,
  deps: ComposeDeps
): Promise<EmailSignalSettings> {
  const [createTasks, suggestReplies, draftReplies, autoSend] = await Promise.all([
    readPreference(scopedDb, deps, "email.signal_create_tasks"),
    readPreference(scopedDb, deps, "email.signal_suggest_replies"),
    readPreference(scopedDb, deps, "email.signal_draft_replies"),
    readPreference(scopedDb, deps, "email.signal_auto_send")
  ]);
  return {
    createTasks: boolPreference(createTasks, true),
    suggestReplies: boolPreference(suggestReplies, true),
    draftReplies: boolPreference(draftReplies, true),
    autoSend: boolPreference(autoSend, false)
  };
}


/** Gather one tool-backed section; never throws — failures become gaps. */
export async function gatherToolSection(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: ComposeRunInput,
  deps: ComposeDeps,
  args: {
    readonly key: string;
    readonly label: string;
    readonly toolName: string;
    /** Explicit key in the tool's `data` that holds the row array (verified per manifest). */
    readonly arrayKey: string;
    readonly toolInput?: Record<string, unknown>;
    /**
     * Explicit per-source field allow-list. Only the fields named here cross the trust
     * boundary into the AI prompt — the projection is never inferred from the DTO shape,
     * so adding a field to a tool's DTO can never silently leak private content (e.g.
     * email bodyExcerpt, chat thread titles, or LLM-derived summary/signals).
     */
    readonly format: (item: Record<string, unknown>) => string;
    /** When set, items are filtered to the definition's local day on this field. */
    readonly localDayField?: string;
  },
  gaps: BriefingGap[],
  now: Date,
  timeZone: string
): Promise<Section> {
  if (!definition.selected_tool_names.includes(args.toolName)) {
    return { key: args.key, label: args.label, lines: [], count: 0, rawItems: [] };
  }

  const tool = findExecute(deps.moduleManifests, args.toolName);
  if (!tool?.execute) {
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0 };
  }
  try {
    const toolServices = deps.featureGrantService
      ? { featureGrants: deps.featureGrantService }
      : {};
    const result = await tool.execute(scopedDb, args.toolInput ?? {}, ctxFor(definition, input), toolServices);
    const data = isRecord(result.data) ? result.data : {};
    const raw = data[args.arrayKey];
    let items = Array.isArray(raw) ? raw.filter(isRecord) : [];
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
      return { key: args.key, label: args.label, lines: [], count: 0, rawItems: [] };
    }
    const allLines = items.map(args.format).filter((line) => line.length > 0);
    const { lines, truncated } = capLines(allLines);
    if (truncated) {
      gaps.push({ source: args.key, reason: "truncated" });
    }
    return { key: args.key, label: args.label, lines, count: items.length, rawItems: items };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    deps.logger?.error(
      {
        event: "briefing_tool_failed",
        tool: args.toolName,
        error: e.name,
        message: e.message.slice(0, 200)
      },
      "briefing tool failed"
    );
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0, rawItems: [] };
  }
}


export function defaultCreateAdapter(kind: ProviderKind, apiKey: string, baseUrl: string | null) {
  return new HttpApiAdapter(kind, apiKey, baseUrl ? { baseUrl } : {});
}


export async function buildPersonaBlock(
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

export type SynthesisFailureReason = "no_model" | "credential_error" | "synthesis_failed";

/**
 * Provider-agnostic synthesis: select the user's economy summarization model, decrypt the
 * provider credential IN WORKER SCOPE ONLY, and run one generateChat call. Never log raw
 * errors from the credential block — they can carry the decrypted key.
 */
export async function synthesizeWithConfiguredModel(
  scopedDb: DataContextDb,
  deps: ComposeDeps,
  messages: ChatTurn[]
): Promise<
  | { ok: true; text: string; model: { id: string; display_name: string; tier: string } }
  | { ok: false; reason: SynthesisFailureReason }
> {
  const model = await deps.aiRepository.selectModelForCapability(
    scopedDb,
    "summarization",
    "economy"
  );
  if (!model) {
    return { ok: false, reason: "no_model" };
  }
  let apiKey: string;
  let baseUrl: string | null;
  try {
    const provider = await deps.aiRepository.selectProviderWithCredential(
      scopedDb,
      model.provider_config_id
    );
    if (!provider?.encrypted_credential) {
      return { ok: false, reason: "credential_error" };
    }
    const credential = parseAiApiKeyCredential(
      deps.cipher.decryptJson(provider.encrypted_credential)
    );
    if (!credential) {
      return { ok: false, reason: "credential_error" };
    }
    apiKey = credential.apiKey;
    baseUrl = provider.base_url;
  } catch {
    // Never log the raw error — it can carry the decrypted key.
    return { ok: false, reason: "credential_error" };
  }
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
      ok: true,
      text,
      model: { id: model.id, display_name: model.display_name, tier: model.tier }
    };
  } catch {
    return { ok: false, reason: "synthesis_failed" };
  }
}
