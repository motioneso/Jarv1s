import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

/**
 * Reads run. Writes default to confirm unless the owning module explicitly
 * declares auto agency. Destructive tools always confirm.
 */
export function resolvePolicy(tool: ModuleAssistantToolManifest): PolicyDecision {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";
  return tool.executionPolicy === "auto" ? "run" : "confirm";
}
