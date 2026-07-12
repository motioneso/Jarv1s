import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import type { RecurrenceMaterializePayload } from "./jobs.js";
import { TASKS_RECURRENCE_QUEUE } from "./manifest.js";

/**
 * Documented fixed daily cron expression: 03:00 — pre-dawn, before the morning
 * briefing reads tasks. Per-user timezone is deferred (see spec Out of scope);
 * the cron trigger itself still fires at one fixed UTC instant. #877 finding 2:
 * this comment used to claim a "lazy-on-view safety net" kept the list correct
 * regardless of local midnight — it couldn't, because both the worker and the
 * safety net computed `today` from the server's UTC day. That's fixed now: the
 * worker (jobs.ts) and every drift.ts repository method read the actor's persisted
 * timezone and roll forward on THEIR local day (readActorTimezone + localDay), so
 * the fixed-UTC trigger time no longer determines which calendar day a series
 * rolls onto.
 */
export function recurrenceCronExpr(): string {
  return "0 3 * * *";
}

export const RECURRENCE_SCHEDULE_TZ = "UTC";

/**
 * Upsert a per-actor daily recurrence schedule. The schedule row key is the
 * actorUserId, so pgboss.schedule's PRIMARY KEY (name, key) keeps exactly one row
 * per user. Failure-isolated: a schedule error must NEVER fail the caller's HTTP
 * request — it is logged structured (name+message only) and swallowed; the
 * per-session self-heal re-establishes the schedule next time.
 */
export async function reconcileRecurrenceSchedule(
  boss: PgBoss,
  actorUserId: string
): Promise<void> {
  const data: RecurrenceMaterializePayload = { actorUserId };
  try {
    // Defense-in-depth (mirrors briefings reconcileSchedule): boss.schedule does NOT route
    // through sendJob's metadata guard, so assert the cron payload is metadata-only here too
    // (Hard Invariant: metadata-only job payloads). `actorUserId` is in ALLOWED_PAYLOAD_KEYS
    // today; this catches a future payload drift at the source. A throw here is caught by the
    // surrounding failure-isolation catch and logged, never surfaced to the HTTP caller.
    assertMetadataOnlyPayload(data);
    await boss.schedule(TASKS_RECURRENCE_QUEUE, recurrenceCronExpr(), data, {
      tz: RECURRENCE_SCHEDULE_TZ,
      key: actorUserId
    });
    // Observability (Codex finding): a structured success line so schedule upserts are
    // visible/auditable. actorUserId is an internal id, not a secret. Cardinality is
    // bounded to one row per actor by the (name, key) primary key.
    process.stdout.write(
      `${JSON.stringify({
        level: "debug",
        event: "tasks.recurrence_schedule_reconciled",
        actorUserId
      })}\n`
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "tasks.recurrence_schedule_failed",
        name: err.name,
        message: err.message
      })}\n`
    );
  }
}
