import { randomUUID } from "node:crypto";

import { sql, type SqlBool } from "kysely";

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
  readonly moduleId: string;
  readonly title: string;
  readonly body?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly urgency?: "urgent" | "normal" | "low";
}

/**
 * Cross-module port: notifications reads the actor's quiet-hours settings (and locale
 * timezone fallback) without importing from @jarv1s/settings or @jarv1s/structured-state.
 * The implementation is injected by the composition root (module-registry).
 */
export interface QuietHoursPort {
  getSettings(scopedDb: DataContextDb): Promise<unknown>;
  getLocaleTimezone(scopedDb: DataContextDb): Promise<string | null>;
}

export interface NotificationPreferencePort {
  isModuleEnabled(scopedDb: DataContextDb, moduleId: string): Promise<boolean>;
}

export interface QuietHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string | null;
}

function isValidHHMM(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function parseQuietHoursSettings(raw: unknown): QuietHoursSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  if (!isValidHHMM(r.start) || !isValidHHMM(r.end)) return null;
  const timezone = typeof r.timezone === "string" && r.timezone.length > 0 ? r.timezone : null;
  return { enabled: r.enabled, start: r.start, end: r.end, timezone };
}

function getLocalMinutes(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return (parseInt(parts.hour ?? "0", 10) % 24) * 60 + parseInt(parts.minute ?? "0", 10);
}

function parseHHMM(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(":");
  return [parseInt(h ?? "0", 10), parseInt(m ?? "0", 10)];
}

function isInQuietHours(now: Date, settings: QuietHoursSettings, tz: string): boolean {
  if (!settings.enabled) return false;
  const cur = getLocalMinutes(now, tz);
  const [sh, sm] = parseHHMM(settings.start);
  const [eh, em] = parseHHMM(settings.end);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Overnight window (e.g. 22:00–07:00): when start >= end wrap crosses midnight
  if (start >= end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

export function computeDeferredUntil(
  now: Date,
  settings: QuietHoursSettings,
  tz: string
): Date | null {
  if (!isInQuietHours(now, settings, tz)) return null;
  const [eh, em] = parseHHMM(settings.end);
  const endTotalMin = eh * 60 + em;
  const curLocal = getLocalMinutes(now, tz);

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour12: false
  });
  const partsMap = Object.fromEntries(dateFmt.formatToParts(now).map((p) => [p.type, p.value]));
  const year = parseInt(partsMap.year ?? "2000", 10);
  const month = parseInt(partsMap.month ?? "1", 10) - 1;
  const day = parseInt(partsMap.day ?? "1", 10);

  // For overnight windows (start > end), pre-midnight leg means end is NEXT local day.
  const dayOffset = endTotalMin <= curLocal ? 1 : 0;

  // Naive approximation: treat tz offset as zero, place end-time at UTC midnight + end.
  const naiveUTC = new Date(Date.UTC(year, month, day + dayOffset, eh, em, 0));

  // Measure how far the naive approximation's local time is from the target local time.
  // Use modular arithmetic (±720 window) so overnight wrap doesn't flip the sign.
  const localMinAtNaive = getLocalMinutes(naiveUTC, tz);
  let deltaMin = endTotalMin - localMinAtNaive;
  if (deltaMin < -720) deltaMin += 1440;
  if (deltaMin > 720) deltaMin -= 1440;

  return new Date(naiveUTC.getTime() + deltaMin * 60 * 1000);
}

export async function resolveTimezone(
  port: QuietHoursPort,
  scopedDb: DataContextDb,
  explicitTz: string | null
): Promise<string> {
  if (explicitTz) return explicitTz;
  const localeTz = await port.getLocaleTimezone(scopedDb);
  return localeTz ?? "UTC";
}

export class NotificationsRepository {
  constructor(
    private readonly quietHoursPort?: QuietHoursPort,
    private readonly notificationPreferencePort?: NotificationPreferencePort
  ) {}

  async listVisible(scopedDb: DataContextDb): Promise<ListNotificationsResult> {
    assertDataContextDb(scopedDb);

    const [notifications, unreadCount] = await Promise.all([
      this.listVisibleRows(scopedDb),
      this.countUnread(scopedDb)
    ]);

    return { notifications, unreadCount };
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
  ): Promise<NotificationWithReadState | null> {
    assertDataContextDb(scopedDb);
    if (!input.moduleId?.trim()) {
      throw new Error("moduleId is required");
    }
    if (
      this.notificationPreferencePort &&
      !(await this.notificationPreferencePort.isModuleEnabled(scopedDb, input.moduleId))
    ) {
      return null;
    }

    const projectedMetadata = projectNotificationMetadata(input.metadata);
    const urgency = input.urgency ?? "normal";

    let deferredUntil: Date | null = null;
    if (urgency !== "urgent" && this.quietHoursPort) {
      const raw = await this.quietHoursPort.getSettings(scopedDb);
      const settings = parseQuietHoursSettings(raw);
      if (settings?.enabled) {
        const tz = await resolveTimezone(this.quietHoursPort, scopedDb, settings.timezone);
        deferredUntil = computeDeferredUntil(new Date(), settings, tz);
      }
    }

    const notification = await scopedDb.db
      .insertInto("app.notifications")
      .values({
        id: randomUUID(),
        // V1 actor-scoped delivery: both ids are always the active actor.
        module_id: input.moduleId,
        actor_user_id: sql<string>`app.current_actor_user_id()`,
        recipient_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        body: input.body ?? null,
        metadata: projectedMetadata,
        created_at: new Date(),
        urgency,
        deferred_until: deferredUntil
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ...notification, read_at: null };
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
        n.module_id AS module_id,
        n.actor_user_id AS actor_user_id,
        n.recipient_user_id AS recipient_user_id,
        n.title AS title,
        n.body AS body,
        n.metadata AS metadata,
        n.created_at AS created_at,
        n.urgency AS urgency,
        n.deferred_until AS deferred_until,
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
          // Only mark visible (not still-deferred) notifications as read
          .where(sql<SqlBool>`(deferred_until IS NULL OR now() >= deferred_until)`)
      )
      .onConflict((oc) =>
        oc.columns(["notification_id", "user_id"]).doUpdateSet({
          read_at: sql<Date>`excluded.read_at`
        })
      )
      .execute();

    return this.countUnread(scopedDb);
  }

  async markModuleRead(scopedDb: DataContextDb, moduleId: string): Promise<number> {
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
          .where("module_id", "=", moduleId)
          .where(sql<SqlBool>`(deferred_until IS NULL OR now() >= deferred_until)`)
      )
      .onConflict((oc) =>
        oc.columns(["notification_id", "user_id"]).doUpdateSet({
          read_at: sql<Date>`excluded.read_at`
        })
      )
      .execute();

    return this.countUnread(scopedDb);
  }

  async listDigestEligible(
    scopedDb: DataContextDb,
    input: { since: Date | null; limit?: number }
  ): Promise<NotificationWithReadState[]> {
    assertDataContextDb(scopedDb);

    let query = this.visibleRowsQuery(scopedDb).where("reads.notification_id", "is", null);
    if (input.since) {
      query = query.where("notifications.created_at", ">", input.since);
    }
    return query
      .orderBy("notifications.created_at", "asc")
      .orderBy("notifications.id")
      .limit(input.limit ?? 50)
      .execute();
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
      .where(
        sql<SqlBool>`(notifications.deferred_until IS NULL OR now() >= notifications.deferred_until)`
      )
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
        "notifications.module_id as module_id",
        "notifications.actor_user_id as actor_user_id",
        "notifications.recipient_user_id as recipient_user_id",
        "notifications.title as title",
        "notifications.body as body",
        "notifications.metadata as metadata",
        "notifications.created_at as created_at",
        "notifications.urgency as urgency",
        "notifications.deferred_until as deferred_until",
        "reads.read_at as read_at"
      ])
      .where(
        sql<SqlBool>`(notifications.deferred_until IS NULL OR now() >= notifications.deferred_until)`
      );
  }
}
