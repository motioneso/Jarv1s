import { sql } from "kysely";
import { assertDataContextDb, type DataContextDb, type PreferencesPort } from "@jarv1s/db";
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

  /**
   * #1263: install-time grant for the task_changes family. Unlike the generic
   * AiRepository.insertActionPolicyIfAbsent (which only checks the canonical key), this checks
   * BOTH the canonical and legacy keys before inserting, so a user who opted out via the legacy
   * `tasks.agency_auto_execute = false` toggle before the canonical key existed does not get
   * silently flipped to trusted_auto the next time the tasks module is (re-)enabled. Single
   * atomic statement to avoid a read-then-write race between concurrent enable requests.
   */
  async grantInstallTimeTrustIfUnset(db: DataContextDb): Promise<void> {
    assertDataContextDb(db);
    await sql`
      insert into app.preferences (owner_user_id, key, value_json, updated_at)
      select app.current_actor_user_id(), ${TASK_CHANGES_POLICY_KEY},
        ${JSON.stringify("trusted_auto")}::jsonb, now()
      where not exists (
        select 1 from app.preferences
        where owner_user_id = app.current_actor_user_id()
          and key in (${TASK_CHANGES_POLICY_KEY}, ${LEGACY_AGENCY_AUTO_EXECUTE_KEY})
      )
      on conflict (owner_user_id, key) do nothing
    `.execute(db.db);
  }
}
