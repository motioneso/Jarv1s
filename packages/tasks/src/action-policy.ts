import type { DataContextDb, PreferencesPort } from "@jarv1s/db";
import type { JarvisActionPermissionTier } from "@jarv1s/module-sdk";

export const TASK_CHANGES_POLICY_KEY = "assistant.action_policy.v1.tasks.task_changes";
export const LEGACY_AGENCY_AUTO_EXECUTE_KEY = "tasks.agency_auto_execute";

export class TasksCompatibilityHelper {
  constructor(private readonly prefs: PreferencesPort) {}

  async getResolvedTaskChangesPolicy(db: DataContextDb): Promise<JarvisActionPermissionTier> {
    const canonical = await this.prefs.getWithMetadata<JarvisActionPermissionTier>(
      db,
      TASK_CHANGES_POLICY_KEY
    );
    const legacy = await this.prefs.getWithMetadata<boolean>(db, LEGACY_AGENCY_AUTO_EXECUTE_KEY);

    if (!canonical && !legacy) return "ask_each_time";
    if (canonical && !legacy) return canonical.value;
    if (!canonical && legacy) return legacy.value ? "trusted_auto" : "ask_each_time";

    // Both exist, use the most recently updated
    if (canonical!.updatedAt >= legacy!.updatedAt) {
      return canonical!.value;
    }
    return legacy!.value ? "trusted_auto" : "ask_each_time";
  }

  async setTaskChangesPolicy(db: DataContextDb, tier: JarvisActionPermissionTier): Promise<void> {
    await this.prefs.upsert(db, TASK_CHANGES_POLICY_KEY, tier);
    const legacyBoolean = tier === "trusted_auto";
    await this.prefs.upsert(db, LEGACY_AGENCY_AUTO_EXECUTE_KEY, legacyBoolean);
  }
}
