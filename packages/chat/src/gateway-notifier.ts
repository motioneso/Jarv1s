import type { GatewaySessionRecord, SessionNotifier } from "@jarv1s/ai";
import type { ChatSessionManager } from "./live/chat-session-manager.js";
import { parseSurfaceSessionKey } from "./live/chat-surface.js";
import type { TranscriptRecord } from "./live/types.js";

/**
 * Bridges the AssistantToolGateway's SessionNotifier to ChatSessionManager's
 * subscriber fan-out. Composite session IDs carry the actor and surface;
 * bare actor IDs remain supported for existing callers.
 */
export class ChatGatewayNotifier implements SessionNotifier {
  constructor(private readonly manager: ChatSessionManager) {}

  emit(chatSessionId: string, record: GatewaySessionRecord): void {
    const transcriptRecord = toTranscriptRecord(record);
    if (transcriptRecord) {
      try {
        const { actorUserId, surface } = parseSurfaceSessionKey(chatSessionId);
        this.manager.injectRecord(actorUserId, transcriptRecord, surface);
      } catch {
        this.manager.injectRecord(chatSessionId, transcriptRecord);
      }
    }
  }
}

function toTranscriptRecord(record: GatewaySessionRecord): TranscriptRecord | null {
  if (record.kind === "action_request") {
    return {
      kind: "action_request",
      text: `Approve or deny: ${record.summary}`,
      actionRequestId: record.actionRequestId,
      toolName: record.toolName,
      summary: record.summary,
      // Rides the live stream only; never persisted (see TranscriptRecord.preview).
      ...(record.preview ? { preview: record.preview } : {})
    };
  }
  if (record.kind === "action_result") {
    const statusText =
      record.outcome === "executed" && typeof record.result?.statusText === "string"
        ? record.result.statusText.replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
    const text =
      statusText ||
      (record.outcome === "allowed"
        ? `Allowed by YOLO: ${record.toolName}`
        : record.outcome === "executed"
          ? `Executed: ${record.toolName}`
          : `Not changed${record.reason ? ` — ${record.reason}` : ""}`);
    return {
      kind: "action_result",
      text,
      actionRequestId: record.actionRequestId,
      toolName: record.toolName,
      outcome: record.outcome,
      ...(record.result ? { result: record.result } : {}),
      ...(record.affectsQueryKeys ? { affectsQueryKeys: record.affectsQueryKeys } : {})
    };
  }
  return null;
}
