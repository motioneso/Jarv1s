import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { AdminAuditEvent, InstanceSetting, User } from "@jarv1s/db";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ChatMultiplexerChoice } from "@jarv1s/shared";

export interface UpsertInstanceSettingInput {
  readonly key: string;
  readonly value: Record<string, unknown>;
  readonly updatedByUserId: string;
  readonly requestId: string;
}

export interface SetUserStatusInput {
  readonly targetUserId: string;
  readonly status: "pending" | "active" | "deactivated";
  readonly action: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface SetUserAdminInput {
  readonly targetUserId: string;
  readonly isInstanceAdmin: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RegistrationSettings {
  readonly registrationEnabled: boolean;
  readonly requiresApproval: boolean;
}

export class HttpRepositoryError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export class SettingsRepository {
  // No db in constructor — DataContextDb is passed per method via withDataContext.

  async getUserById(scopedDb: DataContextDb, userId: string): Promise<User | undefined> {
    assertDataContextDb(scopedDb);
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
      scopedDb.db
    );
    return result.rows[0];
  }

  async listUsers(scopedDb: DataContextDb): Promise<User[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<User>`SELECT * FROM app.list_all_users()`.execute(scopedDb.db);
    return result.rows;
  }

  async listInstanceSettings(scopedDb: DataContextDb): Promise<InstanceSetting[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db.selectFrom("app.instance_settings").selectAll().orderBy("key").execute();
  }

  async upsertInstanceSetting(
    scopedDb: DataContextDb,
    input: UpsertInstanceSettingInput
  ): Promise<InstanceSetting> {
    assertDataContextDb(scopedDb);
    const setting = await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: input.key,
        value: input.value,
        updated_by_user_id: input.updatedByUserId,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: input.value,
          updated_by_user_id: input.updatedByUserId,
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.updatedByUserId,
      action: "instance_setting.upsert",
      targetType: "instance_setting",
      targetId: input.key,
      requestId: input.requestId,
      metadata: { key: input.key }
    });

    return setting;
  }

  async setUserStatus(scopedDb: DataContextDb, input: SetUserStatusInput): Promise<User> {
    assertDataContextDb(scopedDb);
    // GUC already set by withDataContext — no inner tx wrapper, no manual GUC write here.
    const target = await this.requireUserRow(scopedDb, input.targetUserId);

    if (target.is_bootstrap_owner && input.status === "deactivated") {
      throw new HttpRepositoryError(409, "The bootstrap owner cannot be deactivated");
    }
    if (input.status === "deactivated" && input.targetUserId === input.actorUserId) {
      throw new HttpRepositoryError(422, "You cannot deactivate your own account");
    }
    // Re-reads the admin flag under the lock (the `target` read above may be
    // stale); no-ops for non-admins. Guards against deactivating the last admin.
    if (input.status === "deactivated") {
      await this.assertRemovingActiveAdminIsSafe(scopedDb, input.targetUserId);
    }

    const updated = await scopedDb.db
      .updateTable("app.users")
      .set({ status: input.status, updated_at: new Date() })
      .where("id", "=", input.targetUserId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { status: input.status },
      requestId: input.requestId
    });

    return updated;
  }

  async setUserAdmin(scopedDb: DataContextDb, input: SetUserAdminInput): Promise<User> {
    assertDataContextDb(scopedDb);
    // GUC already set by withDataContext — no inner tx wrapper, no manual GUC write here.
    const target = await this.requireUserRow(scopedDb, input.targetUserId);

    if (!input.isInstanceAdmin) {
      if (target.is_bootstrap_owner) {
        throw new HttpRepositoryError(409, "The bootstrap owner cannot be demoted");
      }
      // Re-reads the admin flag under the lock (the `target` read above may be
      // stale); no-ops if the target is not actually an admin.
      await this.assertRemovingActiveAdminIsSafe(scopedDb, input.targetUserId);
    }

    const updated = await scopedDb.db
      .updateTable("app.users")
      .set({ is_instance_admin: input.isInstanceAdmin, updated_at: new Date() })
      .where("id", "=", input.targetUserId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.isInstanceAdmin ? "user.promote" : "user.demote",
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { isInstanceAdmin: input.isInstanceAdmin },
      requestId: input.requestId
    });

    return updated;
  }

  async getRegistrationSettings(scopedDb: DataContextDb): Promise<RegistrationSettings> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select(["key", "value"])
      .where("key", "in", ["registration.enabled", "registration.requires_approval"])
      .execute();
    const read = (key: string, fallback: boolean): boolean => {
      const val = (rows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)
        ?.value;
      return typeof val === "boolean" ? val : fallback;
    };
    return {
      registrationEnabled: read("registration.enabled", true),
      requiresApproval: read("registration.requires_approval", true)
    };
  }

  async setRegistrationSettings(
    scopedDb: DataContextDb,
    input: RegistrationSettings & { actorUserId: string; requestId: string }
  ): Promise<RegistrationSettings> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "registration.enabled",
      value: { value: input.registrationEnabled },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    await this.upsertInstanceSetting(scopedDb, {
      key: "registration.requires_approval",
      value: { value: input.requiresApproval },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    return {
      registrationEnabled: input.registrationEnabled,
      requiresApproval: input.requiresApproval
    };
  }

  async getChatMultiplexerSetting(
    scopedDb: DataContextDb
  ): Promise<{ multiplexer: ChatMultiplexerChoice }> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "chat.multiplexer")
      .executeTakeFirst();
    const raw = (row?.value as { value?: unknown } | undefined)?.value;
    return { multiplexer: raw === "tmux" || raw === "herdr" ? raw : "auto" };
  }

  async setChatMultiplexerSetting(
    scopedDb: DataContextDb,
    input: { multiplexer: ChatMultiplexerChoice; actorUserId: string; requestId: string }
  ): Promise<{ multiplexer: ChatMultiplexerChoice }> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "chat.multiplexer",
      value: { value: input.multiplexer },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    return { multiplexer: input.multiplexer };
  }

  async listAdminAuditEvents(scopedDb: DataContextDb): Promise<AdminAuditEvent[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.admin_audit_events")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(50)
      .execute();
  }

  async assertNotLastActiveAdmin(scopedDb: DataContextDb, excludingUserId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await this.assertAnotherActiveAdmin(scopedDb, excludingUserId);
  }

  private async requireUserRow(scopedDb: DataContextDb, userId: string): Promise<User> {
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
      scopedDb.db
    );
    const user = result.rows[0];
    if (!user) {
      throw new HttpRepositoryError(404, "User not found");
    }
    return user;
  }

  /**
   * Serialize last-active-admin checks against any other admin-removing mutation.
   * withDataContext runs each repository method inside a single transaction, so
   * this transaction-scoped advisory lock is held through the caller's subsequent
   * UPDATE and commit. The same key is taken by the bootstrap-connection delete
   * path (scripts/delete-user-data.ts) — advisory locks are per-database, so all
   * removal paths serialize. Mirrors the bootstrapFirstJarvisUser pattern
   * (auth/src/index.ts). (#94)
   */
  private async lockLastActiveAdmin(scopedDb: DataContextDb): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext('jarv1s:last-active-admin'))`.execute(
      scopedDb.db
    );
  }

  /** Throws 409 unless an active admin other than excludingUserId exists. Assumes the lock is held. */
  private async ensureAnotherActiveAdminExists(
    scopedDb: DataContextDb,
    excludingUserId: string
  ): Promise<void> {
    const result = await sql<{ id: string }>`
      SELECT id FROM app.list_all_users()
      WHERE is_instance_admin = true AND status = 'active' AND id != ${excludingUserId}::uuid
      LIMIT 1
    `.execute(scopedDb.db);
    if (!result.rows[0]) {
      throw new HttpRepositoryError(409, "Cannot remove the last active admin");
    }
  }

  /**
   * Take the lock, then count under it. For callers (the route delete/reject
   * pre-checks) that have already established the target is an admin.
   */
  private async assertAnotherActiveAdmin(
    scopedDb: DataContextDb,
    excludingUserId: string
  ): Promise<void> {
    await this.lockLastActiveAdmin(scopedDb);
    await this.ensureAnotherActiveAdminExists(scopedDb, excludingUserId);
  }

  /**
   * Guard a deactivate/demote of targetUserId. Takes the lock FIRST, then
   * re-reads the target's admin flag under the lock — so a stale "not an admin"
   * read taken before the lock (e.g. racing a concurrent promote) can never skip
   * the guard. Only when the target is genuinely an admin do we require another
   * active admin to remain. (#94)
   */
  private async assertRemovingActiveAdminIsSafe(
    scopedDb: DataContextDb,
    targetUserId: string
  ): Promise<void> {
    await this.lockLastActiveAdmin(scopedDb);
    const target = await this.requireUserRow(scopedDb, targetUserId);
    if (!target.is_instance_admin) {
      return;
    }
    await this.ensureAnotherActiveAdminExists(scopedDb, targetUserId);
  }

  async insertAuditEvent(
    scopedDb: DataContextDb,
    input: {
      readonly actorUserId: string;
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string | null;
      readonly metadata: Record<string, unknown>;
      readonly requestId: string;
    }
  ): Promise<void> {
    await scopedDb.db
      .insertInto("app.admin_audit_events")
      .values({
        id: randomUUID(),
        actor_user_id: input.actorUserId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        metadata: input.metadata,
        request_id: input.requestId,
        created_at: new Date()
      })
      .execute();
  }
}

/**
 * Public cross-module API for recording admin audit events.
 * Called by packages/auth via @jarv1s/settings — auth must never import
 * SettingsRepository directly or write app.admin_audit_events directly.
 */
export async function recordAuditEvent(
  scopedDb: DataContextDb,
  event: {
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: string; // NOT NULL in schema — always required
    readonly targetId: string;
    readonly metadata: Record<string, unknown>;
    readonly requestId: string;
  }
): Promise<void> {
  assertDataContextDb(scopedDb);
  await new SettingsRepository().insertAuditEvent(scopedDb, event);
}
