import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import type {
  AccessContext,
  AdminAuditEvent,
  DataContextDb,
  DataContextRunner,
  InstanceSetting,
  JarvisDatabase,
  User
} from "@jarv1s/db";
import {
  adminDeleteUserRouteSchema,
  adminRejectUserRouteSchema,
  adminRevokeSessionsRouteSchema,
  adminUserActionRouteSchema,
  bootstrapStatusRouteSchema,
  getRegistrationSettingsRouteSchema,
  listAdminAuditEventsRouteSchema,
  listAuthProviderStatusesRouteSchema,
  listInstanceSettingsRouteSchema,
  listUsersRouteSchema,
  meRouteSchema,
  putRegistrationSettingsRouteSchema,
  upsertInstanceSettingRouteSchema,
  type AdminAuditEventDto,
  type AuthProviderStatusDto,
  type InstanceSettingDto,
  type UpsertInstanceSettingRequest,
  type UserDto
} from "@jarv1s/shared";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";

import { deleteUserData, LastActiveAdminError } from "../../../scripts/delete-user-data.js";
import { BootstrapHelper } from "./bootstrap.js";
import { HttpRepositoryError, SettingsRepository } from "./repository.js";

export interface SettingsRoutesDependencies {
  // Documented Kysely< exemption: rootDb exists ONLY to construct BootstrapHelper
  // (countUsers — runs before any session/actor exists, so withDataContext cannot be used).
  // See the SOLE-exemption comment in packages/settings/src/bootstrap.ts.
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders?: () => readonly AuthProviderStatusDto[];
  readonly repository?: SettingsRepository;
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  readonly bootstrapConnectionString?: string;
}

interface SettingParams {
  readonly key: string;
}

export function registerSettingsRoutes(
  server: FastifyInstance,
  dependencies: SettingsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new SettingsRepository();
  const bootstrapHelper = new BootstrapHelper(dependencies.rootDb);

  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    // Return only the boolean the client needs. The raw user count is an instance-wide
    // metric exposed on an UNAUTHENTICATED route — do not leak it (OTNR-P4 #122).
    const userCount = await bootstrapHelper.countUsers();

    return {
      needsBootstrap: userCount === 0
    };
  });

  server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const user = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        requireKnownUser(repository, scopedDb, accessContext.actorUserId)
      );

      return {
        user: serializeUser(user)
      };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/admin/auth/providers",
    { schema: listAuthProviderStatusesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          assertAdminUser(repository, scopedDb, accessContext.actorUserId)
        );

        return {
          providers: dependencies.listConfiguredAuthProviders?.() ?? []
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get("/api/admin/users", { schema: listUsersRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const users = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.listUsers(scopedDb);
        }
      );

      return { users: users.map(serializeUser) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/admin/settings",
    { schema: listInstanceSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.listInstanceSettings(scopedDb);
          }
        );

        return { settings: settings.map(serializeInstanceSetting) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: SettingParams }>(
    "/api/admin/settings/:key",
    { schema: upsertInstanceSettingRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseInstanceSettingBody(request.body);
        const setting = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.upsertInstanceSetting(scopedDb, {
              key: request.params.key,
              value: body.value,
              updatedByUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
        );

        return { setting: serializeInstanceSetting(setting) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/admin/users/:id/approve",
    { schema: adminUserActionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const user = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            const existing = await repository.getUserById(scopedDb, id);
            if (!existing) throw new HttpError(404, "User not found");
            if (existing.status !== "pending")
              throw new HttpError(409, "Only pending accounts can be approved");
            return repository.setUserStatus(scopedDb, {
              targetUserId: id,
              status: "active",
              action: "user.approve",
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
        );
        return { user: serializeUser(user) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const lifecycleAction = (verb: string, status: "active" | "deactivated", action: string) =>
    server.post(
      `/api/admin/users/:id/${verb}`,
      { schema: adminUserActionRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const { id } = request.params as { id: string };
          const user = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              return repository.setUserStatus(scopedDb, {
                targetUserId: id,
                status,
                action,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
          );
          if (verb === "deactivate" && dependencies.revokeUserSessions) {
            await dependencies.revokeUserSessions(id);
          }
          return { user: serializeUser(user) };
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  lifecycleAction("reactivate", "active", "user.reactivate");
  lifecycleAction("deactivate", "deactivated", "user.deactivate");

  server.post(
    "/api/admin/users/:id/revoke-sessions",
    { schema: adminRevokeSessionsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        // Admin check + target existence check share ONE transaction (post-D pattern).
        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          const target = await repository.getUserById(scopedDb, id);
          if (!target) throw new HttpError(404, "User not found");
        });
        // revokeUserSessions runs on the auth pool (DELETE ... WHERE user_id = id) — outside
        // the data context. It targets the named user's sessions only, never the calling
        // admin's. The response carries the deleted-row count and nothing from the session row.
        const count = dependencies.revokeUserSessions
          ? await dependencies.revokeUserSessions(id)
          : 0;
        return { success: true, count };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const adminFlagAction = (verb: "promote" | "demote", isInstanceAdmin: boolean) =>
    server.post(
      `/api/admin/users/:id/${verb}`,
      { schema: adminUserActionRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const { id } = request.params as { id: string };
          const user = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              return repository.setUserAdmin(scopedDb, {
                targetUserId: id,
                isInstanceAdmin,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
          );
          return { user: serializeUser(user) };
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  adminFlagAction("promote", true);
  adminFlagAction("demote", false);

  async function tearDownAccount(
    request: FastifyRequest,
    id: string,
    requirePending: boolean
  ): Promise<string> {
    const accessContext = await dependencies.resolveAccessContext(request);
    await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
      // Guard order preserved from the original routes.ts (404 → pending-409 → self-422
      // → bootstrap-409 → last-admin-409). Do not reorder.
      await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
      const existing = await repository.getUserById(scopedDb, id);
      if (!existing) throw new HttpError(404, "User not found");
      if (requirePending && existing.status !== "pending") {
        throw new HttpError(409, "Only pending accounts can be rejected");
      }
      if (id === accessContext.actorUserId)
        throw new HttpError(422, "You cannot delete your own account");
      if (existing.is_bootstrap_owner)
        throw new HttpError(409, "The bootstrap owner cannot be deleted");
      if (existing.is_instance_admin) await repository.assertNotLastActiveAdmin(scopedDb, id);
    });
    // The pre-check above is a fast-path 409 for the common case; it commits and
    // releases its advisory lock before deleteUserData runs. deleteUserData
    // re-asserts the last-admin guard under the same lock inside its own
    // transaction, so it is the authoritative serialized check. Map its typed
    // failure back to a 409 if a concurrent removal won the race (#94).
    try {
      await deleteUserData({
        userId: id,
        confirmUserId: id,
        actorUserId: accessContext.actorUserId,
        requestId: requireRequestId(accessContext),
        bootstrapConnectionString: dependencies.bootstrapConnectionString,
        dryRun: false
      });
    } catch (error) {
      if (error instanceof LastActiveAdminError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
    return id;
  }

  server.post(
    "/api/admin/users/:id/reject",
    { schema: adminRejectUserRouteSchema },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const rejectedUserId = await tearDownAccount(request, id, true);
        return { rejectedUserId };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/admin/users/:id",
    { schema: adminDeleteUserRouteSchema },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const deletedUserId = await tearDownAccount(request, id, false);
        return { deletedUserId };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/registration",
    { schema: getRegistrationSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.getRegistrationSettings(scopedDb);
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/admin/registration",
    { schema: putRegistrationSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as { registrationEnabled: boolean; requiresApproval: boolean };
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.setRegistrationSettings(scopedDb, {
            registrationEnabled: body.registrationEnabled,
            requiresApproval: body.requiresApproval,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/audit-events",
    { schema: listAdminAuditEventsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const auditEvents = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.listAdminAuditEvents(scopedDb);
          }
        );

        return { auditEvents: auditEvents.map(serializeAdminAuditEvent) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

// The admin check happens INSIDE the route's withDataContext so the admin check and the
// actual operation share one transaction. assertAdminUser/requireKnownUser take scopedDb
// from that transaction — there is no nested withDataContext and no DB-holding helper.
async function assertAdminUser(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<User> {
  const user = await requireKnownUser(repository, scopedDb, userId);
  if (!user.is_instance_admin) {
    throw new HttpError(403, "Instance admin permission is required");
  }
  return user;
}

async function requireKnownUser(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<User> {
  const user = await repository.getUserById(scopedDb, userId);

  if (!user) {
    throw new HttpError(401, "Session is missing or expired");
  }

  return user;
}

function requireRequestId(accessContext: AccessContext): string {
  if (!accessContext.requestId) {
    throw new HttpError(500, "Request id is missing");
  }

  return accessContext.requestId;
}

function parseInstanceSettingBody(body: unknown): UpsertInstanceSettingRequest {
  const value = requireObject(body);
  const settingValue = value.value;

  if (!settingValue || typeof settingValue !== "object" || Array.isArray(settingValue)) {
    throw new HttpError(400, "value must be a JSON object");
  }

  return {
    value: settingValue as Record<string, unknown>
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isInstanceAdmin: user.is_instance_admin,
    status: user.status,
    isBootstrapOwner: user.is_bootstrap_owner,
    createdAt: serializeDate(user.created_at),
    updatedAt: serializeDate(user.updated_at)
  };
}

function serializeInstanceSetting(setting: InstanceSetting): InstanceSettingDto {
  return {
    key: setting.key,
    value: setting.value,
    updatedByUserId: setting.updated_by_user_id,
    createdAt: serializeDate(setting.created_at),
    updatedAt: serializeDate(setting.updated_at)
  };
}

function serializeAdminAuditEvent(event: AdminAuditEvent): AdminAuditEventDto {
  return {
    id: event.id,
    actorUserId: event.actor_user_id,
    action: event.action,
    targetType: event.target_type,
    targetId: event.target_id,
    metadata: event.metadata,
    requestId: event.request_id,
    createdAt: serializeDate(event.created_at)
  };
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    mappers: [
      (e, r) =>
        e instanceof HttpRepositoryError
          ? r.code(e.statusCode).send({ error: e.message })
          : undefined,
      (e, r) => {
        if (e instanceof Error) {
          const code = (e as Error & { code?: string }).code;
          if (code === "account_pending_approval" || code === "account_deactivated") {
            return r.code(403).send({ error: e.message, code });
          }
        }
        return undefined;
      }
    ]
  });
}
