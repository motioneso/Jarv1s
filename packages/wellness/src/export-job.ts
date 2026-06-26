// Wellness selective export worker (#484).
//
// Owns the `wellness-export` pg-boss job kind. Metadata-only payload: { actorUserId, jobId, kind }.
// The worker re-reads the selected timeframe + categories from the job ROW's params (defense-
// in-depth against payload tampering — never trusts the payload for the data query), loads the
// relevant Wellness repos bounded to the [from, to] window, renders the printable HTML server-side
// via the pure renderer, writes exports/<jobId>.html to the vault, and marks the job ready.
//
// Owner-scoped throughout: the job row is read under the actor's DataContext, all repo reads run
// under the same scoped DataContext (RLS owner-only), and the vault write is owner-scoped. No
// admin bypass. Audit metadata-only (jobId/from/to/categories — no health content).

import type { Job } from "@jarv1s/jobs";
import {
  type ActorScopedJobPayload,
  type PgBoss,
  type QueueDefinition,
  registerDataContextWorker,
  sendJob
} from "@jarv1s/jobs";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { VaultContextRunner, getVaultBaseDir, writeVaultFile } from "@jarv1s/vault";
import { recordAuditEvent } from "@jarv1s/settings";
import type { WellnessInsightDto } from "@jarv1s/shared";

import { computeInsights } from "./insights.js";
import { DataExportRepository } from "./data-export-port.js";
import {
  renderWellnessExportHtml,
  type ExportCheckinItem,
  type ExportMedicationItem,
  type ExportMedicationLogItem,
  type ExportTherapyNoteItem,
  type WellnessExportDocument
} from "./export-render.js";
import { WellnessRepository } from "./repository.js";

export const WELLNESS_EXPORT_QUEUE = "wellness-export";

export interface WellnessExportJobPayload extends ActorScopedJobPayload {
  readonly kind: "wellness.export";
  readonly jobId: string;
}

export interface WellnessExportParams {
  readonly from: string;
  readonly to: string;
  readonly categories: readonly string[];
}

export const WELLNESS_EXPORT_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: WELLNESS_EXPORT_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 300,
      retentionSeconds: 300
    }
  }
];

export async function enqueueWellnessExportJob(
  boss: PgBoss,
  actorUserId: string,
  jobId: string
): Promise<void> {
  await sendJob<WellnessExportJobPayload>(boss, WELLNESS_EXPORT_QUEUE, {
    kind: "wellness.export",
    jobId,
    actorUserId
  });
}

// ── Row → render-input mappers (keep the renderer pure + trivially testable) ──

function toCheckinItem(row: {
  readonly checked_in_at: unknown;
  readonly feeling_core: unknown;
  readonly feeling_secondary: unknown;
  readonly intensity: unknown;
  readonly energy: unknown;
  readonly note: unknown;
  readonly sensations: unknown;
}): ExportCheckinItem {
  return {
    checkedInAt: isoOrEmpty(row.checked_in_at),
    feelingCore: String(row.feeling_core ?? ""),
    feelingSecondary: nullableString(row.feeling_secondary),
    intensity: nullableNumber(row.intensity),
    energy: nullableNumber(row.energy),
    note: nullableString(row.note),
    sensations: toStringArray(row.sensations)
  };
}

function toMedicationItem(row: {
  readonly name: unknown;
  readonly dosage: unknown;
  readonly frequency_type: unknown;
  readonly schedule_times: unknown;
  readonly active: unknown;
  readonly notes: unknown;
}): ExportMedicationItem {
  return {
    name: String(row.name ?? ""),
    dosage: nullableString(row.dosage),
    frequencyType: String(row.frequency_type ?? ""),
    scheduleTimes: row.schedule_times == null ? null : toStringArray(row.schedule_times),
    active: Boolean(row.active),
    notes: nullableString(row.notes)
  };
}

function toMedicationLogItem(
  row: {
    readonly status: unknown;
    readonly dose: unknown;
    readonly prn_reason: unknown;
    readonly scheduled_for: unknown;
    readonly logged_at: unknown;
  },
  medicationName: string
): ExportMedicationLogItem {
  return {
    medicationName,
    status: String(row.status ?? ""),
    dose: nullableString(row.dose),
    prnReason: nullableString(row.prn_reason),
    scheduledFor: isoOrEmpty(row.scheduled_for),
    loggedAt: isoOrEmpty(row.logged_at)
  };
}

function toTherapyNoteItem(row: {
  readonly created_at: unknown;
  readonly body: unknown;
  readonly linked_emotion: unknown;
}): ExportTherapyNoteItem {
  return {
    createdAt: isoOrEmpty(row.created_at),
    body: String(row.body ?? ""),
    linkedEmotion: nullableString(row.linked_emotion)
  };
}

function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" ? null : s;
}
function nullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function toStringArray(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}
function isoOrEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function resolveOwnerName(nameFromDb: string | null | undefined, actorUserId: string): string {
  const trimmed = nameFromDb?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : actorUserId;
}

// ── Worker handler ──────────────────────────────────────────────────────────

export async function handleWellnessExportJob(
  job: Job<WellnessExportJobPayload>,
  scopedDb: DataContextDb
): Promise<void> {
  const { actorUserId, jobId } = job.data;
  const exportRepo = new DataExportRepository();
  const wellnessRepo = new WellnessRepository();

  await exportRepo.updateJobStatus(scopedDb, jobId, "building");

  // Re-read the window + categories from the ROW (not the payload) — defense-in-depth.
  const jobRow = await exportRepo.getJobById(scopedDb, jobId);
  if (!jobRow) {
    throw new Error(`Wellness export job ${jobId} not found`);
  }
  const params = (jobRow.params ?? {}) as Partial<WellnessExportParams>;
  const fromStr = typeof params.from === "string" ? params.from : "";
  const toStr = typeof params.to === "string" ? params.to : "";
  if (!fromStr || !toStr) {
    throw new Error(`Wellness export job ${jobId} missing from/to params`);
  }
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);
  const categories = Array.isArray(params.categories)
    ? params.categories.filter((c): c is string => typeof c === "string")
    : [];

  // ── Load owner-scoped data bounded to the window ──
  const wantsCheckins = categories.includes("checkins");
  const wantsMeds = categories.includes("medications");
  const wantsTherapyNotes = categories.includes("therapyNotes");
  const wantsInsights = categories.includes("insights");

  const [checkins, meds, logs, therapyNotes, ownerNameRow] = await Promise.all([
    wantsCheckins ? wellnessRepo.listCheckinsForRange(scopedDb, from, to) : Promise.resolve([]),
    wantsMeds ? wellnessRepo.listMedications(scopedDb) : Promise.resolve([]),
    wantsMeds ? wellnessRepo.listLogsForRange(scopedDb, from, to) : Promise.resolve([]),
    wantsTherapyNotes
      ? wellnessRepo.listTherapyNotesForRange(scopedDb, from, to)
      : Promise.resolve([]),
    scopedDb.db
      .selectFrom("app.users")
      .select("name")
      .where("id", "=", actorUserId)
      .executeTakeFirst()
  ]);

  // Insights recompute over the window data (same fn the /insights route uses).
  let insights: readonly WellnessInsightDto[] = [];
  if (wantsInsights) {
    const windowCheckins = wantsCheckins
      ? checkins
      : await wellnessRepo.listCheckinsForRange(scopedDb, from, to);
    const windowLogs = wantsMeds ? logs : await wellnessRepo.listLogsForRange(scopedDb, from, to);
    const windowMeds = wantsMeds ? meds : await wellnessRepo.listMedications(scopedDb);
    insights = computeInsights(windowCheckins, windowLogs, windowMeds, new Date());
  }

  // Map logs to render items (each log needs its medication name).
  const medNameById = new Map(meds.map((m) => [String(m.id), String(m.name)]));
  const logItems = logs.map((l) =>
    toMedicationLogItem(l, medNameById.get(String(l.medication_id)) ?? "Unknown medication")
  );

  const doc: WellnessExportDocument = {
    ownerName: resolveOwnerName(ownerNameRow?.name ?? null, actorUserId),
    from: fromStr,
    to: toStr,
    generatedAt: new Date().toISOString(),
    categories: {
      ...(wantsCheckins ? { checkins: checkins.map(toCheckinItem) } : {}),
      ...(wantsMeds
        ? { medications: { medications: meds.map(toMedicationItem), logs: logItems } }
        : {}),
      ...(wantsTherapyNotes ? { therapyNotes: therapyNotes.map(toTherapyNoteItem) } : {}),
      ...(wantsInsights ? { insights } : {})
    }
  };

  const html = renderWellnessExportHtml(doc);

  const vaultRunner = new VaultContextRunner(getVaultBaseDir());
  const accessContext = { actorUserId, requestId: `wellness-export:${jobId}` };
  await vaultRunner.withVaultContext(accessContext, async (vaultCtx) => {
    await writeVaultFile(vaultCtx, `exports/${jobId}.html`, html);
  });

  const completedAt = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await exportRepo.completeJob(scopedDb, jobId, completedAt, expiresAt);

  // Metadata-only audit (no health content).
  await recordAuditEvent(scopedDb, {
    actorUserId,
    action: "wellness.export.generate",
    targetType: "user",
    targetId: actorUserId,
    metadata: { jobId, from: fromStr, to: toStr, categories },
    requestId: accessContext.requestId
  });
}

export async function registerWellnessExportWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner
): Promise<readonly string[]> {
  const workId = await registerDataContextWorker<WellnessExportJobPayload, void>(
    boss,
    WELLNESS_EXPORT_QUEUE,
    dataContext,
    (job, scopedDb) => handleWellnessExportJob(job, scopedDb)
  );
  return [workId];
}
