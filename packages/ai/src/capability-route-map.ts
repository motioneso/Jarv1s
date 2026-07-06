import { AI_MODEL_CAPABILITIES, type AiModelCapability } from "@jarv1s/shared";

import type { AiCapabilityRouteMap } from "./repository.js";

const RECOGNIZED_CAPABILITIES = new Set<AiModelCapability>(AI_MODEL_CAPABILITIES);

export function parseCapabilityRouteMap(value: unknown): AiCapabilityRouteMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const routes: AiCapabilityRouteMap = {};
  for (const [capability, modelId] of Object.entries(value)) {
    if (!RECOGNIZED_CAPABILITIES.has(capability as AiModelCapability)) continue;
    if (modelId === null || typeof modelId === "string") {
      routes[capability as AiModelCapability] = modelId;
    }
  }

  return routes;
}
