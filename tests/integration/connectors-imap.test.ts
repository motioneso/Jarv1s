import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { EmailRepository } from "@jarv1s/email";
import type { Kysely } from "kysely";
import {
  ConnectorsRepository,
  ImapConnectError,
  ImapConnectionService,
  LiveImapProbeClient,
  createConnectorSecretCipher,
  decryptImapConnectionSecret,
  runImapSync,
  type ImapProbeClient,
  type ImapProbeInput,
  type ImapProbeResult
} from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase, testImap } from "./test-database.js";

describe("imap connector definitions", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("seeds the four imap provider definitions readable by any actor", async () => {
    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:a" },
      (db) => new ConnectorsRepository().listProviders(db)
    );
    const imap = rows
      .filter((r) => r.provider_type === "imap")
      .map((r) => r.provider_id)
      .sort();
    expect(imap).toEqual(["imap-fastmail", "imap-icloud", "imap-proton", "imap-yahoo"]);
  });
});

describe("ConnectorsRepository.upsertImapAccount — scope persistence", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";

    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
    } else {
      process.env.JARVIS_CONNECTOR_SECRET_KEY = originalSecretKey;
    }
  });

  it("persists the imap-proton preset's default_scopes on connect, not an empty array", async () => {
    const repo = new ConnectorsRepository();
    const cipher = createConnectorSecretCipher();
    const account = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-upsert-scopes" },
      (scopedDb) =>
        repo.upsertImapAccount(scopedDb, {
          providerId: "imap-proton",
          encryptedSecret: cipher.encryptJson({
            kind: "imap-password",
            providerId: "imap-proton",
            username: "user@proton.local",
            password: "secret",
            imapHost: "127.0.0.1",
            imapPort: 1143,
            imapTls: false,
            smtpHost: "127.0.0.1",
            smtpPort: 1025,
            smtpSecurity: "none"
          })
        })
    );
    expect(account.scopes).toEqual(["email.read"]);
  });

  it("allows an email_messages insert for a provider_type='imap' account with email.read scope", async () => {
    const repo = new ConnectorsRepository();
    const cipher = createConnectorSecretCipher();
    const account = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-insert-account" },
      (scopedDb) =>
        repo.upsertImapAccount(scopedDb, {
          providerId: "imap-proton",
          encryptedSecret: cipher.encryptJson({
            kind: "imap-password",
            providerId: "imap-proton",
            username: "user@proton.local",
            password: "secret",
            imapHost: "127.0.0.1",
            imapPort: 1143,
            imapTls: false,
            smtpHost: "127.0.0.1",
            smtpPort: 1025,
            smtpSecurity: "none"
          })
        })
    );
    const emailRepo = new EmailRepository();
    const message = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-insert-message" },
      (scopedDb) =>
        emailRepo.upsertCachedMessage(scopedDb, {
          connectorAccountId: account.id,
          sender: "friend@example.com",
          subject: "hello",
          receivedAt: new Date().toISOString(),
          externalId: "imap:INBOX:1000:1"
        })
    );
    expect(message.id).toBeDefined();
  });
});

describe("runImapSync", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";

    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
    } else {
      process.env.JARVIS_CONNECTOR_SECRET_KEY = originalSecretKey;
    }
  });

  it("caches a fetched message into app.email_messages", async () => {
    const repo = new ConnectorsRepository();
    const cipher = createConnectorSecretCipher();
    const accessContext = { actorUserId: ids.userA, requestId: "req:imap-sync-caches" };
    const account = await dataContext.withDataContext(accessContext, (scopedDb) =>
      repo.upsertImapAccount(scopedDb, {
        providerId: "imap-proton",
        encryptedSecret: cipher.encryptJson({
          kind: "imap-password",
          providerId: "imap-proton",
          username: "user@proton.local",
          password: "secret",
          imapHost: "127.0.0.1",
          imapPort: 1143,
          imapTls: false,
          smtpHost: "127.0.0.1",
          smtpPort: 1025,
          smtpSecurity: "none"
        })
      })
    );

    const fakeProvider = {
      listFolders: async () => ["INBOX"],
      listMessageKeys: async () => [{ folder: "INBOX", id: "imap:INBOX:1:1" }],
      getMessage: async () => ({
        externalId: "imap:INBOX:1:1",
        historyId: null,
        subject: "hi",
        from: "friend@example.com",
        recipients: [],
        receivedAt: new Date().toISOString(),
        labelIds: [],
        snippet: null,
        body: "body",
        bodyTruncated: false
      })
    };

    const result = await dataContext.withDataContext(accessContext, (scopedDb) =>
      runImapSync(scopedDb, account.id, {
        repository: repo,
        cipher,
        emailReadProvider: fakeProvider,
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        }
      })
    );

    expect(result.emailUpserted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("records no-active-connection when the account is not found", async () => {
    const repo = new ConnectorsRepository();
    const cipher = createConnectorSecretCipher();
    const accessContext = { actorUserId: ids.userA, requestId: "req:imap-sync-missing" };

    const result = await dataContext.withDataContext(accessContext, (scopedDb) =>
      runImapSync(scopedDb, ids.userA, {
        repository: repo,
        cipher,
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        }
      })
    );

    expect(result.errors).toEqual(["no-active-connection"]);
    expect(result.emailUpserted).toBe(0);
  });
});

class FakeImapProbeClient implements ImapProbeClient {
  constructor(private readonly result: ImapProbeResult) {}
  lastInput: ImapProbeInput | undefined;

  async probe(input: ImapProbeInput): Promise<ImapProbeResult> {
    this.lastInput = input;
    return this.result;
  }
}

describe("ImapConnectionService", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";

    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
    } else {
      process.env.JARVIS_CONNECTOR_SECRET_KEY = originalSecretKey;
    }
  });

  function buildService(result: ImapProbeResult) {
    const probeClient = new FakeImapProbeClient(result);
    const service = new ImapConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      probeClient
    });
    return { service, probeClient };
  }

  it("persists the credential bundle when the probe reports ok", async () => {
    const { service } = buildService("ok");

    const account = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-connect-ok" },
      (scopedDb) =>
        service.connect(scopedDb, {
          providerId: "imap-fastmail",
          username: "person@fastmail.com",
          password: "app-password"
        })
    );

    expect(account.provider_id).toBe("imap-fastmail");
    expect(account.status).toBe("active");
    expect(account.has_secret).toBe(true);

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-read-back" },
      async (scopedDb) => {
        const accounts = await new ConnectorsRepository().listAccounts(scopedDb);
        return accounts.find((a) => a.id === account.id);
      }
    );
    expect(stored).toBeDefined();
  });

  it("rejects without persisting when the probe reports auth_failed", async () => {
    const { service } = buildService("auth_failed");

    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userB, requestId: "req:imap-connect-auth-failed" },
        (scopedDb) =>
          service.connect(scopedDb, {
            providerId: "imap-yahoo",
            username: "person@yahoo.com",
            password: "wrong"
          })
      )
    ).rejects.toBeInstanceOf(ImapConnectError);

    const accounts = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:imap-read-after-fail" },
      (scopedDb) => new ConnectorsRepository().listAccounts(scopedDb)
    );
    expect(accounts.find((a) => a.provider_id === "imap-yahoo")).toBeUndefined();
  });

  it("testConnection never reads or writes app.connector_accounts", async () => {
    const { service, probeClient } = buildService("ok");

    const result = await service.testConnection({
      providerId: "imap-icloud",
      username: "person@icloud.com",
      password: "app-password"
    });

    expect(result).toEqual({ result: "ok" });
    expect(probeClient.lastInput?.imapHost).toBe("imap.mail.me.com");

    const accounts = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-test-no-write" },
      (scopedDb) => new ConnectorsRepository().listAccounts(scopedDb)
    );
    expect(accounts.find((a) => a.provider_id === "imap-icloud")).toBeUndefined();
  });

  it("rejects an unknown providerId before probing", async () => {
    const { service, probeClient } = buildService("ok");

    await expect(
      service.testConnection({
        providerId: "imap-not-a-real-preset",
        username: "person@example.com",
        password: "x"
      })
    ).rejects.toBeInstanceOf(ImapConnectError);
    expect(probeClient.lastInput).toBeUndefined();
  });

  it("round-trips the persisted secret bundle through the cipher", async () => {
    const cipher = createConnectorSecretCipher();
    const { service } = buildService("ok");

    const account = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-secret-roundtrip" },
      (scopedDb) =>
        service.connect(scopedDb, {
          providerId: "imap-proton",
          username: "person@proton.me",
          password: "bridge-password"
        })
    );

    const encrypted = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:imap-secret-read" },
      async (scopedDb) => {
        const rows = await scopedDb.db
          .selectFrom("app.connector_accounts")
          .select("encrypted_secret")
          .where("id", "=", account.id)
          .executeTakeFirstOrThrow();
        return rows.encrypted_secret;
      }
    );

    const secret = decryptImapConnectionSecret(
      cipher,
      encrypted as Parameters<typeof decryptImapConnectionSecret>[1]
    );
    expect(secret).toEqual({
      kind: "imap-password",
      providerId: "imap-proton",
      username: "person@proton.me",
      password: "bridge-password",
      imapHost: "127.0.0.1",
      imapPort: 1143,
      imapTls: false,
      smtpHost: "127.0.0.1",
      smtpPort: 1025,
      smtpSecurity: "none"
    });
  });
});

describe("LiveImapProbeClient against GreenMail", () => {
  const probeClient = new LiveImapProbeClient();

  it("reports ok for correct credentials", async () => {
    const result = await probeClient.probe({
      imapHost: testImap.host,
      imapPort: testImap.imapPort,
      imapTls: false,
      smtpHost: testImap.host,
      smtpPort: testImap.smtpPort,
      smtpSecurity: "none",
      username: testImap.username,
      password: testImap.password
    });
    expect(result).toBe("ok");
  });

  it("reports auth_failed for an incorrect password", async () => {
    const result = await probeClient.probe({
      imapHost: testImap.host,
      imapPort: testImap.imapPort,
      imapTls: false,
      smtpHost: testImap.host,
      smtpPort: testImap.smtpPort,
      smtpSecurity: "none",
      username: testImap.username,
      password: "definitely-wrong"
    });
    expect(result).toBe("auth_failed");
  });
});
