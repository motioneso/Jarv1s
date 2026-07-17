// #1110 regression fix: split out of index.ts so @jarv1s/shared can import AI_MODEL_CAPABILITIES
// (a runtime value, so it can't be made type-only) without pulling the barrel's node:crypto
// re-export (rate-limit-key.ts) into the apps/web browser bundle. See the
// shared-is-Vite-bundled-never-node invariant. This leaf must stay free of node:* imports.
export type AiModelTier = "reasoning" | "interactive" | "economy";
export type AiModelCapability =
  | "chat"
  | "tool-use"
  | "json"
  | "vision"
  | "summarization"
  | "transcription";

export const AI_MODEL_CAPABILITIES: readonly AiModelCapability[] = [
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization",
  "transcription"
];
