import type { GmailMessageFull, GmailPayloadPart } from "./google-api-client.js";
import type { StructuredTelemetry } from "@jarv1s/ai";

/** Max decoded body length sent to the LLM (bounded to protect prompt limits, spec risk #6). */
export const MAX_BODY_CHARS = 20_000;

/**
 * Hard cap on the persisted summary length. The summary is the ONLY model-derived prose we
 * store; bounding it defensively means even a misbehaving/jailbroken model cannot echo the
 * full email body back into a persisted column (privacy posture, spec §6). A real summary is
 * one or two sentences, so 600 chars is generous.
 */
export const MAX_SUMMARY_CHARS = 600;

/**
 * Absolute minimum length (chars) at which a summary that is a *verbatim contiguous substring* of
 * the email body is treated as a body echo rather than a legitimate paraphrase. Combined with the
 * BODY_RECONSTRUCTION_FRACTION check, this nulls a summary that reproduces a long body slice (e.g.
 * the first 600 chars of a 700-char body) while leaving genuine short summaries — which paraphrase
 * and are rarely long verbatim slices of the body — untouched (privacy posture, spec §6).
 */
export const SUMMARY_BODY_SUBSTRING_FLOOR = 200;

/**
 * Hard cap on any single string field inside `signals` (descriptions, action-item text, etc.).
 * `signals` is persisted (jsonb column) alongside the summary, so a prompt-injected/jailbroken
 * model that stuffs the full body into `actionItems[].text` would otherwise leak it into a
 * column — the summary echo-guard alone does NOT cover signals. Bounding every signal string
 * (and dropping unknown keys, see sanitizeSignals) closes that hole (privacy posture, spec §6).
 */
export const MAX_SIGNAL_STR_CHARS = 280;
/** Max array length per signal list — bounds total persisted JSON regardless of model output. */
export const MAX_SIGNAL_ITEMS = 50;

export interface ParsedEmail {
  readonly externalId: string;
  readonly threadId?: string | null;
  readonly historyId: string | null;
  readonly subject: string;
  readonly from: string;
  readonly recipients: string[];
  readonly receivedAt: string;
  readonly labelIds: string[];
  readonly snippet: string | null;
  readonly body: string;
  readonly bodyTruncated: boolean;
}

function header(part: GmailPayloadPart | undefined, name: string): string | undefined {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeB64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Bounded accumulation: stop decoding once BOTH buffers reach the cap, and bound each base64
// slice we decode so a single huge part cannot allocate far beyond MAX_BODY_CHARS before the
// final truncation (Codex MIME-alloc finding). The base64 decoded length is ~3/4 of the
// encoded length, so slicing the encoded data to ~4/3 * remaining caps the decoded output.
function collectBody(part: GmailPayloadPart | undefined): { text: string; html: string } {
  const acc = { text: "", html: "" };
  if (!part) return acc;
  const encodedCap = Math.ceil((MAX_BODY_CHARS * 4) / 3) + 4;
  const walk = (p: GmailPayloadPart): void => {
    if (acc.text.length >= MAX_BODY_CHARS && acc.html.length >= MAX_BODY_CHARS) return;
    const mime = p.mimeType ?? "";
    if (mime === "text/plain" && p.body?.data && acc.text.length < MAX_BODY_CHARS) {
      acc.text += decodeB64Url(p.body.data.slice(0, encodedCap)).slice(0, MAX_BODY_CHARS);
    } else if (mime === "text/html" && p.body?.data && acc.html.length < MAX_BODY_CHARS) {
      acc.html += decodeB64Url(p.body.data.slice(0, encodedCap)).slice(0, MAX_BODY_CHARS);
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return acc;
}

function splitAddresses(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseEmail(message: GmailMessageFull): ParsedEmail {
  const payload = message.payload;
  const { text, html } = collectBody(payload);
  const rawBody = text.trim().length > 0 ? text : stripHtml(html);
  const truncated = rawBody.length > MAX_BODY_CHARS;
  const body = truncated ? rawBody.slice(0, MAX_BODY_CHARS) : rawBody;

  const to = splitAddresses(header(payload, "To"));
  const cc = splitAddresses(header(payload, "Cc"));
  const dateHeader = header(payload, "Date");
  const receivedAt =
    message.internalDate !== undefined
      ? new Date(Number(message.internalDate)).toISOString()
      : dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();

  return {
    externalId: message.id,
    threadId: message.threadId ?? null,
    historyId: message.historyId ?? null,
    subject: header(payload, "Subject") ?? "(no subject)",
    from: header(payload, "From") ?? "(unknown)",
    recipients: [...to, ...cc],
    receivedAt,
    labelIds: [...(message.labelIds ?? [])],
    snippet: message.snippet ?? null,
    body,
    bodyTruncated: truncated
  };
}

export interface EmailBill {
  readonly description: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly dueDate?: string;
}
export interface EmailActionItem {
  readonly text: string;
  readonly dueDate?: string;
}
export interface EmailDeadline {
  readonly text: string;
  readonly date?: string;
}

/** Spec #729 §3 triage taxonomy. */
export type EmailActionabilityCategory =
  | "needs_reply"
  | "needs_action"
  | "time_sensitive_info"
  | "waiting_on_someone"
  | "fyi"
  | "noise"
  | "unknown";

const ACTIONABILITY_CATEGORIES: readonly EmailActionabilityCategory[] = [
  "needs_reply",
  "needs_action",
  "time_sensitive_info",
  "waiting_on_someone",
  "fyi",
  "noise",
  "unknown"
];

export interface EmailActionabilitySignal {
  readonly category: EmailActionabilityCategory;
  readonly reason?: string;
  readonly dueDate?: string;
  /** Short model-written subject for suppression matching; body-echo guarded before storage. */
  readonly inferredSubject?: string;
  readonly suggestedTasks?: EmailActionItem[];
}

export interface EmailSignals {
  readonly billsDue?: EmailBill[];
  readonly actionItems?: EmailActionItem[];
  readonly deadlines?: EmailDeadline[];
  readonly actionability?: EmailActionabilitySignal;
  readonly mayGetLostInShuffle?: boolean;
  readonly importance?: "low" | "normal" | "high";
  readonly confidence?: number;
  readonly truncated?: boolean;
}

export interface EmailExtractResult {
  readonly summary: string | null;
  readonly signals: EmailSignals;
  /** True when the pass escalated to a higher tier (telemetry; counted by the handler). */
  readonly escalated?: boolean;
}

export class EmailExtractNeedsConfigurationError extends Error {
  constructor() {
    super("email extraction needs configuration");
    this.name = "EmailExtractNeedsConfigurationError";
  }
}

/** Injectable seam: the worker passes router-backed impls; tests pass fakes. */
export interface EmailExtractDeps {
  /** Run structured extraction through the configured service binding; returns JSON text. */
  readonly runChat: (
    prompt: string,
    signal?: AbortSignal,
    batchSize?: number,
    telemetry?: StructuredTelemetry
  ) => Promise<{ readonly text: string }>;
}

export interface EmailExtractOptions {
  /** Per-LLM-call timeout in ms (bounds sync latency; default from env, then 20s). */
  readonly callTimeoutMs?: number;
  /** Metadata-only telemetry factory; the worker supplies job and batch attribution. */
  readonly telemetry?: (batchIndex: number, batchSize: number) => StructuredTelemetry;
}

export const EMAIL_EXTRACT_BATCH_MAX_ITEMS = 48;
export const EMAIL_EXTRACT_BATCH_MAX_PROMPT_BYTES = 48_000;

/** Reject a chat call that exceeds the budget so one slow model can't stall the whole sync. */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const request = run(controller.signal);
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = Symbol("timed-out");
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, ms);
  });
  try {
    const first = await Promise.race([request, timeout]);
    if (first !== timedOut) return first;
    try {
      return await request;
    } catch {
      throw new Error("llm-timeout");
    }
  } finally {
    clearTimeout(timer!);
  }
}

const EMAIL_TRIAGE_INSTRUCTIONS = [
  "You are an email triage assistant. Read the email and reply with a single JSON object only,",
  "no prose, matching this TypeScript type:",
  "{ summary: string, billsDue: {description:string, amount?:number, currency?:string, dueDate?:string}[],",
  " actionItems: {text:string, dueDate?:string}[], deadlines: {text:string, date?:string}[],",
  ' actionability: { category: "needs_reply"|"needs_action"|"time_sensitive_info"|"waiting_on_someone"|"fyi"|"noise"|"unknown",',
  "   reason?: string, dueDate?: string, inferredSubject?: string, suggestedTasks?: {text:string, dueDate?:string}[] },",
  ' mayGetLostInShuffle: boolean, importance: "low"|"normal"|"high", confidence: number }',
  "Use ISO dates. confidence is 0..1.",
  "Actionability rules:",
  "- needs_reply: a real person is waiting on the user's answer. NEVER use it for marketing,",
  "  newsletters, receipts, or automated notifications, whatever the subject line claims.",
  "- needs_action: the user must do something (pay a bill, submit, book, review) — include the",
  "  due date and a short suggestedTasks entry when the action is concrete.",
  "- time_sensitive_info: no action required but it expires (flight change, outage window).",
  "- waiting_on_someone: the user is owed a response or delivery by someone else.",
  "- fyi: informational, no urgency (receipts, confirmations, status updates).",
  "- noise: marketing, promotions, newsletters, social notifications. No suggestedTasks.",
  "- unknown: only when genuinely unclassifiable.",
  "reason must be one short sentence."
].join("\n");

function promptInput(parsed: ParsedEmail): string {
  return [`Subject: ${parsed.subject}`, `From: ${parsed.from}`, "", parsed.body].join("\n");
}

function buildPrompt(parsed: ParsedEmail): string {
  return [EMAIL_TRIAGE_INSTRUCTIONS, promptInput(parsed)].join("\n\n");
}

/**
 * Coerce one model-returned string field into a bounded, body-safe value. Returns undefined when
 * the value is absent/non-string OR when (after normalization) it CONTAINS the email body — that
 * is the prompt-injection vector where the model packs the raw body into a signal text field. We
 * never persist such a field; dropping it is the fail-safe (privacy posture, spec §6).
 */
function safeSignalStr(value: unknown, normalizedBody: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, MAX_SIGNAL_STR_CHARS).trim();
  if (trimmed.length === 0) return undefined;
  // Body-echo guard: drop any signal text that re-embeds the email body (the prompt-injection
  // vector where the model packs the raw body into a signal field). Two cases:
  //   (a) exact echo — the (normalized) field IS the body: drop regardless of length, because a
  //       short body echoed whole is still a leak.
  //   (b) substantial substring — the body contains the field AND the field is long enough that
  //       this is clearly a body fragment, not an incidental short phrase a real signal might
  //       reuse (e.g. a date or "pay the bill"). The >40 floor avoids nulling legitimate text.
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (normalizedBody.length > 0) {
    if (normalized === normalizedBody) return undefined;
    if (normalizedBody.includes(normalized) && normalized.length > 40) return undefined;
    if (normalized.length >= SUMMARY_BODY_SUBSTRING_FLOOR) {
      for (let i = 0; i + SUMMARY_BODY_SUBSTRING_FLOOR <= normalized.length; i += 1) {
        if (normalizedBody.includes(normalized.slice(i, i + SUMMARY_BODY_SUBSTRING_FLOOR))) {
          return undefined;
        }
      }
    }
  }
  return trimmed;
}

function safeBills(value: unknown, body: string): EmailBill[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SIGNAL_ITEMS)
    .map((raw): EmailBill | undefined => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const description = safeSignalStr(o.description, body);
      if (description === undefined) return undefined;
      return {
        description,
        amount: typeof o.amount === "number" ? o.amount : undefined,
        currency: safeSignalStr(o.currency, body),
        dueDate: safeSignalStr(o.dueDate, body)
      };
    })
    .filter((b): b is EmailBill => b !== undefined);
}

function safeActionItems(value: unknown, body: string): EmailActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SIGNAL_ITEMS)
    .map((raw): EmailActionItem | undefined => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const text = safeSignalStr(o.text, body);
      if (text === undefined) return undefined;
      return { text, dueDate: safeSignalStr(o.dueDate, body) };
    })
    .filter((a): a is EmailActionItem => a !== undefined);
}

function safeDeadlines(value: unknown, body: string): EmailDeadline[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SIGNAL_ITEMS)
    .map((raw): EmailDeadline | undefined => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const text = safeSignalStr(o.text, body);
      if (text === undefined) return undefined;
      return { text, date: safeSignalStr(o.date, body) };
    })
    .filter((d): d is EmailDeadline => d !== undefined);
}

function safeActionability(value: unknown, body: string): EmailActionabilitySignal | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const category = ACTIONABILITY_CATEGORIES.includes(o.category as EmailActionabilityCategory)
    ? (o.category as EmailActionabilityCategory)
    : "unknown";
  const suggestedTasks = category === "noise" ? [] : safeActionItems(o.suggestedTasks, body);
  return {
    category,
    reason: safeSignalStr(o.reason, body),
    dueDate: safeSignalStr(o.dueDate, body),
    inferredSubject: safeSignalStr(o.inferredSubject, body),
    ...(suggestedTasks.length > 0 ? { suggestedTasks } : {})
  };
}

/**
 * Parse a model reply into a SANITIZED summary + signals. We never trust the model's JSON shape:
 * we pick ONLY the known fields (no unknown keys are ever carried through to the persisted jsonb),
 * coerce every value to a bounded type, and drop any string that echoes the email body. This is
 * the single chokepoint that keeps the model from leaking the body into a persisted column.
 */
function safeParseSignals(text: string, parsedBody: string): EmailExtractResult {
  const normalizedBody = parsedBody.replace(/\s+/g, " ").trim().toLowerCase();
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("no json object");
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const importance =
      obj.importance === "low" || obj.importance === "high" ? obj.importance : "normal";
    const confidence =
      typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
        ? obj.confidence
        : 0;
    // Keep the RAW (untruncated) summary here. Truncation to MAX_SUMMARY_CHARS happens only AFTER
    // the body-containment guard in extractEmailSignals — truncating first would let a model that
    // returns the first MAX_SUMMARY_CHARS of a longer body slip a near-complete body prefix past a
    // containment check (the guard could no longer "see" the full body inside the summary).
    const summary = typeof obj.summary === "string" ? obj.summary : null;
    return {
      summary,
      signals: {
        billsDue: safeBills(obj.billsDue, normalizedBody),
        actionItems: safeActionItems(obj.actionItems, normalizedBody),
        deadlines: safeDeadlines(obj.deadlines, normalizedBody),
        actionability: safeActionability(obj.actionability, normalizedBody),
        mayGetLostInShuffle: obj.mayGetLostInShuffle === true,
        importance,
        confidence
      }
    };
  } catch {
    // A bad LLM reply must never fail the whole sync (spec §error handling).
    return {
      summary: null,
      signals: { billsDue: [], actionItems: [], deadlines: [], confidence: 0 }
    };
  }
}

/** Fraction of the email body that, if collectively reproduced across signal strings, is treated
 * as a reconstruction attack. A genuine triage rarely re-quotes most of the body across fields. */
export const BODY_RECONSTRUCTION_FRACTION = 0.5;

/** Every persisted string inside a sanitized EmailSignals object, in document order. */
function signalStrings(signals: EmailSignals): string[] {
  const out: string[] = [];
  for (const b of signals.billsDue ?? []) {
    if (b.description) out.push(b.description);
    if (b.currency) out.push(b.currency);
    if (b.dueDate) out.push(b.dueDate);
  }
  for (const a of signals.actionItems ?? []) {
    if (a.text) out.push(a.text);
    if (a.dueDate) out.push(a.dueDate);
  }
  for (const d of signals.deadlines ?? []) {
    if (d.text) out.push(d.text);
    if (d.date) out.push(d.date);
  }
  if (signals.actionability) {
    const a = signals.actionability;
    if (a.reason) out.push(a.reason);
    if (a.dueDate) out.push(a.dueDate);
    if (a.inferredSubject) out.push(a.inferredSubject);
    for (const t of a.suggestedTasks ?? []) {
      if (t.text) out.push(t.text);
      if (t.dueDate) out.push(t.dueDate);
    }
  }
  return out;
}

/**
 * Cumulative body-reconstruction guard. The per-field echo check (safeSignalStr) drops a single
 * field that re-embeds a large body chunk, but a hostile model can split the body into many short
 * (<=40-char) chunks spread across description/text/dueDate/date fields, each individually under
 * the per-field floor, that together reconstruct the body in the persisted jsonb. This guard sums
 * how much of the (normalized) body is covered by signal strings that are body substrings; if that
 * coverage reaches BODY_RECONSTRUCTION_FRACTION of the body, we strip ALL text-bearing signal
 * arrays (keeping only the numeric/enum fields) so no body fragment is persisted (privacy §6).
 */
function stripIfBodyReconstructed(signals: EmailSignals, normalizedBody: string): EmailSignals {
  if (normalizedBody.length === 0) return signals;
  let covered = 0;
  for (const s of signalStrings(signals)) {
    const normalized = s.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.length > 0 && normalizedBody.includes(normalized)) covered += normalized.length;
  }
  if (covered >= normalizedBody.length * BODY_RECONSTRUCTION_FRACTION) {
    return {
      mayGetLostInShuffle: signals.mayGetLostInShuffle,
      importance: signals.importance,
      confidence: signals.confidence,
      truncated: signals.truncated,
      billsDue: [],
      actionItems: [],
      deadlines: [],
      // Keep the enum-only classification: the category itself carries no body text.
      ...(signals.actionability
        ? { actionability: { category: signals.actionability.category } }
        : {})
    };
  }
  return signals;
}

function sanitizeExtractResult(
  parsed: ParsedEmail,
  initial: EmailExtractResult
): EmailExtractResult {
  let result = initial;
  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedBody = normalize(parsed.body);
  if (result.summary !== null) {
    const normalizedSummary = normalize(result.summary);
    const containsLongBodyRun = (): boolean => {
      if (normalizedBody.length === 0 || normalizedSummary.length < SUMMARY_BODY_SUBSTRING_FLOOR) {
        return false;
      }
      for (let i = 0; i + SUMMARY_BODY_SUBSTRING_FLOOR <= normalizedSummary.length; i += 1) {
        if (normalizedBody.includes(normalizedSummary.slice(i, i + SUMMARY_BODY_SUBSTRING_FLOOR))) {
          return true;
        }
      }
      return false;
    };
    const echoesBody =
      normalizedSummary === normalizedBody ||
      (normalizedBody.length > 0 && normalizedSummary.includes(normalizedBody)) ||
      containsLongBodyRun();
    result = {
      ...result,
      summary: echoesBody ? null : result.summary.slice(0, MAX_SUMMARY_CHARS)
    };
  }

  result = { ...result, signals: stripIfBodyReconstructed(result.signals, normalizedBody) };
  return {
    ...result,
    signals: parsed.bodyTruncated ? { ...result.signals, truncated: true } : result.signals,
    escalated: false
  };
}

function buildBatchPrompt(messages: readonly ParsedEmail[]): string {
  return [
    EMAIL_TRIAGE_INSTRUCTIONS,
    "Apply those rules to every numbered input.",
    'Return one JSON object: {"results":[{"index":0,"value":<triage object>}, ...]}.',
    "Include every index exactly once and no extra indexes.",
    JSON.stringify(messages.map((message, index) => ({ index, email: promptInput(message) })))
  ].join("\n\n");
}

export function partitionEmailExtractionBatches(messages: readonly ParsedEmail[]): ParsedEmail[][] {
  const batches: ParsedEmail[][] = [];
  let current: ParsedEmail[] = [];
  for (const message of messages) {
    const candidate = [...current, message];
    if (
      current.length > 0 &&
      (candidate.length > EMAIL_EXTRACT_BATCH_MAX_ITEMS ||
        Buffer.byteLength(buildBatchPrompt(candidate), "utf8") >
          EMAIL_EXTRACT_BATCH_MAX_PROMPT_BYTES)
    ) {
      batches.push(current);
      current = [message];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function extractEmailSignalsBatch(
  messages: readonly ParsedEmail[],
  deps: EmailExtractDeps,
  options: EmailExtractOptions = {}
): Promise<EmailExtractResult[]> {
  const timeoutMs =
    options.callTimeoutMs ?? Number(process.env.JARVIS_EMAIL_LLM_TIMEOUT_MS ?? "20000");
  const extracted: EmailExtractResult[] = [];

  for (const [batchIndex, batch] of partitionEmailExtractionBatches(messages).entries()) {
    const telemetry = options.telemetry?.(batchIndex, batch.length);
    try {
      if (batch.length === 1) {
        const message = batch[0]!;
        const reply = await withTimeout(
          (signal) => deps.runChat(buildPrompt(message), signal, 1, telemetry),
          timeoutMs
        );
        extracted.push(sanitizeExtractResult(message, safeParseSignals(reply.text, message.body)));
        continue;
      }
      const reply = await withTimeout(
        (signal) => deps.runChat(buildBatchPrompt(batch), signal, batch.length, telemetry),
        timeoutMs
      );
      const object = JSON.parse(reply.text) as { results?: unknown };
      if (!Array.isArray(object.results) || object.results.length !== batch.length) {
        throw new Error("email-extract-batch-result-count");
      }
      const byIndex = new Map<number, unknown>();
      for (const item of object.results) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("email-extract-batch-result-shape");
        }
        const { index, value } = item as { index?: unknown; value?: unknown };
        if (
          !Number.isInteger(index) ||
          (index as number) < 0 ||
          (index as number) >= batch.length
        ) {
          throw new Error("email-extract-batch-result-index");
        }
        if (byIndex.has(index as number)) throw new Error("email-extract-batch-result-index");
        byIndex.set(index as number, value);
      }
      for (let index = 0; index < batch.length; index += 1) {
        if (!byIndex.has(index)) throw new Error("email-extract-batch-result-index");
        extracted.push(
          sanitizeExtractResult(
            batch[index]!,
            safeParseSignals(JSON.stringify(byIndex.get(index)), batch[index]!.body)
          )
        );
      }
    } catch (error) {
      if (error instanceof EmailExtractNeedsConfigurationError) throw error;
      telemetry?.emit({ kind: "fallback", count: batch.length });
      extracted.push(
        ...batch.map((message) =>
          sanitizeExtractResult(message, { summary: null, signals: { confidence: 0 } })
        )
      );
    }
  }
  return extracted;
}

export async function extractEmailSignals(
  parsed: ParsedEmail,
  deps: EmailExtractDeps,
  options: EmailExtractOptions = {}
): Promise<EmailExtractResult> {
  const timeoutMs =
    options.callTimeoutMs ?? Number(process.env.JARVIS_EMAIL_LLM_TIMEOUT_MS ?? "20000");

  const prompt = buildPrompt(parsed);
  let result: EmailExtractResult;
  try {
    const reply = await withTimeout((signal) => deps.runChat(prompt, signal), timeoutMs);
    result = safeParseSignals(reply.text, parsed.body);
  } catch (error) {
    if (error instanceof EmailExtractNeedsConfigurationError) throw error;
    // Timeout or model error — degrade to metadata-only, never throw (spec §error handling).
    result = { summary: null, signals: { confidence: 0 } };
  }

  return sanitizeExtractResult(parsed, result);
}
