/**
 * JSONL transcript reader — maps per-provider CLI transcript records into
 * ChatActivityEvent stream + final reply detection.
 *
 * ─── Discovered schemas (2026-06-07) ──────────────────────────────────────
 *
 * ## Claude Code / anthropic  (~/.claude/projects/<hash>/<session>.jsonl)
 *
 *   Each line is a JSON object with top-level fields:
 *     type       : "assistant" | "user" | "mode" | "ai-title" | "attachment" | ...
 *     message    : { role, content[], stop_reason, stop_sequence, ... }
 *     uuid, parentUuid, timestamp, sessionId, ...
 *
 *   content items (in message.content[]):
 *     { type: "thinking",  thinking: "<text>" }        → thinking activity
 *     { type: "tool_use",  name: "<name>", ... }       → tool activity
 *     { type: "text",      text: "<text>" }            → narrative / final text
 *
 *   Completion signal:
 *     type === "assistant" AND message.stop_reason === "end_turn"
 *     AND at least one content item has type === "text"
 *     → the concatenated text of those items is the final reply.
 *
 *   Intermediate signals:
 *     stop_reason === "tool_use" — record contains thinking or tool_use items
 *
 * ## Codex / openai-compatible  (~/.codex/sessions/<year>/<mm>/<dd>/<session>.jsonl)
 *
 *   Top-level record types: "session_meta", "event_msg", "response_item",
 *                           "turn_context", "compacted"
 *
 *   Relevant type === "event_msg" records (payload.type):
 *     "agent_reasoning"   : { text }   → thinking activity
 *     "exec_command_end"  : { command } → tool activity (command ran)
 *     "agent_message"     : { message } → status text (intermediate narrative)
 *     "task_complete"     : { last_agent_message } → FINAL reply
 *
 *   Also type === "response_item" with payload.role === "assistant" and
 *   payload.phase === "final_answer" and payload.content[0].type === "output_text"
 *   carries the same final text (redundant with task_complete).
 *
 *   Completion signal:
 *     type === "event_msg" AND payload.type === "task_complete"
 *     → payload.last_agent_message is the final reply string.
 *
 * ## Gemini CLI / google  (~/.gemini/tmp/<project>/chats/<session>.jsonl)
 *
 *   Each line is a JSON object with top-level fields:
 *     type : "gemini" | "user" | "info" | "error" | (absent for metadata lines)
 *     id, timestamp, content (string), thoughts (array), tokens, model
 *
 *   type === "gemini" records:
 *     content === "" (empty string) → intermediate: thoughts only
 *       thoughts[i] = { subject, description } → thinking activity per thought
 *     content !== "" → FINAL reply (content is the full reply string)
 *
 *   Completion signal:
 *     type === "gemini" AND content is a non-empty string.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ChatActivityEvent } from "../chat-adapter.js";

export type ProviderKind = "anthropic" | "openai-compatible" | "google";

export interface TranscriptParseResult {
  readonly events: readonly ChatActivityEvent[];
  readonly reply: string | null;
  readonly complete: boolean;
}

/**
 * Parse a JSONL transcript string for the given provider.
 *
 * @param provider  Which CLI produced the transcript.
 * @param jsonl     Full transcript content as a string.
 * @param afterOffset  Byte offset into `jsonl` to start reading from
 *                    (pass 0 to read everything; pass the previous `jsonl.length`
 *                    to read only newly appended lines).
 */
export function parseTranscript(
  provider: ProviderKind,
  jsonl: string,
  afterOffset: number
): TranscriptParseResult {
  const slice = jsonl.slice(afterOffset);
  const lines = slice.split("\n").filter((l) => l.trim().length > 0);

  const events: ChatActivityEvent[] = [];
  let reply: string | null = null;
  let complete = false;

  for (const line of lines) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Partial/corrupt line — skip (CLI may still be writing)
      continue;
    }

    switch (provider) {
      case "anthropic":
        mapAnthropicRecord(rec, events, (r) => {
          reply = r;
          complete = true;
        });
        break;
      case "openai-compatible":
        mapCodexRecord(rec, events, (r) => {
          reply = r;
          complete = true;
        });
        break;
      case "google":
        mapGeminiRecord(rec, events, (r) => {
          reply = r;
          complete = true;
        });
        break;
    }
  }

  return { events, reply, complete };
}

// ─── anthropic / Claude Code mapping ─────────────────────────────────────────

function mapAnthropicRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  if (rec["type"] !== "assistant") return;

  const message = rec["message"] as Record<string, unknown> | undefined;
  if (!message) return;

  const stopReason = message["stop_reason"] as string | undefined;
  const content = message["content"];
  if (!Array.isArray(content)) return;

  if (stopReason === "end_turn") {
    // Collect all text content items as the final reply
    const textParts: string[] = [];
    for (const item of content) {
      if (!isRecord(item)) continue;
      if (item["type"] === "text" && typeof item["text"] === "string") {
        textParts.push(item["text"]);
      }
    }
    if (textParts.length > 0) {
      onFinal(textParts.join("\n"));
    }
    return;
  }

  // Intermediate: extract activity events from content items
  for (const item of content) {
    if (!isRecord(item)) continue;
    const itemType = item["type"] as string | undefined;
    if (itemType === "thinking") {
      const text = typeof item["thinking"] === "string" ? item["thinking"] : "";
      events.push({ kind: "thinking", text });
    } else if (itemType === "tool_use") {
      const name = typeof item["name"] === "string" ? item["name"] : "tool";
      events.push({ kind: "tool", text: name });
    } else if (itemType === "text" && typeof item["text"] === "string") {
      // Intermediate text blocks (stop_reason !== "end_turn") are status
      events.push({ kind: "status", text: item["text"] });
    }
  }
}

// ─── openai-compatible / Codex mapping ───────────────────────────────────────

function mapCodexRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  if (rec["type"] !== "event_msg") return;

  const payload = rec["payload"] as Record<string, unknown> | undefined;
  if (!payload) return;

  const payloadType = payload["type"] as string | undefined;

  switch (payloadType) {
    case "agent_reasoning": {
      const text = typeof payload["text"] === "string" ? payload["text"] : "";
      events.push({ kind: "thinking", text });
      break;
    }
    case "exec_command_end": {
      const command = payload["command"];
      const cmdText = Array.isArray(command) ? command.join(" ") : String(command ?? "");
      events.push({ kind: "tool", text: cmdText });
      break;
    }
    case "agent_message": {
      const text = typeof payload["message"] === "string" ? payload["message"] : "";
      events.push({ kind: "status", text });
      break;
    }
    case "task_complete": {
      const msg = payload["last_agent_message"];
      if (typeof msg === "string") {
        onFinal(msg);
      }
      break;
    }
  }
}

// ─── google / Gemini CLI mapping ──────────────────────────────────────────────

function mapGeminiRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  if (rec["type"] !== "gemini") return;

  const content = rec["content"];
  const thoughts = rec["thoughts"];

  if (typeof content === "string" && content.length > 0) {
    // Non-empty content = final reply
    onFinal(content);
    return;
  }

  // Empty content = intermediate thoughts only
  if (Array.isArray(thoughts)) {
    for (const thought of thoughts) {
      if (!isRecord(thought)) continue;
      const subject = typeof thought["subject"] === "string" ? thought["subject"] : "";
      const description = typeof thought["description"] === "string" ? thought["description"] : "";
      const text = subject ? `${subject}: ${description}` : description;
      events.push({ kind: "thinking", text });
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
