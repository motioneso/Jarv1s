import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Notification } from "@jarv1s/db";

import { projectNotificationMetadata } from "./metadata.js";

export interface NotificationWithReadState extends Notification {
  readonly read_at: Date | null;
}

export interface ListNotificationsResult {
  readonly notifications: readonly NotificationWithReadState[];
  readonly unreadCount: number;
}

/**
 * Input for creating a notification. The V1 delivery model is **in-app, actor-scoped**:
 * `recipient_user_id` and `actor_user_id` are ALWAYS `app.current_actor_user_id()` — there
 * is intentionally no override here. RLS would silently reject any other recipient, so an
 * override would be phantom flexibility that misleads callers into thinking cross-recipient
 * or system-emitter paths are supported. A future spec can re-introduce a system-emitter
 * (NULL `actor_user_id`) path with its own `SECURITY DEFINER` plumbing when needed.
 *
 * `metadata` is bounded by `projectNotificationMetadata` before it is written; the type is
 * wide here only because callers should not have to construct the bounded form themselves.
 */
export interface CreateNotificationInput {
  readonly title: string;
  readonly body?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export class NotificationsRepository {
  async listVisible(scopedDb: DataContextDb): Promise<ListNotificationsResult> {
    assertDataContextDb(scopedDb);

    const [notifications, unreadCount] = await Promise.all([
      this.listVisibleRows(scopedDb),
      this.countUnread(scopedDb)
    ]);

    return {
      notifications,
      unreadCount
    };
  }

  async getById(
    scopedDb: DataContextDb,
    notificationId: string
  ): Promise<NotificationWithReadState | undefined> {
    assertDataContextDb(scopedDb);

    return this.visibleRowsQuery(scopedDb)
      .where("notifications.id", "=", notificationId)
      .executeTakeFirst();
  }

  async create(
    scopedDb: DataContextDb,
    input: CreateNotificationInput
  ): Promise<NotificationWithReadState> {
    assertDataContextDb(scopedDb);

    // The metadata projection is the input-side bound (Decision 3a). It is applied HERE,
    // at the producer chokepoint, so the value written to app.notifications.metadata is
    // already the bounded shape. The briefings producer (packages/briefings/src/jobs.ts)
    // emits `{ definitionId, briefingRunId }` which passes through unchanged.
    const projectedMetadata = projectNotificationMetadata(input.metadata);

    const notification = await scopedDb.db
      .insertInto("app.notifications")
      .values({
        id: randomUUID(),
        // V1 actor-scoped delivery: both ids are always the active actor.
        actor_user_id: sql<string>`app.current_actor_user_id()`,
        recipient_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        body: input.body ?? null,
        metadata: projectedMetadata,
        created_at: new Date()
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ...notification,
      read_at: null
    };
  }

  /**
   * Record a read for `notificationId` on behalf of the active actor and return the row
   * with its updated read state.
   *
   * Returns `undefined` BOTH when the notification does not exist AND when it exists but is
   * not visible to the current actor (RLS-invisible). This conflation is DELIBERATE: it
   * prevents any existence side-channel. Callers — and the route layer — MUST NOT attempt
   * to differentiate the two cases; the route answers `404 Notification not found` for
   * either. See the docblock on `PATCH /api/notifications/:id/read` in routes.ts.
   *
   * Implementation: a single data-modifying CTE performs the INSERT ... ON CONFLICT and
   * the JOIN back to app.notifications in one round-trip. The SELECT inside the CTE is
   * subject to RLS, so a row that does not exist OR is invisible yields zero inserted
   * rows and the final JOIN returns no rows → `undefined`. markAllRead is intentionally
   * NOT collapsed (it returns a count, not a row, so there is no redundant follow-up read).
   */
  async markRead(
    scopedDb: DataContextDb,
    notificationId: string
  ): Promise<NotificationWithReadState | undefined> {
    assertDataContextDb(scopedDb);

    // Single round-trip via a modifying CTE: the INSERT emits zero rows when the parent
    // notification is absent or RLS-invisible, and the final JOIN returns nothing — which
    // is the exact "absent === denied" behavior we must preserve.
    const rows = await sql<NotificationWithReadState>`
      WITH inserted AS (
        INSERT INTO app.notification_reads (notification_id, user_id, read_at)
        SELECT n.id, app.current_actor_user_id(), now()
        FROM app.notifications n
        WHERE n.id = ${notificationId}::uuid
        ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
        RETURNING notification_id, read_at
      )
      SELECT
        n.id AS id,
        n.actor_user_id AS actor_user_id,
        n.recipient_user_id AS recipient_user_id,
        n.title AS title,
        n.body AS body,
        n.metadata AS metadata,
        n.created_at AS created_at,
        inserted.read_at AS read_at
      FROM app.notifications n
      JOIN inserted ON inserted.notification_id = n.id
    `.execute(scopedDb.db);

    return rows.rows[0];
  }

  async markAllRead(scopedDb: DataContextDb): Promise<number> {
    assertDataContextDb(scopedDb);

    await scopedDb.db
      .insertInto("app.notification_reads")
      .columns(["notification_id", "user_id", "read_at"])
      .expression((eb) =>
        eb
          .selectFrom("app.notifications")
          .select([
            "id as notification_id",
            sql<string>`app.current_actor_user_id()`.as("user_id"),
            sql<Date>`now()`.as("read_at")
          ])
      )
      .onConflict((oc) =>
        oc.columns(["notification_id", "user_id"]).doUpdateSet({
          read_at: sql<Date>`excluded.read_at`
        })
      )
      .execute();

    return this.countUnread(scopedDb);
  }

  private async listVisibleRows(scopedDb: DataContextDb): Promise<NotificationWithReadState[]> {
    return this.visibleRowsQuery(scopedDb)
      .orderBy("notifications.created_at", "desc")
      .orderBy("notifications.id")
      .execute();
  }

  private async countUnread(scopedDb: DataContextDb): Promise<number> {
    const row = await scopedDb.db
      .selectFrom("app.notifications as notifications")
      .leftJoin("app.notification_reads as reads", (join) =>
        join
          .onRef("reads.notification_id", "=", "notifications.id")
          .on("reads.user_id", "=", sql<string>`app.current_actor_user_id()`)
      )
      .select(({ fn }) => fn.count<string>("notifications.id").as("unread_count"))
      .where("reads.notification_id", "is", null)
      .executeTakeFirstOrThrow();

    return Number(row.unread_count);
  }

  private visibleRowsQuery(scopedDb: DataContextDb) {
    return scopedDb.db
      .selectFrom("app.notifications as notifications")
      .leftJoin("app.notification_reads as reads", (join) =>
        join
          .onRef("reads.notification_id", "=", "notifications.id")
          .on("reads.user_id", "=", sql<string>`app.current_actor_user_id()`)
      )
      .select([
        "notifications.id as id",
        "notifications.actor_user_id as actor_user_id",
        "notifications.recipient_user_id as recipient_user_id",
        "notifications.title as title",
        "notifications.body as body",
        "notifications.metadata as metadata",
        "notifications.created_at as created_at",
        "reads.read_at as read_at"
      ]);
  }
}
