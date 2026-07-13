import type { GatewaySessionRecord, SessionNotifier } from "@jarv1s/ai";
import type { ChatSessionManager } from "./live/chat-session-manager.js";
import type { TranscriptRecord } from "./live/types.js";

/**
 * Bridges the AssistantToolGateway's SessionNotifier to ChatSessionManager's
 * subscriber fan-out. In Phase 2, chatSessionId === actorUserId (one session
 * per user), so no reverse lookup is needed.
 */
export class ChatGatewayNotifier implements SessionNotifier {
  constructor(private readonly manager: ChatSessionManager) {}

  emit(chatSessionId: string, record: GatewaySessionRecord): void {
    const transcriptRecord = toTranscriptRecord(record);
    if (transcriptRecord) {
      this.manager.injectRecord(chatSessionId, transcriptRecord);
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
    const verb =
      record.outcome === "allowed"
        ? "Allowed by YOLO"
        : record.outcome === "executed"
          ? "Executed"
          : "Denied";
    return {
      kind: "action_result",
      text: `${verb}: ${record.toolName}`,
      actionRequestId: record.actionRequestId,
      toolName: record.toolName,
      outcome: record.outcome
    };
  }
  return null;
}
