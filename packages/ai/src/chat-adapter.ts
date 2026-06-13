// HttpApiAdapter is re-exported here as the substrate for a future
// API-key-in-drawer tie-in — do not remove as dead code.
export { HttpApiAdapter } from "./adapters/http-api.js";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatActivityEvent {
  readonly kind: "thinking" | "tool" | "status" | "other";
  readonly text: string;
}

export interface GenerateChatInput {
  readonly model: { readonly provider_kind: string; readonly provider_model_id: string };
  readonly messages: readonly ChatTurn[];
  /** Optional output-token ceiling. When set, clamps the provider's max_tokens. Omitted = provider default. */
  readonly maxOutputTokens?: number;
  readonly onActivity?: (event: ChatActivityEvent) => void;
}

export interface ChatProviderAdapter {
  generateChat(input: GenerateChatInput): Promise<{ readonly text: string }>;
}
