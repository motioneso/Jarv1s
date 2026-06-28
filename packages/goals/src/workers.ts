import { sql } from "kysely";
import type { DataContextRunner, DataContextDb } from "@jarv1s/db";
import { registerDataContextWorker, sendJob, type PgBoss } from "@jarv1s/jobs";
import type { MemoryGraphRepository } from "@jarv1s/memory";

import type { GoalsRepository } from "./repository.js";
import { GOALS_MEMORY_SYNC_QUEUE, GOALS_MEMORY_SYNC_RECONCILE_QUEUE } from "./manifest.js";
import type { GoalMemorySyncPayload, GoalMemorySyncReconcilePayload } from "./jobs.js";
import type { JarvisGoal, JarvisGoalEvidence } from "./types.js";

export function registerGoalsMemorySyncWorker(
  boss: PgBoss,
  dataContext: DataContextRunner,
  repository: GoalsRepository,
  memoryGraphRepo: MemoryGraphRepository
): Promise<string> {
  return registerDataContextWorker<GoalMemorySyncPayload, void>(
    boss,
    GOALS_MEMORY_SYNC_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const { actorUserId, goalId, goalUpdatedAt } = job.data;

      const locked = await repository.acquireSyncLock(scopedDb, goalId);
      if (!locked) {
        throw new Error(`Failed to acquire sync lock for goal ${goalId}`);
      }

      const goal = await repository.getById(scopedDb, goalId);
      if (!goal) {
        // Goal was deleted or doesn't exist
        await markMemoryAsForgotten(scopedDb, actorUserId, goalId);
        return;
      }

      // If it's archived, we might also suppress it from memory
      if (goal.status === "archived") {
        await markMemoryAsForgotten(scopedDb, actorUserId, goalId);
        return;
      }

      try {
        const evidence = await repository.listEvidence(scopedDb, goalId);
        const briefing = formatGoalBriefing(goal, evidence);

        const existingEntityId = await getAliasEntityId(scopedDb, actorUserId, goalId);
        if (existingEntityId) {
          // Update existing memory
          await sql`
            UPDATE app.memory_entities
            SET name = ${goal.title}, summary = ${briefing}, updated_at = now()
            WHERE id = ${existingEntityId}::uuid
          `.execute(scopedDb.db);

          await memoryGraphRepo.upsertSearchDocument(
            scopedDb,
            actorUserId,
            "entity",
            existingEntityId,
            `${goal.title} ${briefing}`.trim()
          );
        } else {
          // Create new memory item
          const entity = await memoryGraphRepo.createEntity(scopedDb, actorUserId, {
            kind: "goal",
            name: goal.title,
            summary: briefing,
            importance: goal.priority / 5,
            pinned: goal.status === "active"
          });

          await memoryGraphRepo.addAlias(
            scopedDb,
            actorUserId,
            entity.id,
            `jarvis_goal:${goalId}`,
            false
          );
        }

        await repository.updateSyncStatus(
          scopedDb,
          goalId,
          new Date(), // memory_synced_at
          new Date(goalUpdatedAt) // memory_synced_goal_updated_at
        );
      } catch (error) {
        // Final or transient failure, we mark the error.
        await repository.markSyncError(
          scopedDb,
          goalId,
          error instanceof Error ? error.name : "UnknownError"
        );
        throw error;
      }
    }
  );
}

export function registerGoalsMemorySyncReconcileWorker(
  boss: PgBoss,
  dataContext: DataContextRunner,
  repository: GoalsRepository
): Promise<string> {
  return registerDataContextWorker<GoalMemorySyncReconcilePayload, void>(
    boss,
    GOALS_MEMORY_SYNC_RECONCILE_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const { actorUserId } = job.data;

      const goals = await repository.listForReconcile(scopedDb);
      for (const goal of goals) {
        await sendJob(boss, GOALS_MEMORY_SYNC_QUEUE, {
          actorUserId,
          goalId: goal.id,
          goalUpdatedAt: goal.updated_at,
          reason: "reconcile",
          idempotencyKey: `sync:${goal.id}:${goal.updated_at}`
        });
      }
    }
  );
}

function formatGoalBriefing(goal: JarvisGoal, evidence: JarvisGoalEvidence[]): string {
  const parts: string[] = [];

  parts.push(`Desired Outcome: ${goal.desiredOutcome}`);
  parts.push(`Status: ${goal.status}`);
  parts.push(`Priority: ${goal.priority}`);

  if (goal.targetAt) {
    parts.push(`Target: ${goal.targetAt}`);
  }

  if (goal.lastProgressSummary) {
    parts.push(`Progress: ${goal.lastProgressSummary}`);
  }

  if (goal.blockerSummary) {
    parts.push(`Blockers: ${goal.blockerSummary}`);
  }

  if (goal.nextSuggestedAction) {
    parts.push(`Next Action: ${goal.nextSuggestedAction}`);
  }

  if (evidence.length > 0) {
    parts.push(`\nRecent Evidence:`);
    for (const item of evidence.slice(0, 10)) {
      parts.push(`- [${item.evidenceKind}] ${item.summary} (from ${item.sourceLabel})`);
    }
  }

  return parts.join("\n");
}

async function getAliasEntityId(
  scopedDb: DataContextDb,
  ownerUserId: string,
  goalId: string
): Promise<string | null> {
  const alias = `jarvis_goal:${goalId}`;
  const result = await sql<{ entity_id: string }>`
    SELECT entity_id 
    FROM app.memory_aliases 
    WHERE owner_user_id = ${ownerUserId}::uuid AND alias = ${alias}
  `.execute(scopedDb.db);
  return result.rows[0]?.entity_id ?? null;
}

async function markMemoryAsForgotten(
  scopedDb: DataContextDb,
  ownerUserId: string,
  goalId: string
): Promise<void> {
  const entityId = await getAliasEntityId(scopedDb, ownerUserId, goalId);
  if (entityId) {
    await sql`
      UPDATE app.memory_entities
      SET status = 'forgotten'
      WHERE id = ${entityId}::uuid
    `.execute(scopedDb.db);
  }
}
