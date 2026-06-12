import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import type { AccessContext, AdminAuditEvent, InstanceSetting, JarvisDatabase, User } from "@jarv1s/db";
import {
  adminDeleteUserRouteSchema,
  adminRejectUserRouteSchema,
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

import { deleteUserData } from "../../../scripts/delete-user-data.js";
import { HttpRepositoryError, SettingsRepository } from "./repository.js";

export interface SettingsRoutesDependencies {
  readonly appDb: Kysely<JarvisDatabase>;
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
  const repository = dependencies.repository ?? new SettingsRepository(dependencies.appDb);

  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    const userCount = await repository.countUsers();

    return {
      needsBootstrap: userCount === 0,
      userCount
    };
  });

  server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const user = await requireKnownUser(repository, accessContext.actorUserId);

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
        await requireAdmin(request, dependencies, repository);

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
      await requireAdmin(request, dependencies, repository);
      const users = await repository.listUsers();

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
        await requireAdmin(request, dependencies, repository);
        const settings = await repository.listInstanceSettings();

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
        const accessContext = await requireAdmin(request, dependencies, repository);
        const body = parseInstanceSettingBody(request.body);
        const setting = await repository.upsertInstanceSetting({
          key: request.params.key,
          value: body.value,
          updatedByUserId: accessContext.actorUserId,
          requestId: requireRequestId(accessContext)
        });

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
        const accessContext = await requireAdmin(request, dependencies, repository);
        const { id } = request.params as { id: string };
        const existing = await repository.getUserById(id);
        if (!existing) throw new HttpError(404, "User not found");
        if (existing.status !== "pending")
          throw new HttpError(409, "Only pending accounts can be approved");
        const user = await repository.setUserStatus({
          targetUserId: id,
          status: "active",
          action: "user.approve",
          actorUserId: accessContext.actorUserId,
          requestId: requireRequestId(accessContext)
        });
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
          const accessContext = await requireAdmin(request, dependencies, repository);
          const { id } = request.params as { id: string };
          const user = await repository.setUserStatus({
            targetUserId: id,
            status,
            action,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
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

  const adminFlagAction = (verb: "promote" | "demote", isInstanceAdmin: boolean) =>
    server.post(
      `/api/admin/users/:id/${verb}`,
      { schema: adminUserActionRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await requireAdmin(request, dependencies, repository);
          const { id } = request.params as { id: string };
          const user = await repository.setUserAdmin({
            targetUserId: id,
            isInstanceAdmin,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
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
    const accessContext = await requireAdmin(request, dependencies, repository);
    const existing = await repository.getUserById(id);
    if (!existing) throw new HttpError(404, "User not found");
    if (requirePending && existing.status !== "pending") {
      throw new HttpError(409, "Only pending accounts can be rejected");
    }
    if (id === accessContext.actorUserId)
      throw new HttpError(422, "You cannot delete your own account");
    if (existing.is_bootstrap_owner)
      throw new HttpError(409, "The bootstrap owner cannot be deleted");
    if (existing.is_instance_admin) await repository.assertNotLastActiveAdmin(id);
    await deleteUserData({
      userId: id,
      confirmUserId: id,
      actorUserId: accessContext.actorUserId,
      requestId: requireRequestId(accessContext),
      bootstrapConnectionString: dependencies.bootstrapConnectionString,
      dryRun: false
    });
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
        await requireAdmin(request, dependencies, repository);
        return await repository.getRegistrationSettings();
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
        const accessContext = await requireAdmin(request, dependencies, repository);
        const body = request.body as { registrationEnabled: boolean; requiresApproval: boolean };
        return await repository.setRegistrationSettings({
          registrationEnabled: body.registrationEnabled,
          requiresApproval: body.requiresApproval,
          actorUserId: accessContext.actorUserId,
          requestId: requireRequestId(accessContext)
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
        await requireAdmin(request, dependencies, repository);
        const auditEvents = await repository.listAdminAuditEvents();

        return { auditEvents: auditEvents.map(serializeAdminAuditEvent) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

async function requireAdmin(
  request: FastifyRequest,
  dependencies: SettingsRoutesDependencies,
  repository: SettingsRepository
): Promise<AccessContext> {
  const accessContext = await dependencies.resolveAccessContext(request);
  const user = await requireKnownUser(repository, accessContext.actorUserId);

  if (!user.is_instance_admin) {
    throw new HttpError(403, "Instance admin permission is required");
  }

  return accessContext;
}

async function requireKnownUser(repository: SettingsRepository, userId: string): Promise<User> {
  const user = await repository.getUserById(userId);

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

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
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
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  if (error instanceof HttpRepositoryError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "account_pending_approval" || code === "account_deactivated") {
      return reply.code(403).send({ error: error.message, code });
    }
    if (error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Invalid bearer token") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "User not found") {
      return reply.code(400).send({ error: error.message });
    }
  }

  throw error;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
