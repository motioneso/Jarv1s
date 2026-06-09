import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import type {
  AccessContext,
  ConnectorAccountStatus,
  ConnectorProvider,
  DataContextRunner,
  JarvisDatabase
} from "@jarv1s/db";
import {
  createConnectorAccountRouteSchema,
  googleAuthorizeRouteSchema,
  googleCompleteRouteSchema,
  listAdminConnectorAccountsRouteSchema,
  listConnectorAccountsRouteSchema,
  listConnectorProvidersRouteSchema,
  revokeConnectorAccountRouteSchema,
  updateConnectorAccountRouteSchema,
  type ConnectorAccountDto,
  type ConnectorProviderDto,
  type CreateConnectorAccountRequest,
  type GoogleAuthorizeRequest,
  type GoogleCompleteRequest,
  type UpdateConnectorAccountRequest
} from "@jarv1s/shared";

import { createConnectorSecretCipher, type ConnectorSecretCipher } from "./crypto.js";
import { GoogleConnectionService, GoogleConnectError } from "./google-connection.js";
import { GoogleOAuthClient } from "./oauth.js";
import { ConnectorsRepository, type ConnectorAccountSafeRow } from "./repository.js";

export interface ConnectorsRoutesDependencies {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: ConnectorsRepository;
  readonly secretCipher?: ConnectorSecretCipher;
  readonly googleService?: GoogleConnectionService;
}

interface AccountParams {
  readonly id: string;
}

export function registerConnectorsRoutes(
  server: FastifyInstance,
  dependencies: ConnectorsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new ConnectorsRepository();
  const secretCipher = dependencies.secretCipher ?? createConnectorSecretCipher();
  const googleService =
    dependencies.googleService ??
    new GoogleConnectionService({
      repository,
      cipher: secretCipher,
      oauthClient: new GoogleOAuthClient()
    });

  server.post(
    "/api/connectors/google/authorize",
    { schema: googleAuthorizeRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as GoogleAuthorizeRequest;
        const clientId = requiredString(body.clientId, "clientId");
        const clientSecret = requiredString(body.clientSecret, "clientSecret");
        const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          googleService.startAuthorization(scopedDb, { clientId, clientSecret })
        );
        return result;
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const oauthMax = Number(process.env.JARVIS_RL_OAUTH_MAX ?? 5);

  server.post(
    "/api/connectors/google/complete",
    { schema: googleCompleteRouteSchema, config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as GoogleCompleteRequest;
        const redirectUrl = requiredString(body.redirectUrl, "redirectUrl");
        const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          googleService.completeAuthorization(scopedDb, { redirectUrl })
        );
        return reply.code(201).send({ account: serializeAccount(account) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/connectors/providers",
    { schema: listConnectorProvidersRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const providers = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.listProviders(scopedDb)
        );

        return { providers: providers.map(serializeProvider) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/connectors/accounts",
    { schema: listConnectorAccountsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const accounts = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listAccounts(scopedDb)
        );

        return { accounts: accounts.map(serializeAccount) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/connectors/accounts",
    { schema: createConnectorAccountRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseCreateAccountBody(request.body);
        const encryptedSecret = secretCipher.encryptJson(body.tokenPayload);
        const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.createAccount(scopedDb, {
            providerId: body.providerId,
            scopes: body.scopes ?? [],
            status: body.status ?? "active",
            encryptedSecret
          })
        );

        return reply.code(201).send({ account: serializeAccount(account) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: AccountParams }>(
    "/api/connectors/accounts/:id",
    { schema: updateConnectorAccountRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseUpdateAccountBody(request.body);
        const encryptedSecret =
          body.tokenPayload === undefined ? undefined : secretCipher.encryptJson(body.tokenPayload);
        const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.updateAccount(scopedDb, request.params.id, {
            scopes: body.scopes,
            status: body.status,
            encryptedSecret
          })
        );

        if (!account) {
          return reply.code(404).send({ error: "Connector account not found" });
        }

        return { account: serializeAccount(account) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: AccountParams }>(
    "/api/connectors/accounts/:id/revoke",
    { schema: revokeConnectorAccountRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const encryptedSecret = secretCipher.encryptJson({ revoked: true });
        const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.revokeAccount(scopedDb, request.params.id, encryptedSecret)
        );

        if (!account) {
          return reply.code(404).send({ error: "Connector account not found" });
        }

        return { account: serializeAccount(account) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/connectors/accounts",
    { schema: listAdminConnectorAccountsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await requireAdmin(request, dependencies);
        const accounts = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listAdminSafeAccounts(scopedDb)
        );

        return { accounts: accounts.map(serializeAccount) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateAccountBody(body: unknown): CreateConnectorAccountRequest {
  const value = requireObject(body);

  return {
    providerId: requiredString(value.providerId, "providerId"),
    scopes: optionalStringArray(value.scopes, "scopes"),
    status: optionalWritableAccountStatus(value.status),
    tokenPayload: requiredJsonObject(value.tokenPayload, "tokenPayload")
  };
}

function parseUpdateAccountBody(body: unknown): UpdateConnectorAccountRequest {
  const value = requireObject(body);

  return {
    scopes: optionalStringArray(value.scopes, "scopes"),
    status: optionalWritableAccountStatus(value.status),
    tokenPayload:
      value.tokenPayload === undefined
        ? undefined
        : requiredJsonObject(value.tokenPayload, "tokenPayload")
  };
}

async function requireAdmin(
  request: FastifyRequest,
  dependencies: ConnectorsRoutesDependencies
): Promise<AccessContext> {
  const accessContext = await dependencies.resolveAccessContext(request);
  const user = await dependencies.appDb
    .selectFrom("app.users")
    .select(["id", "is_instance_admin"])
    .where("id", "=", accessContext.actorUserId)
    .executeTakeFirst();

  if (!user) {
    throw new HttpError(401, "Session is missing or expired");
  }
  if (!user.is_instance_admin) {
    throw new HttpError(403, "Instance admin permission is required");
  }

  return accessContext;
}

function serializeProvider(provider: ConnectorProvider): ConnectorProviderDto {
  return {
    id: provider.provider_id,
    providerType: provider.provider_type,
    displayName: provider.display_name,
    status: provider.status,
    defaultScopes: provider.default_scopes,
    createdAt: serializeDate(provider.created_at),
    updatedAt: serializeDate(provider.updated_at)
  };
}

function serializeAccount(account: ConnectorAccountSafeRow): ConnectorAccountDto {
  return {
    id: account.id,
    providerId: account.provider_id,
    providerType: account.provider_type,
    providerDisplayName: account.provider_display_name,
    providerStatus: account.provider_status,
    ownerUserId: account.owner_user_id,
    scopes: account.scopes,
    status: account.status,
    hasSecret: account.has_secret,
    revokedAt: toIsoString(account.revoked_at),
    createdAt: serializeDate(account.created_at),
    updatedAt: serializeDate(account.updated_at)
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function requiredJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value, fieldName);

  if (!parsed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return parsed;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((item, index) => requiredString(item, `${fieldName}[${index}]`));
}

function optionalWritableAccountStatus(
  value: unknown
): Exclude<ConnectorAccountStatus, "revoked"> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "active" || value === "error") {
    return value;
  }

  throw new HttpError(400, "status must be active or error");
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof GoogleConnectError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  if (error instanceof Error) {
    if (error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Invalid bearer token") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Workspace context is unavailable") {
      return reply.code(403).send({ error: error.message });
    }
    if (
      error.message.includes("foreign key") ||
      error.message.includes("violates row-level security policy")
    ) {
      return reply.code(400).send({ error: "Connector account request is invalid" });
    }
  }

  throw error;
}
