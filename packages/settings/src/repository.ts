import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";

import type {
  AdminAuditEvent,
  InstanceSetting,
  JarvisDatabase,
  ResourceGrant,
  User,
  Workspace,
  WorkspaceMembership
} from "@jarv1s/db";

type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface UpsertWorkspaceMembershipInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface DeleteWorkspaceMembershipInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface UpsertResourceGrantInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
  readonly grantLevel: "view" | "contribute" | "manage";
  readonly grantedByUserId: string;
  readonly requestId: string;
}

export interface DeleteResourceGrantInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

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
  constructor(private readonly db: Kysely<JarvisDatabase>) {}

  async countUsers(): Promise<number> {
    const result = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(
      this.db
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getUserById(userId: string): Promise<User | undefined> {
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
      this.db
    );
    return result.rows[0];
  }

  async listUsers(): Promise<User[]> {
    const result = await sql<User>`SELECT * FROM app.list_all_users()`.execute(this.db);
    return result.rows;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return this.db
      .selectFrom("app.workspaces")
      .selectAll()
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }

  async listMembershipsForUser(userId: string): Promise<WorkspaceMembership[]> {
    return this.db
      .selectFrom("app.workspace_memberships")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .orderBy("workspace_id")
      .execute();
  }

  async listMembershipsForWorkspace(workspaceId: string): Promise<WorkspaceMembership[]> {
    await this.requireWorkspace(workspaceId);

    return this.db
      .selectFrom("app.workspace_memberships")
      .selectAll()
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at")
      .orderBy("user_id")
      .execute();
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    return this.db
      .selectFrom("app.workspace_memberships as memberships")
      .innerJoin("app.workspaces as workspaces", "workspaces.id", "memberships.workspace_id")
      .select([
        "workspaces.id",
        "workspaces.name",
        "workspaces.created_by_user_id",
        "workspaces.created_at",
        "workspaces.updated_at"
      ])
      .where("memberships.user_id", "=", userId)
      .orderBy("workspaces.created_at")
      .orderBy("workspaces.id")
      .execute();
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = new Date();
    const workspaceId = randomUUID();

    return this.db.transaction().execute(async (transaction) => {
      const workspace = await transaction
        .insertInto("app.workspaces")
        .values({
          id: workspaceId,
          name: input.name,
          created_by_user_id: input.actorUserId,
          created_at: now,
          updated_at: now
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .insertInto("app.workspace_memberships")
        .values({
          user_id: input.actorUserId,
          workspace_id: workspaceId,
          role: "owner",
          created_at: now
        })
        .onConflict((oc) =>
          oc.columns(["user_id", "workspace_id"]).doUpdateSet({
            role: "owner"
          })
        )
        .execute();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "workspace.create",
        targetType: "workspace",
        targetId: workspaceId,
        requestId: input.requestId,
        metadata: {
          name: input.name
        }
      });

      return workspace;
    });
  }

  async upsertWorkspaceMembership(
    input: UpsertWorkspaceMembershipInput
  ): Promise<WorkspaceMembership> {
    return this.db.transaction().execute(async (transaction) => {
      await this.requireUser(input.userId, transaction);
      await this.requireWorkspace(input.workspaceId, transaction);
      await this.assertCanChangeWorkspaceMembershipRole(
        transaction,
        input.workspaceId,
        input.userId,
        input.role
      );

      const membership = await transaction
        .insertInto("app.workspace_memberships")
        .values({
          user_id: input.userId,
          workspace_id: input.workspaceId,
          role: input.role,
          created_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["user_id", "workspace_id"]).doUpdateSet({
            role: input.role
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "workspace_membership.upsert",
        targetType: "workspace_membership",
        targetId: `${input.workspaceId}:${input.userId}`,
        requestId: input.requestId,
        metadata: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role
        }
      });

      return membership;
    });
  }

  async deleteWorkspaceMembership(
    input: DeleteWorkspaceMembershipInput
  ): Promise<WorkspaceMembership> {
    return this.db.transaction().execute(async (transaction) => {
      await this.requireWorkspace(input.workspaceId, transaction);
      await this.assertCanRemoveWorkspaceMembership(transaction, input.workspaceId, input.userId);

      const membership = await transaction
        .deleteFrom("app.workspace_memberships")
        .where("workspace_id", "=", input.workspaceId)
        .where("user_id", "=", input.userId)
        .returningAll()
        .executeTakeFirst();

      if (!membership) {
        throw new Error("Workspace membership not found");
      }

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "workspace_membership.delete",
        targetType: "workspace_membership",
        targetId: `${input.workspaceId}:${input.userId}`,
        requestId: input.requestId,
        metadata: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: membership.role
        }
      });

      return membership;
    });
  }

  async listResourceGrants(): Promise<ResourceGrant[]> {
    return this.db
      .selectFrom("app.resource_grants")
      .selectAll()
      .orderBy("created_at")
      .orderBy("resource_type")
      .orderBy("resource_id")
      .orderBy("grantee_user_id")
      .execute();
  }

  async upsertResourceGrant(input: UpsertResourceGrantInput): Promise<ResourceGrant> {
    return this.db.transaction().execute(async (transaction) => {
      await this.requireUser(input.granteeUserId, transaction);

      const grant = await transaction
        .insertInto("app.resource_grants")
        .values({
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          grantee_user_id: input.granteeUserId,
          grant_level: input.grantLevel,
          granted_by_user_id: input.grantedByUserId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["resource_type", "resource_id", "grantee_user_id"]).doUpdateSet({
            grant_level: input.grantLevel,
            granted_by_user_id: input.grantedByUserId,
            updated_at: new Date()
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.grantedByUserId,
        action: "resource_grant.upsert",
        targetType: "resource_grant",
        targetId: `${input.resourceType}:${input.resourceId}:${input.granteeUserId}`,
        requestId: input.requestId,
        metadata: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          granteeUserId: input.granteeUserId,
          grantLevel: input.grantLevel
        }
      });

      return grant;
    });
  }

  async deleteResourceGrant(input: DeleteResourceGrantInput): Promise<ResourceGrant> {
    return this.db.transaction().execute(async (transaction) => {
      const grant = await transaction
        .deleteFrom("app.resource_grants")
        .where("resource_type", "=", input.resourceType)
        .where("resource_id", "=", input.resourceId)
        .where("grantee_user_id", "=", input.granteeUserId)
        .returningAll()
        .executeTakeFirst();

      if (!grant) {
        throw new Error("Resource grant not found");
      }

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "resource_grant.delete",
        targetType: "resource_grant",
        targetId: `${input.resourceType}:${input.resourceId}:${input.granteeUserId}`,
        requestId: input.requestId,
        metadata: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          granteeUserId: input.granteeUserId,
          grantLevel: grant.grant_level
        }
      });

      return grant;
    });
  }

  async listInstanceSettings(): Promise<InstanceSetting[]> {
    return this.db.selectFrom("app.instance_settings").selectAll().orderBy("key").execute();
  }

  async upsertInstanceSetting(input: UpsertInstanceSettingInput): Promise<InstanceSetting> {
    return this.db.transaction().execute(async (transaction) => {
      const setting = await transaction
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

      await this.insertAuditEvent(transaction, {
        actorUserId: input.updatedByUserId,
        action: "instance_setting.upsert",
        targetType: "instance_setting",
        targetId: input.key,
        requestId: input.requestId,
        metadata: {
          key: input.key
        }
      });

      return setting;
    });
  }

  async setUserStatus(input: SetUserStatusInput): Promise<User> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT set_config('app.actor_user_id', ${input.actorUserId}, true)`.execute(
        transaction
      );

      const target = await this.requireUserRow(input.targetUserId, transaction);

      if (target.is_bootstrap_owner && input.status === "deactivated") {
        throw new HttpRepositoryError(409, "The bootstrap owner cannot be deactivated");
      }
      if (input.status === "deactivated" && input.targetUserId === input.actorUserId) {
        throw new HttpRepositoryError(422, "You cannot deactivate your own account");
      }
      if (input.status === "deactivated" && target.is_instance_admin) {
        await this.assertAnotherActiveAdmin(transaction, input.targetUserId);
      }

      const updated = await transaction
        .updateTable("app.users")
        .set({ status: input.status, updated_at: new Date() })
        .where("id", "=", input.targetUserId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: "user",
        targetId: input.targetUserId,
        metadata: { status: input.status },
        requestId: input.requestId
      });

      return updated;
    });
  }

  async setUserAdmin(input: SetUserAdminInput): Promise<User> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT set_config('app.actor_user_id', ${input.actorUserId}, true)`.execute(
        transaction
      );

      const target = await this.requireUserRow(input.targetUserId, transaction);

      if (!input.isInstanceAdmin) {
        if (target.is_bootstrap_owner) {
          throw new HttpRepositoryError(409, "The bootstrap owner cannot be demoted");
        }
        if (target.is_instance_admin) {
          await this.assertAnotherActiveAdmin(transaction, input.targetUserId);
        }
      }

      const updated = await transaction
        .updateTable("app.users")
        .set({ is_instance_admin: input.isInstanceAdmin, updated_at: new Date() })
        .where("id", "=", input.targetUserId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: input.isInstanceAdmin ? "user.promote" : "user.demote",
        targetType: "user",
        targetId: input.targetUserId,
        metadata: { isInstanceAdmin: input.isInstanceAdmin },
        requestId: input.requestId
      });

      return updated;
    });
  }

  async getRegistrationSettings(): Promise<RegistrationSettings> {
    const rows = await this.db
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
    input: RegistrationSettings & { actorUserId: string; requestId: string }
  ): Promise<RegistrationSettings> {
    await this.upsertInstanceSetting({
      key: "registration.enabled",
      value: { value: input.registrationEnabled },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    await this.upsertInstanceSetting({
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

  async listAdminAuditEvents(): Promise<AdminAuditEvent[]> {
    return this.db
      .selectFrom("app.admin_audit_events")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(50)
      .execute();
  }

  private async requireUser(userId: string, db: SettingsDb = this.db): Promise<void> {
    const result = await sql<{
      id: string;
    }>`SELECT id FROM app.get_user_by_id(${userId}::uuid)`.execute(db);

    if (!result.rows[0]) {
      throw new Error("User not found");
    }
  }

  private async requireWorkspace(workspaceId: string, db: SettingsDb = this.db): Promise<void> {
    const workspace = await db
      .selectFrom("app.workspaces")
      .select("id")
      .where("id", "=", workspaceId)
      .executeTakeFirst();

    if (!workspace) {
      throw new Error("Workspace not found");
    }
  }

  private async assertCanChangeWorkspaceMembershipRole(
    db: SettingsDb,
    workspaceId: string,
    userId: string,
    nextRole: string
  ): Promise<void> {
    const existing = await this.getWorkspaceMembership(db, workspaceId, userId);

    if (existing?.role === "owner" && nextRole !== "owner") {
      await this.assertWorkspaceHasAnotherOwner(db, workspaceId, userId);
    }
  }

  private async assertCanRemoveWorkspaceMembership(
    db: SettingsDb,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const existing = await this.getWorkspaceMembership(db, workspaceId, userId);

    if (!existing) {
      throw new Error("Workspace membership not found");
    }
    if (existing.role === "owner") {
      await this.assertWorkspaceHasAnotherOwner(db, workspaceId, userId);
    }
  }

  private async assertWorkspaceHasAnotherOwner(
    db: SettingsDb,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const owner = await db
      .selectFrom("app.workspace_memberships")
      .select("user_id")
      .where("workspace_id", "=", workspaceId)
      .where("role", "=", "owner")
      .where("user_id", "!=", userId)
      .executeTakeFirst();

    if (!owner) {
      throw new Error("Workspace must keep at least one owner");
    }
  }

  private async getWorkspaceMembership(
    db: SettingsDb,
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMembership | undefined> {
    return db
      .selectFrom("app.workspace_memberships")
      .selectAll()
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  private async requireUserRow(userId: string, db: SettingsDb = this.db): Promise<User> {
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(db);
    const user = result.rows[0];
    if (!user) {
      throw new HttpRepositoryError(404, "User not found");
    }
    return user;
  }

  async assertNotLastActiveAdmin(excludingUserId: string): Promise<void> {
    await this.assertAnotherActiveAdmin(this.db, excludingUserId);
  }

  private async assertAnotherActiveAdmin(db: SettingsDb, excludingUserId: string): Promise<void> {
    const result = await sql<{ id: string }>`
      SELECT id FROM app.list_all_users()
      WHERE is_instance_admin = true AND status = 'active' AND id != ${excludingUserId}::uuid
      LIMIT 1
    `.execute(db);
    if (!result.rows[0]) {
      throw new HttpRepositoryError(409, "Cannot remove the last active admin");
    }
  }

  private async insertAuditEvent(
    db: SettingsDb,
    input: {
      readonly actorUserId: string;
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string | null;
      readonly metadata: Record<string, unknown>;
      readonly requestId: string;
    }
  ): Promise<void> {
    await db
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
