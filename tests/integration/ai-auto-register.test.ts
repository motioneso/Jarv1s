import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import {
  AiAutoRegisterService,
  AiRepository,
  createAiSecretCipher,
  type AiSecretCipher
} from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("AI auto-register default chat model on login (#367)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let cipher: AiSecretCipher;
  let service: AiAutoRegisterService;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-secret-key";

    await resetFoundationDatabase();
    await setUserAInstanceAdmin();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    cipher = createAiSecretCipher();
    service = new AiAutoRegisterService({ repository, cipher });
  });

  afterAll(async () => {
    await appDb?.destroy();
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  beforeEach(async () => {
    // Each test starts from a clean AI config slate (admin-scoped truncate via bootstrap role).
    await truncateAiTables();
  });

  it("registers a default cli provider config + sonnet chat model on first ready", async () => {
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );

    const { providers, model } = await dataContext.withDataContext(adminCtx(), async (db) => ({
      providers: await repository.listProviders(db),
      model: await repository.selectChatModelForUser(db)
    }));

    const cli = providers.find((p) => p.provider_kind === "anthropic");
    expect(cli).toBeDefined();
    expect(cli?.auth_method).toBe("cli");
    expect(model?.provider_model_id).toBe("sonnet");
    expect(model?.capabilities).toContain("chat");
    expect(model?.status).toBe("active");
  });

  it("is idempotent across re-login — creates nothing new on a second call", async () => {
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );

    const { providers, models } = await dataContext.withDataContext(adminCtx(), async (db) => ({
      providers: (await repository.listProviders(db)).filter((p) => p.provider_kind === "anthropic"),
      models: await repository.listModels(db)
    }));

    expect(providers).toHaveLength(1);
    expect(models.filter((m) => m.provider_model_id === "sonnet")).toHaveLength(1);
  });

  it("does not recreate a model the user disabled (never resurrect — decision 2)", async () => {
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );
    const model = await dataContext.withDataContext(adminCtx(), (db) =>
      repository.selectChatModelForUser(db)
    );
    await dataContext.withDataContext(adminCtx(), (db) =>
      repository.updateModel(db, model!.id, { status: "disabled" })
    );

    // Re-login: the disabled row still exists, so no new model is created.
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );

    const models = await dataContext.withDataContext(adminCtx(), (db) => repository.listModels(db));
    const sonnets = models.filter((m) => m.provider_model_id === "sonnet");
    expect(sonnets).toHaveLength(1);
    expect(sonnets[0]?.status).toBe("disabled");
  });

  it("reuses an existing non-revoked provider config instead of duplicating it", async () => {
    await dataContext.withDataContext(adminCtx(), (db) =>
      repository.createProvider(db, {
        providerKind: "anthropic",
        displayName: "Claude",
        authMethod: "cli",
        encryptedCredential: cipher.encryptJson({ cli: true })
      })
    );

    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "anthropic")
    );

    const providers = await dataContext.withDataContext(adminCtx(), (db) =>
      repository.listProviders(db)
    );
    expect(providers.filter((p) => p.provider_kind === "anthropic")).toHaveLength(1);
  });

  it("no-ops for a provider without a catalog default", async () => {
    await dataContext.withDataContext(adminCtx(), (db) =>
      service.ensureDefaultChatModel(db, "custom")
    );
    const providers = await dataContext.withDataContext(adminCtx(), (db) =>
      repository.listProviders(db)
    );
    expect(providers.filter((p) => p.provider_kind === "custom")).toHaveLength(0);
  });

  function adminCtx(): AccessContext {
    return { actorUserId: ids.userA, requestId: "request:auto-register" };
  }
});

async function setUserAInstanceAdmin(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA]);
  } finally {
    await client.end();
  }
}

async function truncateAiTables(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE app.ai_configured_models, app.ai_provider_configs RESTART IDENTITY CASCADE`
    );
  } finally {
    await client.end();
  }
}
