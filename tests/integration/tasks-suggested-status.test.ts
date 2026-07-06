import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { TasksRepository } from "@jarv1s/tasks";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { Kysely } from "kysely";

describe("Tasks — suggested status (migration 0140, spec #729 §5)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const repository = new TasksRepository();

  const ctx = { actorUserId: ids.userA, requestId: "req:suggested-status" };

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  it("persists a suggested email-derived task without completed_at", async () => {
    const task = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Reply to vendor about invoice",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-suggested-1"
      })
    );

    expect(task.status).toBe("suggested");
    expect(task.completed_at).toBeNull();
    expect(task.source).toBe("email");
    expect(task.external_key).toBe("email:conn-1:msg-suggested-1");
  });

  it("returns the existing task when the same (source, externalKey) is created again", async () => {
    const first = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Original suggested task",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-dedupe-1"
      })
    );
    const second = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Duplicate suggested task",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-dedupe-1"
      })
    );

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Original suggested task");
  });

  it("enforces (owner, source, external_key) uniqueness at the database level", async () => {
    const first = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Index-guarded task",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-index-1"
      })
    );

    // The repository's check-then-insert dedupe has a race window; the partial unique
    // index is the real backstop. Bypass the check by cloning the row directly.
    await expect(
      dataContext.withDataContext(ctx, (scopedDb) =>
        sql`
          INSERT INTO app.tasks
            (id, owner_user_id, list_id, title, status, position, source, external_key, created_at, updated_at)
          SELECT gen_random_uuid(), owner_user_id, list_id, 'Racing duplicate', status, 0,
                 source, external_key, now(), now()
          FROM app.tasks WHERE id = ${first.id}
        `.execute(scopedDb.db)
      )
    ).rejects.toThrow(/tasks_source_external_key_idx|duplicate key/);
  });

  it("scopes external_key uniqueness per owner: another user can hold the same key", async () => {
    const KEY = "email:conn-1:msg-cross-user-1";
    const taskA = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "User A suggestion",
        status: "suggested",
        source: "email",
        externalKey: KEY
      })
    );
    const taskB = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:suggested-status-b" },
      (scopedDb) =>
        repository.create(scopedDb, {
          title: "User B suggestion",
          status: "suggested",
          source: "email",
          externalKey: KEY
        })
    );

    expect(taskB.id).not.toBe(taskA.id);
    expect(taskB.owner_user_id).toBe(ids.userB);
    expect(taskB.title).toBe("User B suggestion");
  });

  it("promotes suggested → todo without setting completed_at", async () => {
    const task = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Accept me",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-accept-1"
      })
    );
    const updated = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.update(scopedDb, task.id, { status: "todo" })
    );

    expect(updated?.status).toBe("todo");
    expect(updated?.completed_at).toBeNull();
  });

  it("leaves suggested children unreviewed when a parent closes", async () => {
    const { parent, suggestedChild, todoChild } = await dataContext.withDataContext(
      ctx,
      async (scopedDb) => {
        const parentTask = await repository.create(scopedDb, { title: "Parent task" });
        return {
          parent: parentTask,
          suggestedChild: await repository.create(scopedDb, {
            title: "Suggested child",
            status: "suggested",
            source: "email",
            externalKey: "email:conn-1:msg-child-1",
            parentTaskId: parentTask.id
          }),
          todoChild: await repository.create(scopedDb, {
            title: "Open child",
            parentTaskId: parentTask.id
          })
        };
      }
    );

    await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.update(scopedDb, parent.id, { status: "done" })
    );

    const [suggestedAfter, todoAfter] = await dataContext.withDataContext(ctx, (scopedDb) =>
      Promise.all([
        repository.getById(scopedDb, suggestedChild.id),
        repository.getById(scopedDb, todoChild.id)
      ])
    );

    // The cascade closes accepted open work, but a suggestion nobody reviewed must not
    // silently become "done" (spec #729 §5).
    expect(suggestedAfter?.status).toBe("suggested");
    expect(suggestedAfter?.completed_at).toBeNull();
    expect(todoAfter?.status).toBe("done");
  });
});
