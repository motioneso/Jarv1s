import type { ModuleAssistantToolRisk } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

/**
 * Phase 2 policy is hardcoded: reads run, writes confirm, destructive ALWAYS
 * confirms (the un-skippable floor). Configurable per-user policy is the future
 * Module Connector epic (#30) — the destructive floor survives even then.
 */
export function resolvePolicy(risk: ModuleAssistantToolRisk): PolicyDecision {
  return risk === "read" ? "run" : "confirm";
}
