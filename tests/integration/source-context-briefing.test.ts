/**
 * Integration tests: briefings compose against the REAL live-first source-context service (#729).
 *
 * composeBriefing → email.listVisibleMessages tool → buildSourceContextService, with only the
 * provider network edge faked. Covered:
 *  1. Live path — only ACTIONABLE triage reaches the synthesized prompt (noise never does),
 *     account provenance is recorded as live, and cached rows are NOT merged in (live-first).
 *  2. Transient provider failure — cache fallback feeds the prompt, provenance marked
 *     cache + degradedReason, run-level degraded flag set.
 *  3. Feature grant disabled — gap recorded, provider never called, and the CACHE IS NOT
 *     USED (a grant gap is honest absence, never a silent cache read).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import type { AiRepository } from "@jarv1s/ai";
import { createAiSecretCipher } from "@jarv1s/ai";
import { BriefingsRepository, composeBriefing, type ComposeDeps } from "@jarv1s/briefings";
import {
  DataContextRunner,
  createDatabase,
  type BriefingDefinition,
  type JarvisDatabase
} from "@jarv1s/db";
import { EmailRepository } from "@jarv1s/email";
import { featureGrantsPrefKey } from "@jarv1s/connectors";
import type { MemoryRetriever } from "@jarv1s/memory";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

import {
  buildTestSourceContextService,
  fakeEmailProvider,
  parsedEmail,
  transientProviderError
} from "./source-context-helpers.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const SC_ACCOUNT = "7c000000-0000-4000-8000-000000000001";

const LIVE_ACTIONABLE_SUBJECT = "Please reply about the budget plan";
const LIVE_NOISE_SUBJECT = "Monthly digest";
const CACHED_SUBJECT = "Cached urgent question";

function triageJson(category: string, summary: string): string {
  return JSON.stringify({
    summary,
    billsDue: [],
    actionItems: [],
    deadlines: [],
    mayGetLostInShuffle: false,
    importance: "normal",
    confidence: 0.9,
    actionability: { category, reason: "integration triage stub" }
  });
}

/** Triage stub keyed on the extract prompt: the reply-shaped live email is actionable, the rest noise. */
function subjectKeyedExtractDeps() {
  return {
    selectModel: async () => ({ tier: "economy" }),
    runChat: async (_model: { tier: string }, prompt: string) => ({
      text: prompt.includes(LIVE_ACTIONABLE_SUBJECT)
        ? triageJson("needs_reply", "Alice still needs a reply on the budget plan.")
        : triageJson("noise", "Routine newsletter.")
    })
  };
}

interface SourceContextEmailMeta {
  accounts: Array<{ connectorAccountId: string; source: string; degradedReason: string | null }>;
  gaps: Array<{ connectorAccountId: string | null; reason: string }>;
}

function emailMeta(sourceMetadata: Record<string, unknown>): SourceContextEmailMeta {
  const sourceContext = sourceMetadata.sourceContext as { email?: SourceContextEmailMeta };
  if (!sourceContext?.email) throw new Error("Expected sourceContext.email in source_metadata");
  return sourceContext.email;
}

describe("Briefing compose over the live-first source-context service (#729)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let definition: BriefingDefinition;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedConnectorAccount();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);

    const emailRepository = new EmailRepository();
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      // Cached, already-triaged actionable row: the fallback body for test 2 and the
      // must-NOT-appear row for tests 1 and 3.
      await emailRepository.createCachedMessageForTest(scopedDb, {
        connectorAccountId: SC_ACCOUNT,
        sender: "bob@example.test",
        subject: CACHED_SUBJECT,
        snippet: "Can you reply when free?",
        receivedAt: new Date(Date.now() - 3600_000).toISOString(),
        externalId: "sc-cache-1",
        summary: "Bob asked an urgent question about the rollout.",
        signals: {
          importance: "high",
          confidence: 0.9,
          actionability: { category: "needs_reply", reason: "open question" }
        }
      });

      definition = await new BriefingsRepository().createDefinition(scopedDb, {
        title: "Source-context briefing",
        selectedToolNames: ["email.listVisibleMessages"]
      });
    });
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  function captureDeps(sourceContextService: ComposeDeps["sourceContextService"]): {
    deps: ComposeDeps;
    captured: string[];
  } {
    const cipher = createAiSecretCipher();
    const captured: string[] = [];
    const deps: ComposeDeps = {
      moduleManifests: getBuiltInModuleManifests(),
      cipher,
      memoryRetriever: {
        async retrieve() {
          return [];
        },
        async retrieveRecent() {
          return [];
        }
      } as unknown as MemoryRetriever,
      // Force email inclusion regardless of behavior policy defaults.
      sourceBehaviorPolicy: undefined,
      aiRepository: {
        selectModelForCapability: async () => ({
          id: "sc-model",
          provider_config_id: "pc-sc",
          provider_kind: "anthropic",
          provider_model_id: "claude",
          display_name: "SC",
          tier: "economy"
        }),
        selectProviderWithCredential: async () => ({
          id: "pc-sc",
          base_url: null,
          encrypted_credential: cipher.encryptJson({ apiKey: "sc-key" })
        })
      } as unknown as AiRepository,
      createAdapter: () => ({
        generateChat: async (input) => {
          for (const message of input.messages) captured.push(message.content);
          return { text: "synth narrative" };
        }
      }),
      sourceContextService
    };
    return { deps, captured };
  }

  async function compose(runId: string, deps: ComposeDeps) {
    return dataContext.withDataContext(userAContext(), (scopedDb) =>
      composeBriefing(scopedDb, definition, { runKind: "manual", runId, now: new Date() }, deps)
    );
  }

  it("live path: only actionable triage reaches the prompt; provenance is live; cache is not merged", async () => {
    const sourceContext = buildTestSourceContextService({
      googleProvider: fakeEmailProvider<string>([
        parsedEmail({
          externalId: "sc-live-1",
          subject: LIVE_ACTIONABLE_SUBJECT,
          from: "Alice <alice@example.test>",
          snippet: "Do you approve?",
          body: "Do you approve the budget plan? Please reply."
        }),
        parsedEmail({
          externalId: "sc-live-2",
          subject: LIVE_NOISE_SUBJECT,
          from: "News <news@example.test>",
          snippet: "This month in product",
          body: "This month in product."
        })
      ]),
      makeEmailExtractDeps: subjectKeyedExtractDeps
    });
    const { deps, captured } = captureDeps(sourceContext);

    const composed = await compose("sc-live-run", deps);
    expect(composed.status).toBe("succeeded");

    const prompt = captured.join("\n");
    expect(prompt).toContain(LIVE_ACTIONABLE_SUBJECT);
    // Noise triage never becomes a prompt line (#729 §7)…
    expect(prompt).not.toContain(LIVE_NOISE_SUBJECT);
    // …and live-first means the cached row is NOT merged into a successful live read.
    expect(prompt).not.toContain(CACHED_SUBJECT);

    const meta = emailMeta(composed.sourceMetadata);
    expect(meta.accounts).toContainEqual({
      connectorAccountId: SC_ACCOUNT,
      source: "live",
      degradedReason: null
    });
    expect(composed.sourceMetadata.degraded).toBe(false);
  });

  it("transient provider failure: cache fallback feeds the prompt, marked degraded cache", async () => {
    const sourceContext = buildTestSourceContextService({
      googleProvider: fakeEmailProvider<string>([], { listError: transientProviderError })
    });
    const { deps, captured } = captureDeps(sourceContext);

    const composed = await compose("sc-fallback-run", deps);
    expect(composed.status).toBe("succeeded");

    // The cached actionable row (already triaged needs_reply) reaches the prompt.
    expect(captured.join("\n")).toContain(CACHED_SUBJECT);

    const meta = emailMeta(composed.sourceMetadata);
    expect(meta.accounts).toContainEqual({
      connectorAccountId: SC_ACCOUNT,
      source: "cache",
      degradedReason: "provider_error"
    });
    expect(composed.sourceMetadata.degraded).toBe(true);
  });

  it("feature grant disabled: gap recorded, provider never called, cache NOT used", async () => {
    let providerCalled = false;
    const sourceContext = buildTestSourceContextService({
      preferencesRepository: {
        get: async (_scopedDb, key) =>
          key === featureGrantsPrefKey(SC_ACCOUNT) ? { email: false, calendar: false } : null
      },
      googleProvider: fakeEmailProvider<string>([], {
        listError: () => {
          providerCalled = true;
          return new Error("provider must not be called when the grant is disabled");
        }
      })
    });
    const { deps, captured } = captureDeps(sourceContext);

    const composed = await compose("sc-grant-gap-run", deps);
    expect(composed.status).toBe("succeeded");

    // A grant gap is honest absence — neither live nor cached content may appear.
    expect(captured.join("\n")).not.toContain(CACHED_SUBJECT);
    expect(providerCalled).toBe(false);

    const meta = emailMeta(composed.sourceMetadata);
    expect(meta.gaps).toContainEqual({
      connectorAccountId: SC_ACCOUNT,
      reason: "feature_grant_disabled"
    });
    expect(meta.accounts.filter((a) => a.connectorAccountId === SC_ACCOUNT)).toHaveLength(0);
    expect(composed.sourceMetadata.degraded).toBe(false);
    // The user-facing briefing gap taxonomy records it as a source_auth gap (needs re-grant).
    const gaps = composed.sourceMetadata.gaps as Array<{ source: string; reason: string }>;
    expect(gaps).toContainEqual({ source: "email", reason: "source_auth" });
  });
});

async function seedConnectorAccount(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    // Unified google provider + full gmail.modify scope: live-reader supported AND
    // satisfies the email_messages INSERT policy for the cached seed.
    await client.query(
      `INSERT INTO app.connector_accounts (id, provider_id, owner_user_id, scopes, status, encrypted_secret)
       VALUES ($1, 'google', $2, ARRAY['https://www.googleapis.com/auth/gmail.modify']::text[], 'active', '{}'::jsonb)`,
      [SC_ACCOUNT, ids.userA]
    );
  } finally {
    await client.end();
  }
}

function userAContext() {
  return { actorUserId: ids.userA, requestId: "request:source-context-briefing" };
}
