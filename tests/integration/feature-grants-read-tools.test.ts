/**
 * Integration tests: per-account feature grants gate email and calendar read tools.
 *
 * Live-first (#729): the read tools no longer take a `featureGrants` service — they route
 * through `services.sourceContext`, and the REAL source-context readers enforce the grant
 * chain per account (revoked status → connector_revoked gap; feature grant off →
 * feature_grant_disabled gap; missing service → loud fail-closed throw). These tests run
 * the real buildSourceContextService against the integration database with only the
 * provider network edge faked.
 *
 * Failure modes covered per tool:
 *  1. Granted account   → live items returned (revoked sibling surfaces as a gap, no rows)
 *  2. Grant disabled    → feature_grant_disabled gap, zero items, provider NEVER called
 *  3. Missing service   → throws loud error (fail-closed)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { EmailRepository, emailListVisibleMessagesExecute } from "@jarv1s/email";
import { calendarListVisibleEventsExecute } from "@jarv1s/calendar";
import {
  buildFeatureGrantService,
  featureGrantsPrefKey,
  ConnectorsRepository
} from "@jarv1s/connectors";

import {
  buildTestSourceContextService,
  fakeEmailProvider,
  parsedEmail
} from "./source-context-helpers.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const ACCOUNT_EMAIL = "70000000-0000-4000-8000-000000000001";
const ACCOUNT_CALENDAR = "70000000-0000-4000-8000-000000000002";
const ACCOUNT_REVOKED = "70000000-0000-4000-8000-000000000003";

/** Pref stub that revokes one feature for one account; everything else is default-on. */
function prefsDisabling(accountId: string) {
  return {
    get: async (_scopedDb: unknown, key: string) =>
      key === featureGrantsPrefKey(accountId) ? { email: false, calendar: false } : null
  };
}

function readGaps(
  result: Record<string, unknown>
): Array<{ connectorAccountId: string | null; reason: string }> {
  const gaps = (result as { gaps?: unknown }).gaps;
  if (!Array.isArray(gaps)) throw new Error("Expected gaps array in tool result");
  return gaps.map((gap) => {
    const entry = gap as { account?: { connectorAccountId?: unknown } | null; reason?: unknown };
    return {
      connectorAccountId:
        typeof entry.account?.connectorAccountId === "string"
          ? entry.account.connectorAccountId
          : null,
      reason: String(entry.reason)
    };
  });
}

describe("Feature-grants read-tool filtering", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let emailRepository: EmailRepository;
  let cachedEmailId: string;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedGrantsTestData();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    emailRepository = new EmailRepository();

    // Cached copy of the live message — proves the live item joins its cache row id.
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "seed:email" },
      async (scopedDb) => {
        const row = await emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: ACCOUNT_EMAIL,
          sender: "alice@example.test",
          subject: "Test subject",
          snippet: "Test snippet",
          receivedAt: new Date().toISOString(),
          externalId: "grant-test-email-1"
        });
        cachedEmailId = row.id;
      }
    );
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  const ctx = { actorUserId: ids.userA, requestId: "r:grants-test", chatSessionId: "" };

  // ── Email tool ─────────────────────────────────────────────────────────────────

  it("email tool: returns live messages for the granted account; revoked sibling is a gap", async () => {
    const sourceContext = buildTestSourceContextService({
      googleProvider: fakeEmailProvider<string>([parsedEmail({ externalId: "grant-test-email-1" })])
    });
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:email-granted" },
      (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, { sourceContext })
    );
    const messages = result.data.messages as Array<Record<string, unknown>>;
    const granted = messages.filter((m) => m.connectorAccountId === ACCOUNT_EMAIL);
    expect(granted).toHaveLength(1);
    expect(granted[0]?.id).toBe("grant-test-email-1");
    expect(granted[0]?.source).toBe("live");
    expect(granted[0]?.cacheMessageId).toBe(cachedEmailId);
    // The revoked account never yields rows — it surfaces honestly as a gap.
    expect(messages.filter((m) => m.connectorAccountId === ACCOUNT_REVOKED)).toHaveLength(0);
    expect(readGaps(result.data)).toContainEqual({
      connectorAccountId: ACCOUNT_REVOKED,
      reason: "connector_revoked"
    });
  });

  it("email tool: grant-disabled account yields a gap, zero rows, and no provider call", async () => {
    let providerCalled = false;
    const sourceContext = buildTestSourceContextService({
      preferencesRepository: prefsDisabling(ACCOUNT_EMAIL),
      googleProvider: fakeEmailProvider<string>([], {
        listError: () => {
          providerCalled = true;
          return new Error("provider must not be called for a grant-disabled account");
        }
      })
    });
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:email-revoked-grant" },
      (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, { sourceContext })
    );
    const messages = result.data.messages as Array<Record<string, unknown>>;
    expect(messages.filter((m) => m.connectorAccountId === ACCOUNT_EMAIL)).toHaveLength(0);
    expect(readGaps(result.data)).toContainEqual({
      connectorAccountId: ACCOUNT_EMAIL,
      reason: "feature_grant_disabled"
    });
    expect(providerCalled).toBe(false);
  });

  it("email tool: throws loudly when sourceContext service is absent (fail-closed)", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:email-no-svc" },
        (scopedDb) => emailListVisibleMessagesExecute(scopedDb, {}, ctx, {})
      )
    ).rejects.toThrow("sourceContext service is not available");
  });

  // ── Calendar tool ──────────────────────────────────────────────────────────────

  it("calendar tool: returns live events for the granted account", async () => {
    const now = Date.now();
    const sourceContext = buildTestSourceContextService({
      googleClient: {
        listCalendarEvents: async () => [
          {
            id: "grant-test-cal-live-1",
            summary: "Grant test event",
            start: { dateTime: new Date(now + 3600_000).toISOString() },
            end: { dateTime: new Date(now + 7200_000).toISOString() }
          }
        ]
      }
    });
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:cal-granted" },
      (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, { sourceContext })
    );
    const events = result.data.events as Array<Record<string, unknown>>;
    const granted = events.filter((e) => e.connectorAccountId === ACCOUNT_CALENDAR);
    expect(granted).toHaveLength(1);
    expect(granted[0]?.id).toBe("grant-test-cal-live-1");
    expect(granted[0]?.source).toBe("live");
  });

  it("calendar tool: grant-disabled account yields a gap, zero rows, and no provider call", async () => {
    let providerCalled = false;
    const sourceContext = buildTestSourceContextService({
      preferencesRepository: prefsDisabling(ACCOUNT_CALENDAR),
      googleClient: {
        listCalendarEvents: async () => {
          providerCalled = true;
          throw new Error("provider must not be called for a grant-disabled account");
        }
      }
    });
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:cal-revoked-grant" },
      (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, { sourceContext })
    );
    const events = result.data.events as Array<Record<string, unknown>>;
    expect(events.filter((e) => e.connectorAccountId === ACCOUNT_CALENDAR)).toHaveLength(0);
    expect(readGaps(result.data)).toContainEqual({
      connectorAccountId: ACCOUNT_CALENDAR,
      reason: "feature_grant_disabled"
    });
    expect(providerCalled).toBe(false);
  });

  it("calendar tool: throws loudly when sourceContext service is absent (fail-closed)", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "r:cal-no-svc" },
        (scopedDb) => calendarListVisibleEventsExecute(scopedDb, {}, ctx, {})
      )
    ).rejects.toThrow("sourceContext service is not available");
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
    // Unified 'google' provider rows (#729): the live readers only support provider_type
    // google/imap, and the email_messages INSERT policy's google branch requires the full
    // gmail.modify scope URL, so the cached seed above stays insertable.
    await client.query(
      `INSERT INTO app.connector_accounts (id, provider_id, owner_user_id, scopes, status, revoked_at, encrypted_secret)
       VALUES ($1, 'google', $2, ARRAY['https://www.googleapis.com/auth/gmail.modify']::text[], 'active', NULL, '{}'::jsonb),
              ($3, 'google', $2, ARRAY['https://www.googleapis.com/auth/calendar']::text[], 'active', NULL, '{}'::jsonb),
              ($4, 'google', $2, ARRAY['https://www.googleapis.com/auth/gmail.modify']::text[], 'revoked', now(), '{}'::jsonb)`,
      [ACCOUNT_EMAIL, ids.userA, ACCOUNT_CALENDAR, ACCOUNT_REVOKED]
    );
  } finally {
    await client.end();
  }
}
