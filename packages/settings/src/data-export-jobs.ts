import type { Job } from "@jarv1s/jobs";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  type ActorScopedJobPayload,
  type PgBoss,
  type QueueDefinition,
  registerDataContextWorker,
  sendJob
} from "@jarv1s/jobs";
import { VaultContextRunner, getVaultBaseDir, writeVaultFile } from "@jarv1s/vault";
import { createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";

import { exportUserData } from "./data-export.js";
import { DataExportRepository } from "./data-export-repository.js";

export const EXPORT_BUILD_QUEUE = "export.build";

export interface ExportBuildJobPayload extends ActorScopedJobPayload {
  readonly kind: "export.build";
  readonly jobId: string;
}

export const EXPORT_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: EXPORT_BUILD_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 300,
      retentionSeconds: 300
    }
  }
];

export async function enqueueExportBuildJob(
  boss: PgBoss,
  actorUserId: string,
  jobId: string
): Promise<void> {
  await sendJob<ExportBuildJobPayload>(boss, EXPORT_BUILD_QUEUE, {
    kind: "export.build",
    jobId,
    actorUserId
  });
}

export async function handleExportBuildJob(
  job: Job<ExportBuildJobPayload>,
  scopedDb: DataContextDb
): Promise<void> {
  const { actorUserId, jobId } = job.data;
  const repository = new DataExportRepository();

  const authDb = createDatabase({
    connectionString: getJarvisDatabaseUrls().auth,
    maxConnections: 1
  });

  try {
    await repository.updateJobStatus(scopedDb, jobId, "building");

    const userExport = await exportUserData({
      scopedDb,
      authDb,
      userId: actorUserId
    });

    const archive = {
      format: "jarvis-archive/v1",
      exportedAt: userExport.exportedAt,
      userId: userExport.userId,
      sections: {
        profile: {
          user: userExport.tables.users[0] ?? null,
          authAccounts: userExport.tables.authAccounts,
          authSessions: userExport.tables.betterAuthSessions
        },
        preferences: userExport.tables.preferences,
        tasks: userExport.tables.tasks,
        memory: {
          chunks: userExport.tables.memoryChunks,
          facts: userExport.tables.chatMemoryFacts
        },
        structured_state: {
          commitments: userExport.tables.commitments,
          entities: userExport.tables.entities,
          medications: userExport.tables.medications,
          medication_logs: userExport.tables.medicationLogs
        },
        wellness: {
          checkins: userExport.tables.wellnessCheckins,
          therapy_notes: userExport.tables.wellnessTherapyNotes
        },
        connector_metadata: userExport.tables.connectorAccounts,
        calendar_cache: userExport.tables.calendarEvents,
        email_cache: userExport.tables.emailMessages,
        ai_metadata: {
          providers: userExport.tables.aiProviderConfigs,
          models: userExport.tables.aiConfiguredModels,
          assistantActionRequests: userExport.tables.aiAssistantActionRequests
        },
        chat: {
          threads: userExport.tables.chatThreads,
          messages: userExport.tables.chatMessages
        },
        briefings: {
          definitions: userExport.tables.briefingDefinitions,
          runs: userExport.tables.briefingRuns
        },
        vault_files: []
      }
    };

    const vaultRunner = new VaultContextRunner(getVaultBaseDir());
    const accessContext = { actorUserId, requestId: `export:${jobId}` };
    await vaultRunner.withVaultContext(accessContext, async (vaultCtx) => {
      await writeVaultFile(vaultCtx, `exports/${jobId}.json`, JSON.stringify(archive, null, 2));
    });

    const completedAt = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await repository.completeJob(scopedDb, jobId, completedAt, expiresAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await repository.failJob(scopedDb, jobId, message.slice(0, 500));
  } finally {
    await authDb.destroy();
  }
}

export async function registerSettingsJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner
): Promise<readonly string[]> {
  const workId = await registerDataContextWorker<ExportBuildJobPayload, void>(
    boss,
    EXPORT_BUILD_QUEUE,
    dataContext,
    (job, scopedDb) => handleExportBuildJob(job, scopedDb)
  );
  return [workId];
}
