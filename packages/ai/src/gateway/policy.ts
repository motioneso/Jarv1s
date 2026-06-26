import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";
export interface AgencyPrefLookup {
  get(key: string): Promise<unknown>;
  upsert?(key: string, value: unknown): Promise<void>;
}

/**
 * Reads run. Writes default to confirm unless the owning module explicitly
 * declares auto agency and the user promoted that module. Destructive tools
 * always confirm.
 */
export async function resolvePolicy(
  tool: ModuleAssistantToolManifest,
  moduleId: string,
  prefs: AgencyPrefLookup
): Promise<PolicyDecision> {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";
  if (tool.executionPolicy !== "auto") return "confirm";
  try {
    return (await prefs.get(`${moduleId}.agency_auto_execute`)) === true ? "run" : "confirm";
  } catch {
    return "confirm";
  }
}
