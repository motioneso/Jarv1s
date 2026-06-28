import type { SourceFreshnessV1 } from "@jarv1s/shared";
import { useCallback, useEffect, useState } from "react";

import type { AnswerSourceSupportCard } from "@jarv1s/shared";

import { chatStreamUrl } from "../api/client.js";

export type ChatRecordKind =
  | "user"
  | "thinking"
  | "tool"
  | "status"
  | "reply"
  | "error"
  | "action_request"
  | "action_result";

export interface TranscriptRecord {
  readonly kind: ChatRecordKind;
  readonly text: string;
  readonly messageId?: string;
  readonly actionRequestId?: string;
  readonly toolName?: string;
  readonly summary?: string;
  readonly outcome?: "executed" | "denied" | "error";
  readonly answerProvenance?: readonly AnswerSourceSupportCard[];
  readonly answerProvenanceCitedIds?: readonly string[];
  readonly sourceFreshness?: SourceFreshnessV1 | null;
}

function isChatRecordKind(value: string): value is ChatRecordKind {
  switch (value) {
    case "user":
    case "thinking":
    case "tool":
    case "status":
    case "reply":
    case "error":
    case "action_request":
    case "action_result":
      return true;
    default:
      return false;
  }
}

/**
 * Opens an EventSource against /api/chat/stream and accumulates the live transcript
 * records the backend emits (one JSON record per `data:` event). EventSource handles
 * reconnect automatically; we just append parsed records to local state and close on
 * unmount. `clearRecords` resets the local log (used by the "New chat" action).
 */
export function useChatStream(): {
  readonly records: readonly TranscriptRecord[];
  readonly clearRecords: () => void;
} {
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);

  const clearRecords = useCallback(() => setRecords([]), []);

  useEffect(() => {
    const source = new EventSource(chatStreamUrl(), { withCredentials: true });

    source.onmessage = (event) => {
      const record = parseRecord(event.data);
      if (record) {
        setRecords((current) => {
          if (record.kind === "reply" && record.messageId) {
            // Replace the last streaming reply (no messageId) with the stored version (has messageId + sourceFreshness)
            const lastUnstored = [...current]
              .reverse()
              .findIndex((r) => r.kind === "reply" && !r.messageId);
            if (lastUnstored !== -1) {
              const realIdx = current.length - 1 - lastUnstored;
              return current.map((r, i) => (i === realIdx ? record : r));
            }
          }
          return [...current, record];
        });
      }
    };

    // EventSource auto-reconnects on transient errors; nothing extra to do here.
    return () => source.close();
  }, []);

  return { records, clearRecords };
}

export function parseRecord(data: unknown): TranscriptRecord | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (typeof parsed.kind !== "string" || typeof parsed.text !== "string") return null;
    if (!isChatRecordKind(parsed.kind)) return null;
    return {
      kind: parsed.kind,
      text: parsed.text,
      messageId: typeof parsed.messageId === "string" ? parsed.messageId : undefined,
      actionRequestId:
        typeof parsed.actionRequestId === "string" ? parsed.actionRequestId : undefined,
      toolName: typeof parsed.toolName === "string" ? parsed.toolName : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      outcome:
        parsed.outcome === "executed" || parsed.outcome === "denied" || parsed.outcome === "error"
          ? parsed.outcome
          : undefined,
      sourceFreshness:
        parsed.sourceFreshness && typeof parsed.sourceFreshness === "object"
          ? (parsed.sourceFreshness as SourceFreshnessV1)
          : undefined
    };
  } catch {
    return null;
  }
}
