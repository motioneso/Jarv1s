import type { ProviderKind } from "@jarv1s/ai"; // "anthropic" | "openai-compatible" | "google"

export type ChatRecordKind = "user" | "thinking" | "tool" | "status" | "reply" | "error" | "action_request" | "action_result";
export interface TranscriptRecord {
  readonly kind: ChatRecordKind;
  readonly text: string;
  readonly actionRequestId?: string;
  readonly toolName?: string;
  readonly summary?: string;
  readonly outcome?: "executed" | "denied" | "error";
}

export interface EngineLaunchOpts {
  readonly neutralDir: string;
  readonly personaPath: string; // rendered persona context file in neutralDir
  readonly mcpConfigPath?: string; // Phase 2 (unused in Phase 1)
  readonly mcpToken?: string; // Phase 2: per-session JWT for MCP gateway
  readonly mcpServerUrl?: string; // Phase 2: MCP gateway base URL
}

/** A persistent per-user CLI session. One instance per live session. */
export interface CliChatEngine {
  readonly provider: ProviderKind;
  launch(opts: EngineLaunchOpts): Promise<void>;
  submit(text: string): Promise<void>; // paste prompt + send
  /** Read transcript records appended since the given byte offset; returns the new offset. */
  readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }>;
  isAlive(): Promise<boolean>;
  kill(): Promise<void>;
}

export interface ChatTurnSeed {
  readonly priorTurns: readonly { role: "user" | "assistant"; content: string }[];
}
