/**
 * Integration tests: per-account feature grants gate email and calendar read tools.
 *
 * Covers all three read paths (chat gateway passes `readToolServices`, briefings passes
 * `featureGrantService`, cross-tool uses `runReadToolForActor` with `readToolServices`).
 * Here we test the tool-level execute functions directly — the gateway / briefings path
 * wiring is validated by typecheck + the unit tests for the gateway itself.
 *
 * Three failure modes tested:
 *  1. Granted account   → rows returned
 *  2. Revoked account   → rows filtered out (zero results, no error)
 *  3. Missing service   → throws loud error (fail-closed)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  DataContextRunner,
  assertDataContextDb,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { EmailRepository, emailListVisibleMessagesExecute } from "@jarv1s/email";
import { calendarListVisibleEventsExecute } from "@jarv1s/calendar";
import { buildFeatureGrantService, ConnectorsRepository } from "@jarv1s/connectors";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const ACCOUNT_EMAIL = "70000000-0000-4000-8000-000000000001";
const ACCOUNT_CALENDAR = "70000000-0000-4000-8000-000000000002";
const ACCOUNT_REVOKED = "70000000-0000-4000-8000-000000000003";

function granted(accountId: string) {
  return { featureGrants: { grantedAccountIds: async () => new Set([accountId]) } };
}

function grantNone() {
  return { featureGrants: { grantedAccountIds: async () => new Set<string>() } };
}

describe("Feature-grants read-tool filtering", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let emailRepository: EmailRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedGrantsTestData();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    emailRepository = new EmailRepository();

    // Seed one email and one calendar event for userA
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "seed:email" },
      async (scopedDb) => {
        await emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: ACCOUNT_EMAIL,
          sender: "alice@example.test",
          subject: "Test subject",
          snippet: "Test snippet",
          receivedAt: new Date().toISOString(),
          externalId: "grant-test-email-1"
        });
      }
    );

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "seed:calendar" },
      async (scopedDb) => {
        assertDataContextDb(scopedDb);
        const now = new Date();
        const later = new Date(now.getTime() + 3600_000);
        await scopedDb.db
          .insertInto("app.calendar_events")
          .values({
            id: randomUUID(),
            connector_account_id: ACCOUNT_CALENDAR,
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            title: "Grant test event",
            starts_at: now.toISOString(),
            ends_at: later.toISOString(),
            location: null,
            summary: null,
            body_excerpt: null,
            external_id: "grant-test-cal-1",
            external_metadata: {},
            created_at: now,
            updated_at: now
          })
          .execute();
      }
    );
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  const ctx = { actorUserId: ids.userA, requestId: "r:grants-test", chatSessionId: "" };

  // ── Email tool ─────────────────────────────────────────────────────────────────

  it("email tool: returns messages for granted account", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:email-granted" },
      (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, granted(ACCOUNT_EMAIL))
    );
    const messages = result.data.messages as Array<Record<string, unknown>>;
    expect(messages.some((m) => m.connectorAccountId === ACCOUNT_EMAIL)).toBe(true);
  });

  it("email tool: filters out messages for revoked account", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:email-revoked" },
      (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, grantNone())
    );
    const messages = result.data.messages as Array<Record<string, unknown>>;
    expect(messages.filter((m) => m.connectorAccountId === ACCOUNT_EMAIL)).toHaveLength(0);
  });

  it("email tool: throws loudly when featureGrants service is absent (fail-closed)", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:email-no-svc" },
        (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, {})
      )
    ).rejects.toThrow("featureGrants service is not available");
  });

  // ── Calendar tool ──────────────────────────────────────────────────────────────

  it("calendar tool: returns events for granted account", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:cal-granted" },
      (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, granted(ACCOUNT_CALENDAR))
    );
    const events = result.data.events as Array<Record<string, unknown>>;
    expect(events.some((e) => e.connectorAccountId === ACCOUNT_CALENDAR)).toBe(true);
  });

  it("calendar tool: filters out events for revoked account", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:cal-revoked" },
      (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, grantNone())
    );
    const events = result.data.events as Array<Record<string, unknown>>;
    expect(events.filter((e) => e.connectorAccountId === ACCOUNT_CALENDAR)).toHaveLength(0);
  });

  it("calendar tool: throws loudly when featureGrants service is absent (fail-closed)", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:cal-no-svc" },
        (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, {})
      )
    ).rejects.toThrow("featureGrants service is not available");
  });

  // ── buildFeatureGrantService status guard (regression: revoked accounts leaked) ──

  describe("buildFeatureGrantService revoked-status guard", () => {
    it("excludes revoked-status accounts even when scope+default-on would grant them", async () => {
      // Real ConnectorsRepository returns all 3 accounts (active email, active calendar, revoked).
      // Mock prefs returns null for all → default-on semantics (no pref row = granted if scoped).
      // Old code (no status filter): ACCOUNT_REVOKED would appear in the granted set.
      // New code: status !== "active" check drops it before resolveEffectiveGrants runs.
      const service = buildFeatureGrantService({
        connectorsRepository: new ConnectorsRepository(),
        preferencesRepository: { get: async () => null }
      });

      const grantedEmail = await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:revoked-guard-email" },
        (scopedDb) => service.grantedAccountIds(scopedDb, "email")
      );
      expect(grantedEmail.has(ACCOUNT_REVOKED)).toBe(false);
      expect(grantedEmail.has(ACCOUNT_EMAIL)).toBe(true);

      const grantedCal = await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:revoked-guard-cal" },
        (scopedDb) => service.grantedAccountIds(scopedDb, "calendar")
      );
      expect(grantedCal.has(ACCOUNT_REVOKED)).toBe(false);
    });
  });
});

async function seedGrantsTestData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.connector_accounts (id, provider_id, owner_user_id, scopes, status, encrypted_secret)
       VALUES ($1, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'active', '{}'::jsonb),
              ($3, 'google-calendar', $2, ARRAY['https://www.googleapis.com/auth/calendar']::text[], 'active', '{}'::jsonb),
              ($4, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'revoked', '{}'::jsonb)`,
      [ACCOUNT_EMAIL, ids.userA, ACCOUNT_CALENDAR, ACCOUNT_REVOKED]
    );
  } finally {
    await client.end();
  }
}
