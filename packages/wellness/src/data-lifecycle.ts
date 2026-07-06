import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ModuleLifecycleContext } from "@jarv1s/module-sdk";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
type ExportRow = Record<string, JsonValue>;

export interface WellnessExportSectionData {
  readonly checkins: readonly ExportRow[];
  readonly therapy_notes: readonly ExportRow[];
}

/**
 * Collects the `sections.wellness` full-account export section (#801 Phase A). Reproduces,
 * verbatim, the query shapes previously hand-maintained as wellnessCheckinsQuery /
 * wellnessTherapyNotesQuery in packages/settings/src/data-export.ts — moved here so wellness
 * owns its own export data instead of settings reading wellness's tables directly (byte-compat
 * is the acceptance bar; do not change column selection/order without also updating the golden
 * export test). `medications` / `medication_logs` (also wellness-owned tables) feed the
 * archive's separate `structured_state` section and are read there in @jarv1s/settings,
 * unaffected by this move — they are not required to be covered by an export section (only
 * `dataLifecycle.deletion.tables` requires full ownedTables coverage).
 */
export async function collectWellnessExportSection(
  scopedDb: unknown,
  ctx: ModuleLifecycleContext
): Promise<WellnessExportSectionData> {
  assertDataContextDb(scopedDb as DataContextDb);
  const db = (scopedDb as DataContextDb).db;
  const userId = ctx.actorUserId;

  const checkins = await sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      checked_in_at AS "checkedInAt",
      feeling_core::text AS "feelingCore",
      feeling_secondary::text AS "feelingSecondary",
      feeling_tertiary::text AS "feelingTertiary",
      wheel_version AS "wheelVersion",
      sensations,
      intensity,
      energy,
      note,
      identified_via AS "identifiedVia",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.wellness_checkins
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY checked_in_at DESC, id
  `.execute(db);

  const therapyNotes = await sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      body,
      linked_checkin_id::text AS "linkedCheckinId",
      linked_emotion::text AS "linkedEmotion",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.wellness_therapy_notes
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id
  `.execute(db);

  return {
    checkins: checkins.rows.map(normalizeRow),
    therapy_notes: therapyNotes.rows.map(normalizeRow)
  };
}

// Duplicated from packages/settings/src/data-export.ts's normalizeRow/normalizeValue rather
// than shared: no common utility package exists for this, and importing from @jarv1s/settings
// here (or the reverse) would create a package cycle (wellness -> settings already exists via
// export-job.ts's recordAuditEvent import).
function normalizeRow(row: Record<string, unknown>): ExportRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  ) as ExportRow;
}

function normalizeValue(value: unknown): JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested)
      ])
    );
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  return String(value);
}
