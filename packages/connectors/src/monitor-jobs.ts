import type { PgBoss, WorkOptions } from "pg-boss";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import { registerDataContextWorker } from "@jarv1s/jobs";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { localDay } from "@jarv1s/shared";

import { EmailActionSuppressionRepository } from "./action-suppression-repository.js";
import {
  createEmailActionSubjectSignature,
  emailActionResurfaceKey,
  type EmailActionSuppressionState
} from "./source-context/email-tasks.js";
import type { ActionRowRelevancePort } from "./action-row-relevance.js";
import {
  EMAIL_TASK_MODE_PREF_KEY,
  parseEmailTaskMode,
  planEmailTasks,
  type EmailTaskCreationPort
} from "./source-context/email-tasks.js";
import type { EmailContextItem } from "./source-context/types.js";
import { buildRuntimeSourceContextService } from "./source-context/runtime.js";
import type { SourceContextService } from "./source-context/types.js";
import type { SyncLogger } from "./sync-jobs.js";

export const EMAIL_MONITOR_QUEUE = "connectors.email-monitor";
export const CALENDAR_MONITOR_QUEUE = "connectors.calendar-monitor";

export const MONITOR_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: EMAIL_MONITOR_QUEUE,
    options: {
      // exclusive + keyed by connectorAccountId at schedule time — one in-flight monitor run
      // per account, mirroring IMAP_SYNC_QUEUE_DEFINITIONS.
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  },
  {
    name: CALENDAR_MONITOR_QUEUE,
    options: {
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface MonitorPayload extends ActorScopedJobPayload {
  readonly kind: "email-monitor" | "calendar-monitor";
  readonly connectorAccountId: string;
}

/**
 * Bounded per-account monitor health record persisted in preferences: timestamps, a status
 * word, and counts only. Message content, task titles, and error details never land here.
 */
export const MONITOR_STATUS_PREF_KEY = (accountId: string): string =>
  `connector.${accountId}.monitor_status`;

export type MonitorRunStatus = "ok" | "degraded" | "gap";

export interface MonitorRunResult {
  readonly planned: number;
  readonly created: number;
  readonly degraded: boolean;
}

/** Structural subset of PreferencesPort so monitor fakes stay two methods. */
export interface MonitorPreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
}

const NOOP_LOGGER: SyncLogger = { warn: () => undefined, info: () => undefined };

async function persistMonitorStatus(
  scopedDb: DataContextDb,
  preferences: MonitorPreferencesPort,
  connectorAccountId: string,
  status: MonitorRunStatus,
  nowIso: string,
  counts: { planned: number; created: number }
): Promise<void> {
  await preferences.upsert(scopedDb, MONITOR_STATUS_PREF_KEY(connectorAccountId), {
    lastRunAt: nowIso,
    status,
    planned: counts.planned,
    created: counts.created
  });
}

export interface RunEmailMonitorDeps {
  readonly sourceContext: Pick<SourceContextService, "listEmailContext">;
  readonly taskPort: EmailTaskCreationPort;
  readonly preferencesRepository: MonitorPreferencesPort;
  readonly suppressionRepository?: Pick<
    EmailActionSuppressionRepository,
    "list" | "recordContextEvidence" | "recordDeadlineEvidence"
  >;
  readonly actionRowRelevance?: ActionRowRelevancePort;
  readonly actorUserId?: string;
  readonly now?: () => Date;
  readonly logger?: SyncLogger;
}

function subjectSignatureFor(item: EmailContextItem): string | undefined {
  const subject = item.inferredSubject?.trim();
  return subject ? createEmailActionSubjectSignature(subject) : undefined;
}

function localTomorrow(now: string, timeZone: string): string | null {
  const today = localDay(new Date(now), timeZone);
  const [year, month, day] = today.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function parseMonitorTimeZone(value: unknown): string {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).timezone
      : undefined;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return "America/Los_Angeles";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "America/Los_Angeles";
  }
}

function hasDueTomorrow(item: EmailContextItem, now: string, timeZone: string): string | null {
  const tomorrow = localTomorrow(now, timeZone);
  if (tomorrow === null) return null;
  const dueDates = [
    ...item.suggestedTasks.map((candidate) => candidate.dueDate),
    item.dueDate
  ].filter((value): value is string => value !== null);
  const dueAt = dueDates.find((value) => localDay(new Date(value), timeZone) === tomorrow);
  return dueAt ? `deadline:${dueAt}` : null;
}

/**
 * One proactive email monitor pass for a single account (#729 §5): live-first read → triage →
 * deterministic task planning → idempotent creation (tasks.create dedupes on
 * (source, external_key), so a 15-minute cadence can never duplicate a task).
 *
 * An account gap (auth/revoked/grant) plans nothing — a broken account must surface as a gap
 * the user fixes, not as tasks derived from stale context. A degraded (cache-fallback) read
 * still plans: the items passed triage and dedupe holds; only the status word changes.
 */
export async function runEmailMonitor(
  scopedDb: DataContextDb,
  connectorAccountId: string,
  deps: RunEmailMonitorDeps
): Promise<MonitorRunResult> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_LOGGER;
  const nowIso = now().toISOString();

  const result = await deps.sourceContext.listEmailContext(scopedDb, {});
  const gap = result.gaps.find((g) => g.account?.connectorAccountId === connectorAccountId);
  if (gap) {
    await persistMonitorStatus(
      scopedDb,
      deps.preferencesRepository,
      connectorAccountId,
      "gap",
      nowIso,
      {
        planned: 0,
        created: 0
      }
    );
    return { planned: 0, created: 0, degraded: true };
  }

  const mode = parseEmailTaskMode(
    await deps.preferencesRepository.get(scopedDb, EMAIL_TASK_MODE_PREF_KEY)
  );
  const accountResult = result.accounts.find(
    (a) => a.account.connectorAccountId === connectorAccountId
  );
  const sourceDegraded = accountResult
    ? accountResult.source === "cache" || accountResult.degradedReason !== null
    : false;

  const items = result.items.filter(
    (item) => item.account.connectorAccountId === connectorAccountId
  );
  const actionItems = items.filter(
    (item) => item.cacheMessageId !== null && item.inferredSubject?.trim().length
  );
  const subjectSignatures = [
    ...new Set(
      actionItems.map(subjectSignatureFor).filter((value): value is string => value !== undefined)
    )
  ];
  let suppressionReadFailed = false;
  let suppressionStates: EmailActionSuppressionState[] = [];
  if (deps.suppressionRepository) {
    try {
      suppressionStates = await deps.suppressionRepository.list(scopedDb, subjectSignatures);
    } catch (error) {
      suppressionReadFailed = true;
      logger.warn(
        { stage: "suppression-read", name: error instanceof Error ? error.name : "UnknownError" },
        "email monitor suppression read failed"
      );
    }
  }
  const suppressionBySignature = new Map(
    suppressionStates.map((state) => [state.subjectSignature, state])
  );
  const resurfaceReasons = new Map<string, "due_tomorrow" | "relevant_context">();
  const actorTimeZone = parseMonitorTimeZone(
    await deps.preferencesRepository.get(scopedDb, "locale")
  );

  for (const item of suppressionReadFailed ? [] : actionItems) {
    const signature = subjectSignatureFor(item);
    const state = signature ? suppressionBySignature.get(signature) : undefined;
    if (!signature || !state || state.dismissalCount < 2) continue;

    const deadlineKey = hasDueTomorrow(item, nowIso, actorTimeZone);
    if (deadlineKey !== null && deadlineKey !== state.lastDeadlineEvidenceKey) {
      resurfaceReasons.set(emailActionResurfaceKey(signature, item.messageKey), "due_tomorrow");
      continue;
    }

    const contextKey = `${item.account.connectorAccountId}:${item.messageKey}`;
    if (item.source !== "live" || contextKey === state.lastContextMessageKey) continue;
    let relevant = false;
    try {
      relevant =
        deps.actionRowRelevance !== undefined && deps.actorUserId !== undefined
          ? await deps.actionRowRelevance.hasRelevantContext(scopedDb, {
              ownerUserId: deps.actorUserId,
              inferredSubject: item.inferredSubject ?? ""
            })
          : false;
    } catch (error) {
      logger.warn(
        { stage: "action-row-relevance", name: (error as Error).name },
        "email monitor relevance check failed"
      );
    }
    if (deps.suppressionRepository) {
      await deps.suppressionRepository.recordContextEvidence(scopedDb, signature, contextKey);
    }
    if (relevant) {
      resurfaceReasons.set(emailActionResurfaceKey(signature, item.messageKey), "relevant_context");
    }
  }

  const planned = planEmailTasks({
    items: suppressionReadFailed ? [] : actionItems,
    mode,
    suppressionStates,
    resurfaceReasons,
    now: nowIso
  });

  let created = 0;
  const deadlineEvidenceToRecord = new Map<string, string>();
  for (const task of planned) {
    try {
      await deps.taskPort.create(scopedDb, {
        title: task.title,
        description: task.description,
        status: task.status,
        dueAt: task.dueAt,
        priority: task.priority,
        source: "email",
        sourceRef: task.sourceRef,
        externalKey: task.externalKey,
        suggestionMetadata: task.suggestionMetadata
      });
      created += 1;
      if (task.suggestionMetadata.resurfaceReason === "due_tomorrow") {
        deadlineEvidenceToRecord.set(task.suggestionMetadata.subjectSignature, task.dueAt ?? "");
      }
    } catch (error) {
      // Sanitized: never the task title or error message (may echo subject lines).
      logger.warn(
        { stage: "task-create", name: (error as Error).name },
        "email-monitor task create failed"
      );
    }
  }

  if (deps.suppressionRepository) {
    for (const [signature, dueAt] of deadlineEvidenceToRecord) {
      await deps.suppressionRepository.recordDeadlineEvidence(
        scopedDb,
        signature,
        `deadline:${dueAt}`
      );
    }
  }

  await persistMonitorStatus(
    scopedDb,
    deps.preferencesRepository,
    connectorAccountId,
    sourceDegraded || suppressionReadFailed ? "degraded" : "ok",
    nowIso,
    { planned: planned.length, created }
  );
  return {
    planned: planned.length,
    created,
    degraded: sourceDegraded || suppressionReadFailed
  };
}

export interface RunCalendarMonitorDeps {
  readonly sourceContext: Pick<SourceContextService, "listCalendarContext">;
  readonly preferencesRepository: MonitorPreferencesPort;
  readonly now?: () => Date;
}

/**
 * Calendar monitor v1 is a health signal only: run the live-first read and persist the same
 * bounded status record. No calendar-derived tasks in this spec.
 */
export async function runCalendarMonitor(
  scopedDb: DataContextDb,
  connectorAccountId: string,
  deps: RunCalendarMonitorDeps
): Promise<MonitorRunResult> {
  const now = deps.now ?? (() => new Date());
  const nowIso = now().toISOString();

  const result = await deps.sourceContext.listCalendarContext(scopedDb, {});
  const gap = result.gaps.find((g) => g.account?.connectorAccountId === connectorAccountId);
  const accountResult = result.accounts.find(
    (a) => a.account.connectorAccountId === connectorAccountId
  );
  const degraded = gap
    ? true
    : accountResult
      ? accountResult.source === "cache" || accountResult.degradedReason !== null
      : false;

  await persistMonitorStatus(
    scopedDb,
    deps.preferencesRepository,
    connectorAccountId,
    gap ? "gap" : degraded ? "degraded" : "ok",
    nowIso,
    { planned: 0, created: 0 }
  );
  return { planned: 0, created: 0, degraded };
}

export interface RegisterSourceMonitorWorkersDeps {
  readonly dataContext: DataContextRunner;
  /** Structural task-creation port — connectors never imports the tasks module. */
  readonly taskPort: EmailTaskCreationPort;
  readonly actionRowRelevance?: ActionRowRelevancePort;
  readonly workOptions?: WorkOptions;
  readonly logger?: SyncLogger;
}

export async function registerSourceMonitorWorkers(
  boss: PgBoss,
  deps: RegisterSourceMonitorWorkersDeps
): Promise<string[]> {
  const suppressionRepository = new EmailActionSuppressionRepository();
  const preferencesRepository = new PreferencesRepository();
  const sourceContext = buildRuntimeSourceContextService({ logger: deps.logger });

  const emailWorkId = await registerDataContextWorker<MonitorPayload, MonitorRunResult>(
    boss,
    EMAIL_MONITOR_QUEUE,
    deps.dataContext,
    (job, scopedDb) =>
      runEmailMonitor(scopedDb, job.data.connectorAccountId, {
        sourceContext,
        taskPort: deps.taskPort,
        preferencesRepository,
        suppressionRepository,
        actionRowRelevance: deps.actionRowRelevance,
        actorUserId: job.data.actorUserId,
        logger: deps.logger
      }),
    deps.workOptions
  );

  const calendarWorkId = await registerDataContextWorker<MonitorPayload, MonitorRunResult>(
    boss,
    CALENDAR_MONITOR_QUEUE,
    deps.dataContext,
    (job, scopedDb) =>
      runCalendarMonitor(scopedDb, job.data.connectorAccountId, {
        sourceContext,
        preferencesRepository
      }),
    deps.workOptions
  );

  return [emailWorkId, calendarWorkId];
}
