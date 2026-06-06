import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ConnectorsRepository,
  connectorsModuleManifest,
  createConnectorSecretCipher,
  type EncryptedConnectorSecret
} from "@jarv1s/connectors";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("Connectors encrypted foundation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: ConnectorsRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";

    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new ConnectorsRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
    } else {
      process.env.JARVIS_CONNECTOR_SECRET_KEY = originalSecretKey;
    }
  });

  it("applies connector migrations with forced RLS and no worker table grant", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version IN ('0009', '0010')
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_select: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('connector_definitions', 'connector_accounts')
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([
        { version: "0009", name: "0009_connectors_module.sql" },
        { version: "0010", name: "0010_connector_admin_safe_metadata.sql" }
      ]);
      expect(tables.rows).toEqual([
        {
          relname: "connector_accounts",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        },
        {
          relname: "connector_definitions",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads the built-in Connectors module manifest without queues", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const registration = registrations.find(
      (item) => item.manifest.id === connectorsModuleManifest.id
    );
    const manifest = manifests.find((item) => item.id === connectorsModuleManifest.id);

    expect(manifests.map((item) => item.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(registrations.map((item) => item.manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(manifest?.database?.ownedTables).toEqual([
      "app.connector_definitions",
      "app.connector_accounts"
    ]);
    expect(manifest?.settings?.map((surface) => surface.path)).toEqual([
      "/settings/connectors",
      "/settings/admin/connectors"
    ]);
    expect(registration?.queueDefinitions).toEqual([]);
    expect(getBuiltInSqlMigrationDirectories().at(-1)).toContain("packages/briefings/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-2)).toContain("packages/chat/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-3)).toContain("packages/ai/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-4)).toContain("packages/email/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-5)).toContain("packages/calendar/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-6)).toContain("packages/notifications/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-7)).toContain("packages/notes/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-8)).toContain("packages/tasks/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-9)).toContain("packages/connectors/sql");
  });

  it("requires an explicit connector secret key in production", () => {
    expect(() =>
      createConnectorSecretCipher({
        NODE_ENV: "production"
      })
    ).toThrow("JARVIS_CONNECTOR_SECRET_KEY is required in production");
  });

  it("serves configured connector providers without secret material", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/connectors/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const body = response.json<{ providers: Array<{ id: string; defaultScopes: string[] }> }>();

    expect(response.statusCode).toBe(200);
    expect(body.providers.map((provider) => provider.id)).toEqual([
      "google-calendar",
      "microsoft-calendar",
      "google-email",
      "microsoft-email"
    ]);
    expect(response.body).not.toContain("secret");
    expect(body.providers[0]?.defaultScopes).toContain(
      "https://www.googleapis.com/auth/calendar.readonly"
    );
  });

  it("encrypts placeholder token JSON at rest and never returns secrets through account APIs", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerId: "google-calendar",
        scopes: ["calendar.readonly"],
        tokenPayload: {
          accessToken: "secret-access-token",
          refreshToken: "secret-refresh-token"
        }
      }
    });
    const account = createResponse.json<{ account: { id: string; hasSecret: boolean } }>().account;
    const encryptedSecret = await readEncryptedSecret(account.id);
    const encryptedJson = JSON.stringify(encryptedSecret);
    const decrypted = createConnectorSecretCipher().decryptJson(encryptedSecret);
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(account.hasSecret).toBe(true);
    expect(createResponse.body).not.toContain("secret-access-token");
    expect(createResponse.body).not.toContain("encrypted_secret");
    expect(createResponse.body).not.toContain("ciphertext");
    expect(encryptedJson).not.toContain("secret-access-token");
    expect(encryptedJson).not.toContain("secret-refresh-token");
    expect(decrypted).toEqual({
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token"
    });
    expect(listResponse.body).not.toContain("secret-access-token");
    expect(listResponse.body).not.toContain("ciphertext");
  });

  it("keeps connector accounts isolated by owner and exposes admin-safe metadata only", async () => {
    const userBAccount = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createAccount(scopedDb, {
        providerId: "microsoft-email",
        scopes: ["Mail.Read"],
        encryptedSecret: createConnectorSecretCipher().encryptJson({
          accessToken: "user-b-secret"
        })
      })
    );
    const userAReadUserB = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listAccounts(scopedDb)
    );
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin");
    const adminNormalList = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.listAccounts(scopedDb)
    );
    const adminAccount = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.createAccount(scopedDb, {
        providerId: "google-email",
        scopes: ["gmail.readonly"],
        encryptedSecret: createConnectorSecretCipher().encryptJson({
          accessToken: "admin-secret"
        })
      })
    );
    const adminResponse = await server.inject({
      method: "GET",
      url: "/api/admin/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionAdmin}`
      }
    });
    const memberAdminResponse = await server.inject({
      method: "GET",
      url: "/api/admin/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(userAReadUserB.some((account) => account.id === userBAccount.id)).toBe(false);
    expect(adminNormalList.some((account) => account.id === userBAccount.id)).toBe(false);
    expect(memberAdminResponse.statusCode).toBe(403);
    expect(adminResponse.statusCode).toBe(200);
    expect(
      adminResponse
        .json<{ accounts: Array<{ id: string }> }>()
        .accounts.some((account) => account.id === userBAccount.id)
    ).toBe(true);
    expect(
      adminResponse
        .json<{ accounts: Array<{ id: string }> }>()
        .accounts.some((account) => account.id === adminAccount.id)
    ).toBe(true);
    expect(adminResponse.body).not.toContain("user-b-secret");
    expect(adminResponse.body).not.toContain("admin-secret");
    expect(adminResponse.body).not.toContain("encrypted_secret");
    expect(adminResponse.body).not.toContain("ciphertext");
  });

  it("requires active workspace context for workspace-scoped connector accounts", async () => {
    const missingWorkspaceHeader = await server.inject({
      method: "POST",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerId: "microsoft-calendar",
        workspaceId: ids.workspaceAlpha,
        tokenPayload: {
          accessToken: "workspace-secret"
        }
      }
    });
    const nonMemberWorkspaceHeader = await server.inject({
      method: "POST",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionB}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      },
      payload: {
        providerId: "microsoft-calendar",
        workspaceId: ids.workspaceAlpha,
        tokenPayload: {
          accessToken: "workspace-secret"
        }
      }
    });
    const createWorkspaceAccount = await server.inject({
      method: "POST",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      },
      payload: {
        providerId: "microsoft-calendar",
        workspaceId: ids.workspaceAlpha,
        tokenPayload: {
          accessToken: "workspace-secret"
        }
      }
    });
    const workspaceAccountId = createWorkspaceAccount.json<{ account: { id: string } }>().account
      .id;
    const listWithoutWorkspace = await server.inject({
      method: "GET",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const listWithWorkspace = await server.inject({
      method: "GET",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });

    expect(missingWorkspaceHeader.statusCode).toBe(400);
    expect(nonMemberWorkspaceHeader.statusCode).toBe(403);
    expect(createWorkspaceAccount.statusCode).toBe(201);
    expect(
      listWithoutWorkspace
        .json<{ accounts: Array<{ id: string }> }>()
        .accounts.some((account) => account.id === workspaceAccountId)
    ).toBe(false);
    expect(
      listWithWorkspace
        .json<{ accounts: Array<{ id: string }> }>()
        .accounts.some((account) => account.id === workspaceAccountId)
    ).toBe(true);
  });

  it("updates and revokes connector accounts without leaking replacement token material", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/connectors/accounts",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerId: "google-email",
        scopes: ["gmail.readonly"],
        tokenPayload: {
          accessToken: "token-before-update"
        }
      }
    });
    const accountId = createResponse.json<{ account: { id: string } }>().account.id;
    const updateResponse = await server.inject({
      method: "PATCH",
      url: `/api/connectors/accounts/${accountId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        scopes: ["gmail.readonly", "profile"],
        status: "error",
        tokenPayload: {
          accessToken: "token-after-update"
        }
      }
    });
    const updatedSecret = await readEncryptedSecret(accountId);
    const revokeResponse = await server.inject({
      method: "POST",
      url: `/api/connectors/accounts/${accountId}/revoke`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const revokedSecret = await readEncryptedSecret(accountId);

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.body).not.toContain("token-after-update");
    expect(updateResponse.json()).toMatchObject({
      account: {
        id: accountId,
        status: "error",
        scopes: ["gmail.readonly", "profile"],
        hasSecret: true
      }
    });
    expect(createConnectorSecretCipher().decryptJson(updatedSecret)).toEqual({
      accessToken: "token-after-update"
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.body).not.toContain("token-after-update");
    expect(revokeResponse.json()).toMatchObject({
      account: {
        id: accountId,
        status: "revoked",
        revokedAt: expect.any(String)
      }
    });
    expect(createConnectorSecretCipher().decryptJson(revokedSecret)).toEqual({
      revoked: true
    });
  });

  it("fails loudly when the Connectors repository is called without withDataContext", async () => {
    await expect(repository.listAccounts({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});

async function readEncryptedSecret(accountId: string): Promise<EncryptedConnectorSecret> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    const row = await client.query<{ encrypted_secret: EncryptedConnectorSecret }>(
      `
        SELECT encrypted_secret
        FROM app.connector_accounts
        WHERE id = $1
      `,
      [accountId]
    );

    const encryptedSecret = row.rows[0]?.encrypted_secret;

    if (!encryptedSecret) {
      throw new Error(`Missing connector account ${accountId}`);
    }

    return encryptedSecret;
  } finally {
    await client.end();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId: null,
    requestId: "request:user-a-connectors"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    workspaceId: null,
    requestId: "request:user-b-connectors"
  };
}
