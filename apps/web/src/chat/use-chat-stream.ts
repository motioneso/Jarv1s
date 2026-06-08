import { useCallback, useEffect, useState } from "react";

import { chatStreamUrl } from "../api/client";

/**
 * Mirrors the backend's live-chat TranscriptRecord (packages/chat/src/live/types.ts).
 * Kept local because it is an internal chat-runtime shape, not part of @jarv1s/shared.
 */
export type ChatRecordKind = "user" | "thinking" | "tool" | "status" | "reply" | "error";

export interface TranscriptRecord {
  readonly kind: ChatRecordKind;
  readonly text: string;
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
  readonly appendRecord: (record: TranscriptRecord) => void;
} {
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);

  const clearRecords = useCallback(() => setRecords([]), []);
  const appendRecord = useCallback(
    (record: TranscriptRecord) => setRecords((current) => [...current, record]),
    []
  );

  useEffect(() => {
    const source = new EventSource(chatStreamUrl(), { withCredentials: true });

    source.onmessage = (event) => {
      const record = parseRecord(event.data);
      if (record) {
        setRecords((current) => [...current, record]);
      }
    };

    // EventSource auto-reconnects on transient errors; nothing extra to do here.
    return () => source.close();
  }, []);

  return { records, clearRecords, appendRecord };
}

function parseRecord(data: unknown): TranscriptRecord | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as Partial<TranscriptRecord>;
    if (typeof parsed.kind === "string" && typeof parsed.text === "string") {
      return { kind: parsed.kind as ChatRecordKind, text: parsed.text };
    }
  } catch {
    return null;
  }

  return null;
}
