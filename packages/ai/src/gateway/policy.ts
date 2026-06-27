import type {
  ModuleAssistantToolManifest,
  ModuleAssistantActionFamilyManifest,
  JarvisActionPermissionTier
} from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

export interface ActionPolicyLookup {
  getFamilyTier(moduleId: string, familyId: string): Promise<JarvisActionPermissionTier | null>;
  getFamilyManifest(
    moduleId: string,
    familyId: string
  ): Promise<ModuleAssistantActionFamilyManifest | null>;
}

export interface AgencyPrefLookup {
  get(key: string): Promise<unknown>;
  upsert?(key: string, value: unknown): Promise<void>;
}

/**
 * Reads run. Writes default to confirm unless the owning module explicitly
 * declares auto agency (or tier = trusted_auto) and the user promoted that module. Destructive tools
 * always confirm.
 */
export async function resolvePolicy(
  tool: ModuleAssistantToolManifest,
  moduleId: string,
  lookup: ActionPolicyLookup,
  legacyPrefs?: AgencyPrefLookup
): Promise<PolicyDecision> {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";

  const familyId = tool.actionFamilyId;
  if (!familyId) {
    if (tool.executionPolicy !== "auto") return "confirm";
    if (legacyPrefs) {
      try {
        return (await legacyPrefs.get(`${moduleId}.agency_auto_execute`)) === true
          ? "run"
          : "confirm";
      } catch {
        return "confirm";
      }
    }
    return "confirm";
  }

  const manifest = await lookup.getFamilyManifest(moduleId, familyId);
  if (!manifest) return "confirm";

  const tier = (await lookup.getFamilyTier(moduleId, familyId)) ?? manifest.defaultTier;
  if (tier === "trusted_auto") return "run";

  return "confirm";
}
