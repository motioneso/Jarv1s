import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { EmailRepository, emailListVisibleMessagesExecute } from "@jarv1s/email";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("Email briefing assistant tool", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let emailRepository: EmailRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedEmailToolData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    emailRepository = new EmailRepository();
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("bounds the briefing email tool read while still rescuing an older reply-shaped thread", async () => {
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      for (let index = 0; index < 230; index += 1) {
        await emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: connectorAccountId,
          sender: `bulk-${index}@example.test`,
          subject: `Routine update ${index}`,
          snippet: "FYI only",
          receivedAt: new Date(Date.UTC(2026, 5, 20, 12, index % 60, 0)).toISOString(),
          externalId: `bulk-email-${index}`
        });
      }

      await emailRepository.createCachedMessageForTest(scopedDb, {
        id: olderThreadId,
        connectorAccountId: connectorAccountId,
        sender: "older@example.test",
        subject: "Following up on the unresolved thread",
        snippet: "Can you reply when you have a minute?",
        receivedAt: "2026-05-01T09:00:00.000Z",
        externalId: "older-unresolved-email"
      });
    });

    const toolResult = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      emailListVisibleMessagesExecute(
        scopedDb,
        {},
        {
          actorUserId: ids.userA,
          requestId: "r:email-tool-bounded",
          chatSessionId: ""
        },
        // Stub: grant the seeded account so this test focuses on result-bounding, not grant filtering.
        { featureGrants: { grantedAccountIds: async () => new Set([connectorAccountId]) } }
      )
    );

    const messages = toolResult.data.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBeLessThanOrEqual(225);
    expect(messages.some((message) => message.id === olderThreadId)).toBe(true);
  });
});

const connectorAccountId = "60000000-0000-4000-8000-000000000002";
const olderThreadId = "62f00000-0000-4000-8000-000000000001";

async function seedEmailToolData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO app.connector_accounts (
          id,
          provider_id,
          owner_user_id,
          scopes,
          status,
          encrypted_secret
        )
        VALUES ($1, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'active', '{}'::jsonb)
      `,
      [connectorAccountId, ids.userA]
    );
  } finally {
    await client.end();
  }
}

function userAContext() {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-email-briefing-tool"
  };
}
