import type { GmailMessageFull, GmailPayloadPart } from "./google-api-client.js";

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
export interface EmailSignals {
  readonly billsDue?: EmailBill[];
  readonly actionItems?: EmailActionItem[];
  readonly deadlines?: EmailDeadline[];
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

/** Injectable seam: the worker passes router-backed impls; tests pass fakes. */
export interface EmailExtractDeps {
  /**
   * Resolve a model for the summarization capability at a tier (router-backed). The sync pass only
   * ever requests the "economy" tier; the wider union is kept so the seam matches the underlying
   * router signature (AiRepository.selectModelForCapability), not because we escalate.
   */
  readonly selectModel: (
    tier: "economy" | "interactive" | "reasoning"
  ) => Promise<{ readonly tier: string } | undefined>;
  /** Run one chat generation against the resolved model; returns { text }. */
  readonly runChat: (
    model: { readonly tier: string },
    prompt: string
  ) => Promise<{ readonly text: string }>;
}

export interface EmailExtractOptions {
  /** Per-LLM-call timeout in ms (bounds sync latency; default from env, then 20s). */
  readonly callTimeoutMs?: number;
}

/** Reject a chat call that exceeds the budget so one slow model can't stall the whole sync. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("llm-timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function buildPrompt(parsed: ParsedEmail): string {
  return [
    "You are an email triage assistant. Read the email and reply with a single JSON object only,",
    "no prose, matching this TypeScript type:",
    "{ summary: string, billsDue: {description:string, amount?:number, currency?:string, dueDate?:string}[],",
    " actionItems: {text:string, dueDate?:string}[], deadlines: {text:string, date?:string}[],",
    ' mayGetLostInShuffle: boolean, importance: "low"|"normal"|"high", confidence: number }',
    "Use ISO dates. confidence is 0..1.",
    "",
    `Subject: ${parsed.subject}`,
    `From: ${parsed.from}`,
    "",
    parsed.body
  ].join("\n");
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
      deadlines: []
    };
  }
  return signals;
}

export async function extractEmailSignals(
  parsed: ParsedEmail,
  deps: EmailExtractDeps,
  options: EmailExtractOptions = {}
): Promise<EmailExtractResult> {
  const timeoutMs =
    options.callTimeoutMs ?? Number(process.env.JARVIS_EMAIL_LLM_TIMEOUT_MS ?? "20000");

  // Economy tier ONLY. The summary/signals pass is a high-volume, low-stakes batch job; the plan
  // (Goal §) pins it to the user's capability-routed *economy* model. We deliberately do NOT
  // escalate to interactive/reasoning here — that would spend the user's pricier tier on routine
  // inbox triage. Still fully provider-agnostic: the router selects whatever economy model the
  // user configured (no provider/model is hardcoded).
  const economyModel = await deps.selectModel("economy");
  if (!economyModel) {
    // No configured summarization model — metadata-only row (graceful degrade).
    return { summary: null, signals: {} };
  }
  // STRICT economy-tier enforcement. selectModelForCapability walks the tier ladder UP from the
  // requested tier and ultimately falls back to ANY active model, so "economy" can resolve to an
  // interactive/reasoning/other-tier model in production. The plan pins inbox triage to the user's
  // economy tier (cost posture); rather than silently spend a pricier tier on routine batch
  // summarization, we reject a non-economy resolution and degrade to a metadata-only row. Still
  // provider-agnostic: we gate on the tier label, never on a provider/model identity.
  if (economyModel.tier !== "economy") {
    return { summary: null, signals: {} };
  }

  const prompt = buildPrompt(parsed);
  let result: EmailExtractResult;
  try {
    const reply = await withTimeout(deps.runChat(economyModel, prompt), timeoutMs);
    result = safeParseSignals(reply.text, parsed.body);
  } catch {
    // Timeout or model error — degrade to metadata-only, never throw (spec §error handling).
    result = { summary: null, signals: { confidence: 0 } };
  }

  // Body-echo guard for the summary. A legitimate summary is SHORTER than the body and
  // paraphrases it; it never embeds (a large run of) the body. This runs on the RAW, untruncated
  // model summary — running it after truncation would blind it to a body longer than the summary
  // cap (a model returning the first MAX_SUMMARY_CHARS of a longer body would otherwise persist a
  // near-complete body prefix). We drop the summary when its normalized form:
  //   (a) equals the body, OR
  //   (b) CONTAINS the full body as a substring — the "Summary: <body>" wrap/prefix case a bad
  //       model uses to slip a short body past exact-equality, OR
  //   (c) IS a verbatim body substring (prefix/slice) long enough to be a reconstruction — the
  //       model echoing a long contiguous body chunk into the summary. We require the substring to
  //       be both an absolute minimum length AND cover the reconstruction fraction of the body, so
  //       a genuine short-email summary that happens to reuse a phrase verbatim is not nulled.
  // Only after passing all three is the summary truncated to MAX_SUMMARY_CHARS for persistence.
  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedBody = normalize(parsed.body);
  if (result.summary !== null) {
    const normalizedSummary = normalize(result.summary);
    // A summary that is a verbatim contiguous slice of the body, at or above the absolute
    // SUMMARY_BODY_SUBSTRING_FLOOR (200 chars), is a body echo regardless of WHAT FRACTION of
    // the body it covers. We deliberately DROP the prior `>= body.length * FRACTION` requirement:
    // a 200–600 char verbatim prefix of a LONG body (e.g. 200 chars of a 2000-char body) is below
    // 50% and was slipping through to be persisted as raw email text in `summary`. The fraction
    // gate is still used by the cumulative SIGNALS guard (stripIfBodyReconstructed), which sums
    // many short chunks; for the SINGLE-string summary, a 200+ char verbatim slice is enough.
    // Trade-off (accepted, fail-safe): a legitimate 200+ char summary that happens to be a
    // verbatim slice of a very short body is nulled → metadata-only row.
    const isLongBodySubstring =
      normalizedBody.length > 0 &&
      normalizedSummary.length >= SUMMARY_BODY_SUBSTRING_FLOOR &&
      normalizedBody.includes(normalizedSummary);
    const echoesBody =
      normalizedSummary === normalizedBody ||
      (normalizedBody.length > 0 && normalizedSummary.includes(normalizedBody)) ||
      isLongBodySubstring;
    result = {
      ...result,
      summary: echoesBody ? null : result.summary.slice(0, MAX_SUMMARY_CHARS)
    };
  }

  // Cumulative guard: defeat the "split the body into many short chunks across signal fields"
  // exfiltration path that the per-field echo check cannot see on its own.
  result = { ...result, signals: stripIfBodyReconstructed(result.signals, normalizedBody) };

  const truncatedSignals = parsed.bodyTruncated
    ? { ...result.signals, truncated: true }
    : result.signals;
  // escalated is always false now (economy-tier only); retained on the result type so the
  // handler's telemetry counter wiring stays stable without a signature change.
  return { ...result, signals: truncatedSignals, escalated: false };
}
