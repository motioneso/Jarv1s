import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import { TASKS_RECURRENCE_QUEUE, TaskListsRepository, TasksRepository } from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// Task 21: list/tag rename+delete HTTP routes + recurrence-schedule reconcile on create + list-load.
// Lives in its own file (and harness) so the already-large tasks.test.ts is not bloated further.
describe("Tasks module — rename/delete routes + recurrence reconcile", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: TasksRepository;
  let listsRepo: TaskListsRepository;
  let appBoss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    repository = new TasksRepository();
    listsRepo = new TaskListsRepository();
    appBoss = createPgBossClient(connectionStrings.app);
    await appBoss.start();

    server = createApiServer({ appDb, boss: appBoss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appBoss?.stop({ graceful: false }),
      appDb?.destroy()
    ]);
  });

  function userAContext(): AccessContext {
    return { actorUserId: ids.userA, requestId: "request:user-a-rename" };
  }

  it("PATCH /api/tasks/lists/:listId renames a list (200), duplicate → 409, foreign → 404", async () => {
    const src = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Rename Src")
    );
    const clash = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Rename Clash")
    );

    const ok = await server.inject({
      method: "PATCH",
      url: `/api/tasks/lists/${src.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "Route Rename Done" }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ list: { name: string } }>().list.name).toBe("Route Rename Done");

    const dup = await server.inject({
      method: "PATCH",
      url: `/api/tasks/lists/${src.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "Route Rename Clash" }
    });
    expect(dup.statusCode).toBe(409);
    expect(clash.id).not.toBe(src.id); // collision target referenced

    // A different actor cannot rename userA's list (RLS owner-only → 404).
    const foreign = await server.inject({
      method: "PATCH",
      url: `/api/tasks/lists/${src.id}`,
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { name: "Hijacked" }
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("DELETE /api/tasks/lists/:listId → 409 non-empty, 200 with reassign", async () => {
    const src = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Delete Src")
    );
    const dst = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Delete Dst")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-del-task", listId: src.id })
    );

    // Non-empty without reassign → 409.
    const conflict = await server.inject({
      method: "DELETE",
      url: `/api/tasks/lists/${src.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {}
    });
    expect(conflict.statusCode).toBe(409);

    // With reassign → 200 { deleted: true }, task moved.
    const ok = await server.inject({
      method: "DELETE",
      url: `/api/tasks/lists/${src.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { reassignToListId: dst.id }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ deleted: boolean }>().deleted).toBe(true);

    const moved = await dataContext.withDataContext(userAContext(), (db) =>
      db.db.selectFrom("app.tasks").select("list_id").where("id", "=", task.id).executeTakeFirst()
    );
    expect(moved?.list_id).toBe(dst.id);
  });

  it("PATCH /api/tasks/lists/:listId/tags/:tagId renames a tag (200), duplicate → 409", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Tag Rename List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-tag-src")
    );
    const clash = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-tag-clash")
    );

    const ok = await server.inject({
      method: "PATCH",
      url: `/api/tasks/lists/${list.id}/tags/${tag.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "route-tag-done" }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ tag: { name: string } }>().tag.name).toBe("route-tag-done");

    const dup = await server.inject({
      method: "PATCH",
      url: `/api/tasks/lists/${list.id}/tags/${tag.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "route-tag-clash" }
    });
    expect(dup.statusCode).toBe(409);
    expect(clash.id).not.toBe(tag.id); // collision target referenced
  });

  it("DELETE /api/tasks/lists/:listId/tags/:tagId → 200, assignments cascaded", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Tag Delete List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-tag-del")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-tag-del-task", listId: list.id })
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, task.id, tag.id)
    );

    const ok = await server.inject({
      method: "DELETE",
      url: `/api/tasks/lists/${list.id}/tags/${tag.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ deleted: boolean }>().deleted).toBe(true);

    // Assignment cascaded away (task_tag_assignments.tag_id ON DELETE CASCADE).
    const tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
    expect(tags).toHaveLength(0);
  });

  it("POST /api/tasks/:id/tags assigns a tag (200, task.tags reflects it); DELETE unassigns (200)", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Assign List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-assign-tag")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-assign-task", listId: list.id })
    );

    const assign = await server.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/tags`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { tagId: tag.id }
    });
    expect(assign.statusCode).toBe(200);
    const assignedTags = assign.json<{ task: { tags: { id: string }[] } }>().task.tags;
    expect(assignedTags.map((t) => t.id)).toContain(tag.id);

    const unassign = await server.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}/tags/${tag.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(unassign.statusCode).toBe(200);
    expect(unassign.json<{ task: { tags: { id: string }[] } }>().task.tags).toHaveLength(0);
  });

  it("POST /api/tasks/:id/tags by a non-owner is 404 (RLS owner-only assignment)", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route Assign Foreign List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-assign-foreign-tag")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-assign-foreign-task", listId: list.id })
    );

    const foreign = await server.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/tags`,
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { tagId: tag.id }
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("GET /api/tasks?tagId=… filters to tasks carrying that tag (RLS-scoped)", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Route TagFilter List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "route-tagfilter-tag")
    );
    const tagged = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-tagfilter-tagged", listId: list.id })
    );
    const untagged = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "route-tagfilter-untagged", listId: list.id })
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, tagged.id, tag.id)
    );

    const res = await server.inject({
      method: "GET",
      url: `/api/tasks?tagId=${tag.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    const returnedIds = res.json<{ tasks: { id: string }[] }>().tasks.map((t) => t.id);
    expect(returnedIds).toContain(tagged.id);
    expect(returnedIds).not.toContain(untagged.id);
  });

  it("POST /api/tasks with recurrence returns 201 and reconciles a daily schedule row for the actor", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        title: "reconcile-on-create",
        recurrence: { freq: "weekly", interval: 1, occurrence_date: "2026-06-08" }
      }
    });
    expect(res.statusCode).toBe(201);

    // Exactly one schedule row per actor (pgboss.schedule PRIMARY KEY (name, key=actorUserId)).
    const schedules = await appBoss.getSchedules(TASKS_RECURRENCE_QUEUE, ids.userA);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.cron).toBe("0 3 * * *");
  });

  it("GET /api/tasks/lists self-heals the schedule; repeated reconciles keep one row per actor", async () => {
    // Fire the lists load twice; the per-session self-heal upserts the same (name,key) row.
    for (let i = 0; i < 2; i++) {
      const res = await server.inject({
        method: "GET",
        url: "/api/tasks/lists",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(res.statusCode).toBe(200);
    }
    const schedules = await appBoss.getSchedules(TASKS_RECURRENCE_QUEUE, ids.userA);
    expect(schedules).toHaveLength(1);
  });
});
