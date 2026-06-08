import type { AiConfiguredModelSafeRow } from "./repository.js";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatActivityEvent {
  readonly kind: "thinking" | "tool" | "status" | "other";
  readonly text: string;
}

export interface GenerateChatInput {
  readonly model: AiConfiguredModelSafeRow;
  readonly messages: readonly ChatTurn[];
  readonly onActivity?: (event: ChatActivityEvent) => void;
}

export interface ChatProviderAdapter {
  generateChat(input: GenerateChatInput): Promise<{ readonly text: string }>;
}
