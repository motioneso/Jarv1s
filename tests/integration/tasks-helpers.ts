import pg from "pg";
import type { PgBoss } from "pg-boss";

import { DataContextRunner, createDatabase, type AccessContext } from "@jarv1s/db";
import {
  TASKS_DEFERRED_STATUS_QUEUE,
  type DeferredTaskStatusResult,
  registerTasksJobWorkers
} from "@jarv1s/tasks";

import { connectionStrings, ids } from "./test-database.js";

const { Client } = pg;

export const taskIds = {
  aPrivate: "30000000-0000-4000-8000-000000000001",
  bPrivate: "30000000-0000-4000-8000-000000000002"
} as const;

export async function seedTaskData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    // Ensure each user has a Personal list (the migration seeds these for existing users,
    // but in tests the schema is rebuilt before users are inserted, so we seed them here).
    await client.query(
      `
        INSERT INTO app.task_lists (owner_user_id, name)
        VALUES ($1, 'Personal'), ($2, 'Personal')
        ON CONFLICT DO NOTHING
      `,
      [ids.userA, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.tasks (id, owner_user_id, title, description, status, list_id)
        VALUES
          ($1, $2, 'User A seeded private task', 'A private description', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $2 AND name = 'Personal' LIMIT 1)),
          ($3, $4, 'User B seeded private task', 'B private description', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $4 AND name = 'Personal' LIMIT 1))
      `,
      [taskIds.aPrivate, ids.userA, taskIds.bPrivate, ids.userB]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export async function handleNextTaskJob(workerBoss: PgBoss): Promise<DeferredTaskStatusResult> {
  const scopedWorkerDb = createDatabase({
    connectionString: connectionStrings.worker,
    maxConnections: 1
  });
  const dataContext = new DataContextRunner(scopedWorkerDb);
  let workIds: string[] = [];

  try {
    const resultPromise = new Promise<DeferredTaskStatusResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for Tasks worker"));
      }, 10_000);

      registerTasksJobWorkers(workerBoss, dataContext, {
        workOptions: { pollingIntervalSeconds: 0.5 },
        onResult: (_job, result) => {
          clearTimeout(timeout);
          resolve(result);
        }
      })
        .then((registeredWorkIds) => {
          workIds = registeredWorkIds;
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });

    return await resultPromise;
  } finally {
    await Promise.all(
      workIds.map((workId) =>
        workerBoss.offWork(TASKS_DEFERRED_STATUS_QUEUE, { id: workId, wait: true })
      )
    );
    await scopedWorkerDb.destroy();
  }
}

export function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-tasks"
  };
}

export function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-tasks"
  };
}
