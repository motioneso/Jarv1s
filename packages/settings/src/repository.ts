import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { AdminAuditEvent, InstanceSetting, User } from "@jarv1s/db";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

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
    if (input.status === "deactivated" && target.is_instance_admin) {
      await this.assertAnotherActiveAdmin(scopedDb, input.targetUserId);
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
      if (target.is_instance_admin) {
        await this.assertAnotherActiveAdmin(scopedDb, input.targetUserId);
      }
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

  private async assertAnotherActiveAdmin(
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
