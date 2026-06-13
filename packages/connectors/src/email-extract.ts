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
  /** Resolve a model for the summarization capability at a tier (router-backed). */
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
  readonly escalateConfidence?: number;
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

function safeParseSignals(text: string): EmailExtractResult {
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
    const summary =
      typeof obj.summary === "string" ? obj.summary.slice(0, MAX_SUMMARY_CHARS) : null;
    return {
      summary,
      signals: {
        billsDue: Array.isArray(obj.billsDue) ? (obj.billsDue as EmailBill[]) : [],
        actionItems: Array.isArray(obj.actionItems) ? (obj.actionItems as EmailActionItem[]) : [],
        deadlines: Array.isArray(obj.deadlines) ? (obj.deadlines as EmailDeadline[]) : [],
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

export async function extractEmailSignals(
  parsed: ParsedEmail,
  deps: EmailExtractDeps,
  options: EmailExtractOptions = {}
): Promise<EmailExtractResult> {
  const threshold =
    options.escalateConfidence ?? Number(process.env.JARVIS_EMAIL_ESCALATE_CONFIDENCE ?? "0.5");
  const timeoutMs =
    options.callTimeoutMs ?? Number(process.env.JARVIS_EMAIL_LLM_TIMEOUT_MS ?? "20000");

  const economyModel = await deps.selectModel("economy");
  if (!economyModel) {
    // No configured summarization model — metadata-only row (graceful degrade).
    return { summary: null, signals: {} };
  }

  const prompt = buildPrompt(parsed);
  let result: EmailExtractResult;
  let escalated = false;
  try {
    const reply = await withTimeout(deps.runChat(economyModel, prompt), timeoutMs);
    result = safeParseSignals(reply.text);
  } catch {
    // Timeout or model error — degrade to metadata-only, never throw (spec §error handling).
    result = { summary: null, signals: { confidence: 0 } };
  }

  // Optional single escalation: high importance + low confidence → next tier (at most once).
  if (result.signals.importance === "high" && (result.signals.confidence ?? 0) < threshold) {
    const higher = await deps.selectModel("interactive");
    if (higher) {
      try {
        const reply = await withTimeout(deps.runChat(higher, prompt), timeoutMs);
        result = safeParseSignals(reply.text);
        escalated = true;
      } catch {
        /* keep the economy result on escalation failure */
      }
    }
  }

  // Verbatim-echo guard: if the model returned the body verbatim (no summarization at all),
  // drop the summary rather than persist the raw body. We deliberately use EXACT normalized
  // equality (whitespace-collapsed), NOT a fuzzy overlap threshold — a real summary of a short
  // email legitimately reuses much of its wording, so an overlap heuristic would null-out valid
  // summaries. Exact equality catches only the pathological "model echoed the body" case.
  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (result.summary !== null && normalize(result.summary) === normalize(parsed.body)) {
    result = { ...result, summary: null };
  }

  const truncatedSignals = parsed.bodyTruncated
    ? { ...result.signals, truncated: true }
    : result.signals;
  return { ...result, signals: truncatedSignals, escalated };
}
