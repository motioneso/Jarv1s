import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { NOTES_SYNC_QUEUE } from "./manifest.js";

/**
 * 15-min heartbeat cron for the Notes Source sync (#449). v1 is single-operator /
 * UTC; per-actor TZ is a future refinement. The schedule is RECONCILED on settings
 * change (PUT /api/me/notes-source), not registered at boot — same lazy-reconcile
 * shape as briefings/src/schedule.ts. One schedule row per actor, keyed on
 * actorUserId (pgboss.schedule PK (name, key)).
 */
export const NOTES_SYNC_CRON = "*/15 * * * *";
const NOTES_SYNC_TZ = "UTC";

/**
 * Reconcile the per-actor notes-sync schedule. When `hasPath` is true, upsert a
 * 15-min cron; when false, unschedule. The scheduled payload is {actorUserId} only —
 * the worker resolves `sourcePath` from the `notes-source-path` preference at fire
 * time (see handleNotesSyncJob), so the preference stays the single source of truth
 * and a re-point via PUT is picked up on the next tick without rewriting the row.
 *
 * Mirrors briefings/src/schedule.ts:56-76 (schedule + unschedule lifecycle).
 * `assertMetadataOnlyPayload` is defense-in-depth: boss.schedule does NOT route
 * through sendJob's metadata guard, so assert here too (Hard Invariant).
 */
export async function reconcileNotesSchedule(
  boss: PgBoss,
  actorUserId: string,
  hasPath: boolean
): Promise<void> {
  if (hasPath) {
    const data = { actorUserId };
    assertMetadataOnlyPayload(data);
    await boss.schedule(NOTES_SYNC_QUEUE, NOTES_SYNC_CRON, data, {
      tz: NOTES_SYNC_TZ,
      key: actorUserId
    });
    return;
  }
  // Two-arg form: unschedule(queueName, key). NOT a concatenated "name__key" string.
  await boss.unschedule(NOTES_SYNC_QUEUE, actorUserId);
}
