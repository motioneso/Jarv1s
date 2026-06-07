import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  SharesRepository,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import { ChatRepository, chatModuleManifest } from "@jarv1s/chat";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const chatIds = {
  userBPrivateThread: "60000000-0000-4000-8000-000000000001",
  userBWorkspaceThread: "60000000-0000-4000-8000-000000000002"
} as const;

describe("Chat module M6 thin slice", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;
  let sharesRepository: SharesRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-chat-ai-secret-key";

    await resetFoundationDatabase();
    await seedChatData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
    sharesRepository = new SharesRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("applies Chat migrations with forced RLS and no worker table grants", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version = '0014'
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_has_access: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            (
              has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'INSERT')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'UPDATE')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE')
            ) AS worker_has_access
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('chat_threads', 'chat_messages')
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([{ version: "0014", name: "0014_chat_module.sql" }]);
      expect(tables.rows).toEqual([
        {
          relname: "chat_messages",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_has_access: false
        },
        {
          relname: "chat_threads",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_has_access: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads Chat as a required built-in module without queues", () => {
    const manifests = getBuiltInModuleManifests();
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === chatModuleManifest.id
    );
    const manifest = manifests.find((item) => item.id === chatModuleManifest.id);

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
    expect(manifest?.database?.ownedTables).toEqual(["app.chat_threads", "app.chat_messages"]);
    expect(manifest?.navigation?.[0]).toMatchObject({
      id: "chat",
      path: "/chat",
      permissionId: "chat.view"
    });
    expect(registration?.queueDefinitions).toEqual([]);
    expect(getBuiltInSqlMigrationDirectories().at(-2)).toContain("packages/chat/sql");
  });

  it("keeps chat threads private by default and denies admin private-data bypass", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createThread(scopedDb, {
        title: "User A private chat"
      })
    );
    const userARead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getThreadById(scopedDb, created.id)
    );
    const userBRead = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getThreadById(scopedDb, created.id)
    );
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin-chat");
    const adminRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getThreadById(scopedDb, chatIds.userBPrivateThread)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(created.visibility).toBe("private");
    expect(userARead?.id).toBe(created.id);
    expect(userBRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("requires active workspace context for workspace-visible chat creation", async () => {
    const missingWorkspaceResponse = await server.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "Workspace chat",
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });
    const createdResponse = await server.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      },
      payload: {
        title: "Workspace chat",
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });
    const created = createdResponse.json<{ thread: { id: string; workspaceId: string | null } }>()
      .thread;
    const listedResponse = await server.inject({
      method: "GET",
      url: "/api/chat/threads",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });

    expect(missingWorkspaceResponse.statusCode).toBe(400);
    expect(createdResponse.statusCode).toBe(201);
    expect(created.workspaceId).toBe(ids.workspaceAlpha);
    expect(
      listedResponse
        .json<{ threads: Array<{ id: string }> }>()
        .threads.some((thread) => thread.id === created.id)
    ).toBe(true);
  });

  it("share grantee with manage can update timestamp but not title on another user's thread", async () => {
    // Grant userA 'manage' access to userB's workspace thread via shares
    await dataContext.withDataContext(
      { actorUserId: ids.userB, workspaceId: ids.workspaceAlpha, requestId: "request:setup-share" },
      (scopedDb) =>
        sharesRepository.grant(scopedDb, {
          resourceType: "chat_thread",
          resourceId: chatIds.userBWorkspaceThread,
          ownerUserId: ids.userB,
          granteeUserId: ids.userA,
          level: "manage"
        })
    );

    const sharedThread = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) => repository.getThreadById(scopedDb, chatIds.userBWorkspaceThread)
    );
    const refreshedThread = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) =>
        scopedDb.db
          .updateTable("app.chat_threads")
          .set({
            updated_at: "2030-01-01T00:00:00.000Z"
          })
          .where("id", "=", chatIds.userBWorkspaceThread)
          .returning("id")
          .executeTakeFirst()
    );

    await expect(
      dataContext.withDataContext(userAContext(ids.workspaceAlpha), (scopedDb) =>
        scopedDb.db
          .updateTable("app.chat_threads")
          .set({
            title: "User A should not retitle another user's workspace chat",
            updated_at: "2030-01-02T00:00:00.000Z"
          })
          .where("id", "=", chatIds.userBWorkspaceThread)
          .execute()
      )
    ).rejects.toThrow("workspace chat participants cannot change chat thread title");

    expect(sharedThread?.id).toBe(chatIds.userBWorkspaceThread);
    expect(refreshedThread?.id).toBe(chatIds.userBWorkspaceThread);
  });

  it("non-owner without share cannot see another user's thread; share grants visibility", async () => {
    // userA cannot see userB's private thread without a share
    const beforeShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getThreadById(scopedDb, chatIds.userBPrivateThread)
    );
    expect(beforeShare).toBeUndefined();

    // Grant userA 'view' access to userB's private thread
    await dataContext.withDataContext(
      { actorUserId: ids.userB, workspaceId: null, requestId: "request:share-private-thread" },
      (scopedDb) =>
        sharesRepository.grant(scopedDb, {
          resourceType: "chat_thread",
          resourceId: chatIds.userBPrivateThread,
          ownerUserId: ids.userB,
          granteeUserId: ids.userA,
          level: "view"
        })
    );

    const afterShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getThreadById(scopedDb, chatIds.userBPrivateThread)
    );
    expect(afterShare?.id).toBe(chatIds.userBPrivateThread);
  });

  it("appends a user message and deterministic assistant metadata without provider/tool execution", async () => {
    const taskResponse = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "Task must not be mutated by chat"
      }
    });
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerKind: "anthropic",
        displayName: "Anthropic Chat",
        credentialPayload: {
          apiKey: "chat-secret-key"
        }
      }
    });
    const providerId = providerResponse.json<{ provider: { id: string } }>().provider.id;
    await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-chat",
        displayName: "Claude Chat",
        capabilities: ["chat", "tool-use"]
      }
    });
    const threadResponse = await server.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "No execution chat"
      }
    });
    const threadId = threadResponse.json<{ thread: { id: string } }>().thread.id;
    const appendResponse = await server.inject({
      method: "POST",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        body: "Please mark the task done, but this slice must not execute tools.",
        selectedToolNames: ["tasks.updateStatus"]
      }
    });
    const taskId = taskResponse.json<{ task: { id: string } }>().task.id;
    const taskAfterChatResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const assistantMessage = appendResponse.json<{
      messages: Array<{
        role: string;
        status: string;
        modelRoute: { available: boolean; model: { displayName: string } | null } | null;
        tools: Array<{ name: string; permissionId: string; risk: string }>;
      }>;
    }>().messages[1];

    expect(appendResponse.statusCode).toBe(201);
    expect(assistantMessage).toMatchObject({
      role: "assistant",
      status: "blocked",
      modelRoute: {
        available: true,
        model: {
          displayName: "Claude Chat"
        }
      },
      tools: [
        {
          name: "tasks.updateStatus",
          permissionId: "tasks.update",
          risk: "write"
        }
      ]
    });
    expect(taskAfterChatResponse.json<{ task: { status: string } }>().task.status).toBe("todo");
    expect(appendResponse.body).not.toContain("chat-secret-key");
    expect(appendResponse.body).not.toContain("ciphertext");
    expect(appendResponse.body).not.toContain("encrypted_credential");
  });

  it("records a safe no-model assistant status when no chat-capable model is configured", async () => {
    const threadResponse = await server.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        authorization: `Bearer ${ids.sessionB}`
      },
      payload: {
        title: "No model chat"
      }
    });
    const threadId = threadResponse.json<{ thread: { id: string } }>().thread.id;
    const appendResponse = await server.inject({
      method: "POST",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        authorization: `Bearer ${ids.sessionB}`
      },
      payload: {
        body: "Hello without a configured model."
      }
    });
    const assistantMessage = appendResponse.json<{
      messages: Array<{
        role: string;
        status: string;
        body: string;
        modelRoute: { available: boolean; reason: string; model: null } | null;
      }>;
    }>().messages[1];

    expect(appendResponse.statusCode).toBe(201);
    expect(assistantMessage).toMatchObject({
      role: "assistant",
      status: "no_model",
      body: "No active chat-capable model is configured.",
      modelRoute: {
        available: false,
        reason: "no-active-model",
        model: null
      }
    });
  });

  it("fails loudly when the Chat repository is called without withDataContext", async () => {
    await expect(repository.listThreads({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(
      repository.appendUserMessage({} as never, chatIds.userBPrivateThread, {
        body: "outside data context"
      })
    ).rejects.toThrow("Repository access requires withDataContext");
  });
});

async function seedChatData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO app.chat_threads (id, owner_user_id, workspace_id, visibility, title)
        VALUES
          ($1, $2, null, 'private', 'User B private chat'),
          ($3, $2, $4, 'workspace', 'User B workspace chat')
      `,
      [chatIds.userBPrivateThread, ids.userB, chatIds.userBWorkspaceThread, ids.workspaceAlpha]
    );
  } finally {
    await client.end();
  }
}

function userAContext(workspaceId?: string): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId,
    requestId: "request:user-a-chat"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    workspaceId: null,
    requestId: "request:user-b-chat"
  };
}
