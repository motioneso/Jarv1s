import type { AiModelCapability } from "@jarv1s/shared";

import type { AiCapabilityRouteMap } from "./repository.js";

const AI_MODEL_CAPABILITIES = new Set<AiModelCapability>([
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
]);

export function parseCapabilityRouteMap(value: unknown): AiCapabilityRouteMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const routes: AiCapabilityRouteMap = {};
  for (const [capability, modelId] of Object.entries(value)) {
    if (!AI_MODEL_CAPABILITIES.has(capability as AiModelCapability)) continue;
    if (modelId === null || typeof modelId === "string") {
      routes[capability as AiModelCapability] = modelId;
    }
  }

  return routes;
}
