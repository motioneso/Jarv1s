import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createEmailTriageFeedbackPort } from "@jarv1s/module-registry";
import { serializeTask, TasksRepository } from "@jarv1s/tasks";

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
        externalKey: "email:conn-1:msg-suggested-1",
        suggestionMetadata: {
          version: 1,
          category: "needs_reply",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#inbox/msg-suggested-1",
          cacheMessageId: "cache-msg-suggested-1",
          subjectSignature: "a".repeat(64),
          computedAt: "2026-07-30T12:00:00.000Z",
          resurfaceReason: null
        }
      })
    );

    expect(task.status).toBe("suggested");
    expect(task.completed_at).toBeNull();
    expect(task.source).toBe("email");
    expect(task.external_key).toBe("email:conn-1:msg-suggested-1");
    expect(serializeTask(task).suggestionMetadata).toEqual({
      version: 1,
      category: "needs_reply",
      sourceLabel: "Gmail",
      sourceHref: "https://mail.google.com/mail/u/0/#inbox/msg-suggested-1",
      cacheMessageId: "cache-msg-suggested-1",
      subjectSignature: "a".repeat(64),
      computedAt: "2026-07-30T12:00:00.000Z",
      resurfaceReason: null
    });
  });

  it("refreshes typed metadata on a suggested idempotent task without changing status", async () => {
    const first = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Original suggested task",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-metadata-refresh-1",
        suggestionMetadata: {
          version: 1,
          category: "needs_reply",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#inbox/old",
          cacheMessageId: "cache-old",
          subjectSignature: "b".repeat(64),
          computedAt: "2026-07-30T12:00:00.000Z",
          resurfaceReason: null
        }
      })
    );
    const refreshed = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Ignored duplicate title",
        status: "todo",
        source: "email",
        externalKey: "email:conn-1:msg-metadata-refresh-1",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#inbox/new",
          cacheMessageId: null,
          subjectSignature: "b".repeat(64),
          computedAt: "2026-07-30T12:01:00.000Z",
          resurfaceReason: "relevant_context"
        }
      })
    );

    expect(refreshed.id).toBe(first.id);
    expect(refreshed.status).toBe("suggested");
    expect(refreshed.suggestion_metadata).toEqual({
      version: 1,
      category: "needs_action",
      sourceLabel: "Gmail",
      sourceHref: "https://mail.google.com/mail/u/0/#inbox/new",
      cacheMessageId: null,
      subjectSignature: "b".repeat(64),
      computedAt: "2026-07-30T12:01:00.000Z",
      resurfaceReason: "relevant_context"
    });
  });

  it("revives an archived email task when new evidence resurfaces it", async () => {
    const first = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Dismissed email task",
        status: "suggested",
        source: "email",
        externalKey: "email:conn-1:msg-resurface-1",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#all/thread-old",
          cacheMessageId: "cache-old",
          subjectSignature: "e".repeat(64),
          computedAt: "2026-07-30T12:00:00.000Z",
          resurfaceReason: null
        }
      })
    );
    await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.update(scopedDb, first.id, { status: "archived" })
    );

    const revived = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Updated resurfaced email task",
        description: "Updated description",
        status: "suggested",
        dueAt: "2026-07-31T12:00:00.000Z",
        source: "email",
        externalKey: "email:conn-1:msg-resurface-1",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#all/thread-new",
          cacheMessageId: "cache-new",
          subjectSignature: "e".repeat(64),
          computedAt: "2026-07-30T12:01:00.000Z",
          resurfaceReason: "relevant_context"
        }
      })
    );

    expect(revived.id).toBe(first.id);
    expect(revived.status).toBe("suggested");
    expect(revived.completed_at).toBeNull();
    expect(revived.title).toBe("Updated resurfaced email task");
    expect(revived.description).toBe("Updated description");
    expect(revived.due_at).toEqual(new Date("2026-07-31T12:00:00.000Z"));
    expect(revived.suggestion_metadata).toMatchObject({
      cacheMessageId: "cache-new",
      resurfaceReason: "relevant_context"
    });
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

  it("dismiss and suppression update commit atomically", async () => {
    const subjectSignature = "c".repeat(64);
    await dataContext.withDataContext(ctx, (scopedDb) =>
      sql`
        INSERT INTO app.email_action_suppression
          (owner_user_id, subject_signature, dismissal_count,
           last_deadline_evidence_key, last_context_message_key)
        VALUES (${ids.userA}, ${subjectSignature}, 1, 'deadline:old', 'acct:message')
      `.execute(scopedDb.db)
    );
    const task = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Dismiss this suggestion",
        status: "suggested",
        source: "email",
        sourceRef: "00000000-0000-0000-0000-000000000001:message-atomic",
        externalKey: "email:atomic-dismiss",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#all/thread-atomic",
          cacheMessageId: "cache-atomic",
          subjectSignature,
          computedAt: "2026-07-30T12:00:00.000Z",
          resurfaceReason: null
        }
      })
    );
    const port = createEmailTriageFeedbackPort();
    const dismissed = await dataContext.withDataContext(ctx, async (scopedDb) => {
      const updated = await repository.update(scopedDb, task.id, { status: "archived" });
      await port.record(scopedDb, {
        taskSourceRef: updated?.source_ref ?? null,
        subjectSignature,
        verdict: "rejected",
        title: updated?.title ?? ""
      });
      return updated;
    });
    expect(dismissed?.status).toBe("archived");

    const afterDismiss = await dataContext.withDataContext(ctx, (scopedDb) =>
      scopedDb.db
        .selectFrom("app.email_action_suppression")
        .selectAll()
        .where("subject_signature", "=", subjectSignature)
        .executeTakeFirstOrThrow()
    );
    expect(afterDismiss).toMatchObject({ dismissal_count: 2 });

    const acceptedTask = await dataContext.withDataContext(ctx, (scopedDb) =>
      repository.create(scopedDb, {
        title: "Accept this suggestion",
        status: "suggested",
        source: "email",
        sourceRef: "00000000-0000-0000-0000-000000000001:message-accept",
        externalKey: "email:atomic-accept",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.google.com/mail/u/0/#all/thread-accept",
          cacheMessageId: "cache-accept",
          subjectSignature,
          computedAt: "2026-07-30T12:00:00.000Z",
          resurfaceReason: null
        }
      })
    );
    await dataContext.withDataContext(ctx, async (scopedDb) => {
      const updated = await repository.update(scopedDb, acceptedTask.id, { status: "todo" });
      await port.record(scopedDb, {
        taskSourceRef: updated?.source_ref ?? null,
        subjectSignature,
        verdict: "accepted",
        title: updated?.title ?? ""
      });
    });
    const afterAccept = await dataContext.withDataContext(ctx, (scopedDb) =>
      scopedDb.db
        .selectFrom("app.email_action_suppression")
        .selectAll()
        .where("subject_signature", "=", subjectSignature)
        .executeTakeFirstOrThrow()
    );
    expect(afterAccept).toMatchObject({
      dismissal_count: 0,
      last_deadline_evidence_key: null,
      last_context_message_key: null
    });

    const missingSignature = "d".repeat(64);
    await dataContext.withDataContext(ctx, (scopedDb) =>
      port.record(scopedDb, {
        taskSourceRef: null,
        subjectSignature: missingSignature,
        verdict: "accepted",
        title: "No suppression row"
      })
    );
    const missing = await dataContext.withDataContext(ctx, (scopedDb) =>
      scopedDb.db
        .selectFrom("app.email_action_suppression")
        .select("subject_signature")
        .where("subject_signature", "=", missingSignature)
        .executeTakeFirst()
    );
    expect(missing).toBeUndefined();
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
