import type { PgBoss, WorkOptions } from "pg-boss";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import { registerDataContextWorker } from "@jarv1s/jobs";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { ConnectorsRepository, type TriageRejectionAggregate } from "./repository.js";
import {
  EMAIL_TASK_MODE_PREF_KEY,
  parseEmailTaskMode,
  planEmailTasks,
  type EmailTaskCreationPort
} from "./source-context/email-tasks.js";
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
  readonly connectorsRepository: {
    listTriageRejectionAggregates(scopedDb: DataContextDb): Promise<TriageRejectionAggregate[]>;
  };
  readonly taskPort: EmailTaskCreationPort;
  readonly preferencesRepository: MonitorPreferencesPort;
  readonly now?: () => Date;
  readonly logger?: SyncLogger;
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
  const degraded = accountResult
    ? accountResult.source === "cache" || accountResult.degradedReason !== null
    : false;

  const items = result.items.filter(
    (item) => item.account.connectorAccountId === connectorAccountId
  );
  const rejectionAggregates =
    mode === "off" ? [] : await deps.connectorsRepository.listTriageRejectionAggregates(scopedDb);
  const planned = planEmailTasks({ items, mode, rejectionAggregates, now: nowIso });

  let created = 0;
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
        externalKey: task.externalKey
      });
      created += 1;
    } catch (error) {
      // Sanitized: never the task title or error message (may echo subject lines).
      logger.warn(
        { stage: "task-create", name: (error as Error).name },
        "email-monitor task create failed"
      );
    }
  }

  await persistMonitorStatus(
    scopedDb,
    deps.preferencesRepository,
    connectorAccountId,
    degraded ? "degraded" : "ok",
    nowIso,
    { planned: planned.length, created }
  );
  return { planned: planned.length, created, degraded };
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
  readonly workOptions?: WorkOptions;
  readonly logger?: SyncLogger;
}

export async function registerSourceMonitorWorkers(
  boss: PgBoss,
  deps: RegisterSourceMonitorWorkersDeps
): Promise<string[]> {
  const connectorsRepository = new ConnectorsRepository();
  const preferencesRepository = new PreferencesRepository();
  const sourceContext = buildRuntimeSourceContextService({ logger: deps.logger });

  const emailWorkId = await registerDataContextWorker<MonitorPayload, MonitorRunResult>(
    boss,
    EMAIL_MONITOR_QUEUE,
    deps.dataContext,
    (job, scopedDb) =>
      runEmailMonitor(scopedDb, job.data.connectorAccountId, {
        sourceContext,
        connectorsRepository,
        taskPort: deps.taskPort,
        preferencesRepository,
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
