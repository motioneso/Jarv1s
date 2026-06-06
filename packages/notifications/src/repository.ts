import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type Notification,
  type NotificationVisibility
} from "@jarv1s/db";

export interface NotificationWithReadState extends Notification {
  readonly read_at: Date | null;
}

export interface ListNotificationsResult {
  readonly notifications: readonly NotificationWithReadState[];
  readonly unreadCount: number;
}

export interface CreateNotificationInput {
  readonly actorUserId?: string | null;
  readonly recipientUserId?: string | null;
  readonly workspaceId?: string | null;
  readonly visibility?: NotificationVisibility;
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

    const visibility = input.visibility ?? "private";
    const notification = await scopedDb.db
      .insertInto("app.notifications")
      .values({
        id: randomUUID(),
        actor_user_id:
          input.actorUserId === undefined
            ? sql<string>`app.current_actor_user_id()`
            : input.actorUserId,
        recipient_user_id:
          input.recipientUserId === undefined
            ? visibility === "private"
              ? sql<string>`app.current_actor_user_id()`
              : null
            : input.recipientUserId,
        workspace_id: input.workspaceId ?? null,
        visibility,
        title: input.title,
        body: input.body ?? null,
        metadata: input.metadata ?? {},
        created_at: new Date()
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ...notification,
      read_at: null
    };
  }

  async markRead(
    scopedDb: DataContextDb,
    notificationId: string
  ): Promise<NotificationWithReadState | undefined> {
    assertDataContextDb(scopedDb);

    const read = await scopedDb.db
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
          .where("id", "=", notificationId)
      )
      .onConflict((oc) =>
        oc.columns(["notification_id", "user_id"]).doUpdateSet({
          read_at: sql<Date>`excluded.read_at`
        })
      )
      .returning("notification_id")
      .executeTakeFirst();

    if (!read) {
      return undefined;
    }

    return this.getById(scopedDb, notificationId);
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
        "notifications.workspace_id as workspace_id",
        "notifications.visibility as visibility",
        "notifications.title as title",
        "notifications.body as body",
        "notifications.metadata as metadata",
        "notifications.created_at as created_at",
        "reads.read_at as read_at"
      ]);
  }
}
