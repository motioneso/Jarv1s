import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import {
  NEWS_MAX_SOURCE_EXCLUSIONS,
  NewsPersonalizationLimitError,
  NewsPersonalizationRepository
} from "../../packages/news/src/personalization-repository.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  resetFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

const { Client } = pg;

// #953 (epic #954) News Slice 1 — schema-level RLS posture for the four personalization
// tables added by 0159_news_personalization.sql. Slice 1 is security-tier: owner-only FORCE
// RLS applies to every actor including admins, and the worker runtime gets NO access until
// Slice 2 proves it needs some. Repository behavior tests (owner isolation via DataContext)
// are added to this file in Task 3.
const PERSONALIZATION_TABLES = [
  "news_custom_sources",
  "news_custom_topics",
  "news_source_exclusions",
  "news_compilation_snapshots"
] as const;

describe("news personalization schema posture (#953)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    await resetFoundationDatabase();
    client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("all four tables exist with ENABLE + FORCE row-level security", async () => {
    const result = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = ANY($1)
        ORDER BY c.relname`,
      [[...PERSONALIZATION_TABLES]]
    );
    expect(result.rows).toEqual(
      [...PERSONALIZATION_TABLES].sort().map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true
      }))
    );
  });

  it("defines exactly SELECT/INSERT/UPDATE/DELETE app-runtime policies, all owner-scoped", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const result = await client.query<{
        policyname: string;
        roles: string[];
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname, roles::text[] AS roles, cmd, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'app' AND tablename = $1
          ORDER BY cmd`,
        [table]
      );
      expect(result.rows.map((row) => row.cmd).sort(), table).toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE"
      ]);
      for (const policy of result.rows) {
        expect(policy.roles, `${table}/${policy.policyname}`).toEqual(["jarvis_app_runtime"]);
        // INSERT policies carry only with_check; SELECT/DELETE only qual; UPDATE both.
        // The invariant: every predicate present is owner-scoped, never simply `true`.
        const predicates = [policy.qual, policy.with_check].filter(
          (predicate): predicate is string => predicate !== null
        );
        expect(predicates.length, `${table}/${policy.policyname}`).toBeGreaterThan(0);
        for (const predicate of predicates) {
          expect(predicate, `${table}/${policy.policyname}`).toContain("owner_user_id");
          expect(predicate, `${table}/${policy.policyname}`).toContain("current_actor_user_id()");
        }
      }
    }
  });

  it("grants jarvis_worker_runtime no privilege of any kind (Slice 1 has no worker path)", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT bool_or(has_table_privilege('jarvis_worker_runtime', $1, priv)) AS has_privilege
           FROM unnest(ARRAY[
             'select','insert','update','delete','truncate','references','trigger'
           ]) AS priv`,
        [`app.${table}`]
      );
      expect(result.rows[0]?.has_privilege, table).toBe(false);
    }
  });

  it("app runtime holds exactly SELECT/INSERT/UPDATE/DELETE and never owns the tables", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const grants = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'app' AND table_name = $1 AND grantee = 'jarvis_app_runtime'
          ORDER BY privilege_type`,
        [table]
      );
      expect(
        grants.rows.map((row) => row.privilege_type),
        table
      ).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);

      const owner = await client.query<{ tableowner: string }>(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'app' AND tablename = $1`,
        [table]
      );
      expect(owner.rows[0]?.tableowner, table).toBe("jarvis_migration_owner");
    }
  });

  it("news_custom_topics enforces case-insensitive owner+label uniqueness via expression index", async () => {
    const result = await client.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = 'app' AND tablename = 'news_custom_topics'
          AND indexdef ILIKE '%lower(label)%'`
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toContain("UNIQUE");
    expect(result.rows[0]?.indexdef).toContain("owner_user_id");
  });
});

// Task 3 — repository behavior under each actor's DataContext GUC. Mirrors
// news-prefs-repository.test.ts: real API server for sign-up so users exist, then the
// repository is exercised directly so RLS + the SQL-enforced cap are the things under test.
// Slice 2 owns custom source/topic writes, so those rows are seeded via the bootstrap
// superuser connection (the only actor that bypasses FORCE RLS by design).
describe("news personalization repository (#953 Task 3)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;
  let dataCtx: DataContextRunner;
  let bootstrap: pg.Client;
  const repo = new NewsPersonalizationRepository();

  async function signUp(name: string, email: string): Promise<string> {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name, email, password: "password12345" }
    });
    return res.json<{ user: { id: string } }>().user.id;
  }

  /** First sign-up is the instance admin/owner; RLS must isolate them like anyone else. */
  async function signUpAdminAliceBob(prefix: string): Promise<[string, string, string]> {
    const admin = await signUp("Admin", `${prefix}-admin@example.com`);
    await setInstanceSetting("registration.requires_approval", { value: false });
    const alice = await signUp("Alice", `${prefix}-alice@example.com`);
    const bob = await signUp("Bob", `${prefix}-bob@example.com`);
    return [admin, alice, bob];
  }

  function asActor<T>(
    actorUserId: string,
    requestId: string,
    fn: (scopedDb: Parameters<Parameters<DataContextRunner["withDataContext"]>[1]>[0]) => Promise<T>
  ): Promise<T> {
    return dataCtx.withDataContext({ actorUserId, requestId }, fn);
  }

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
    dataCtx = new DataContextRunner(appDb);
    bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
    await bootstrap.connect();
  });

  afterEach(async () => {
    await Promise.allSettled([
      server?.close(),
      authRuntime?.close(),
      appDb?.destroy(),
      bootstrap?.end()
    ]);
  });

  it("exclusions are owner-isolated: neither another user nor the admin can see or delete them", async () => {
    const [admin, alice, bob] = await signUpAdminAliceBob("np-excl");

    const created = await asActor(alice, "np-1a", (scopedDb) =>
      repo.createExclusion(scopedDb, "tabloid.example.com")
    );
    expect(created.canonicalDomain).toBe("tabloid.example.com");

    const aliceList = await asActor(alice, "np-1b", (scopedDb) => repo.listExclusions(scopedDb));
    expect(aliceList.map((e) => e.id)).toEqual([created.id]);

    for (const [actor, tag] of [
      [bob, "np-1c"],
      [admin, "np-1d"]
    ] as const) {
      const list = await asActor(actor, tag, (scopedDb) => repo.listExclusions(scopedDb));
      expect(list).toEqual([]);
      const removed = await asActor(actor, `${tag}-rm`, (scopedDb) =>
        repo.removeExclusion(scopedDb, created.id)
      );
      expect(removed).toBe(false);
    }

    // The row must have survived both foreign delete attempts.
    const stillThere = await asActor(alice, "np-1e", (scopedDb) => repo.listExclusions(scopedDb));
    expect(stillThere).toHaveLength(1);

    const ownRemoved = await asActor(alice, "np-1f", (scopedDb) =>
      repo.removeExclusion(scopedDb, created.id)
    );
    expect(ownRemoved).toBe(true);
  });

  it("duplicate exclusion create is idempotent (same row back, no duplicate)", async () => {
    const [, alice] = await signUpAdminAliceBob("np-dup");

    const first = await asActor(alice, "np-2a", (scopedDb) =>
      repo.createExclusion(scopedDb, "dup.example.com")
    );
    const second = await asActor(alice, "np-2b", (scopedDb) =>
      repo.createExclusion(scopedDb, "dup.example.com")
    );
    expect(second.id).toBe(first.id);

    const listed = await asActor(alice, "np-2c", (scopedDb) => repo.listExclusions(scopedDb));
    expect(listed).toHaveLength(1);
  });

  it("the exclusion over the cap fails with the typed limit error; duplicates at cap stay idempotent", async () => {
    const [, alice, bob] = await signUpAdminAliceBob("np-cap");

    // Seed to exactly the cap via the superuser (fast path; the cap guard itself is
    // SQL-side and actor-scoped, which the repo call below exercises).
    await bootstrap.query(
      `INSERT INTO app.news_source_exclusions (owner_user_id, canonical_domain)
       SELECT $1, 'seeded-' || i || '.example.com' FROM generate_series(1, $2::int) AS i`,
      [alice, NEWS_MAX_SOURCE_EXCLUSIONS]
    );

    await expect(
      asActor(alice, "np-3a", (scopedDb) => repo.createExclusion(scopedDb, "overflow.example.com"))
    ).rejects.toBeInstanceOf(NewsPersonalizationLimitError);

    // Re-adding an existing domain at the cap returns the existing row, not an error.
    const dup = await asActor(alice, "np-3b", (scopedDb) =>
      repo.createExclusion(scopedDb, "seeded-1.example.com")
    );
    expect(dup.canonicalDomain).toBe("seeded-1.example.com");

    // The cap is per-owner: Alice being full must not block Bob.
    const bobCreated = await asActor(bob, "np-3c", (scopedDb) =>
      repo.createExclusion(scopedDb, "overflow.example.com")
    );
    expect(bobCreated.canonicalDomain).toBe("overflow.example.com");
  });

  it("custom sources and topics list/count only the actor's rows and never expose fingerprints", async () => {
    const [admin, alice, bob] = await signUpAdminAliceBob("np-src");

    await bootstrap.query(
      `INSERT INTO app.news_custom_sources
         (owner_user_id, label, canonical_domain, homepage_url, feed_url, retrieval_method,
          validation_status, health_status, validation_fingerprint, validated_at)
       VALUES ($1, 'The Example Times', 'news.example.com', 'https://news.example.com', NULL,
               'scrape', 'approved', 'available', 'fp-secret-marker', now())`,
      [alice]
    );
    await bootstrap.query(
      `INSERT INTO app.news_custom_topics
         (owner_user_id, label, guidance, validation_status, validation_fingerprint, validated_at)
       VALUES ($1, 'AI Safety', 'focus on policy', 'approved', 'fp-secret-marker', now())`,
      [alice]
    );

    const sources = await asActor(alice, "np-4a", (scopedDb) => repo.listCustomSources(scopedDb));
    expect(sources).toHaveLength(1);
    expect(sources[0]?.canonicalDomain).toBe("news.example.com");
    // DTO must omit the opaque revalidation marker entirely (not just null it).
    expect(JSON.stringify(sources)).not.toContain("fingerprint");
    expect(JSON.stringify(sources)).not.toContain("fp-secret-marker");

    const topics = await asActor(alice, "np-4b", (scopedDb) => repo.listCustomTopics(scopedDb));
    expect(topics).toHaveLength(1);
    expect(topics[0]?.label).toBe("AI Safety");
    expect(JSON.stringify(topics)).not.toContain("fingerprint");
    expect(JSON.stringify(topics)).not.toContain("fp-secret-marker");

    expect(await asActor(alice, "np-4c", (scopedDb) => repo.countCustomSources(scopedDb))).toBe(1);
    expect(await asActor(alice, "np-4d", (scopedDb) => repo.countCustomTopics(scopedDb))).toBe(1);

    for (const [actor, tag] of [
      [bob, "np-4e"],
      [admin, "np-4f"]
    ] as const) {
      expect(await asActor(actor, tag, (scopedDb) => repo.listCustomSources(scopedDb))).toEqual([]);
      expect(
        await asActor(actor, `${tag}-t`, (scopedDb) => repo.listCustomTopics(scopedDb))
      ).toEqual([]);
      expect(
        await asActor(actor, `${tag}-cs`, (scopedDb) => repo.countCustomSources(scopedDb))
      ).toBe(0);
      expect(
        await asActor(actor, `${tag}-ct`, (scopedDb) => repo.countCustomTopics(scopedDb))
      ).toBe(0);
    }
  });

  it("snapshot replace is an atomic per-owner upsert and reads are owner-isolated", async () => {
    const [admin, alice, bob] = await signUpAdminAliceBob("np-snap");

    const first = {
      compiledAt: new Date("2026-07-11T06:00:00Z"),
      expiresAt: new Date("2026-07-11T12:00:00Z"),
      payload: { articles: [{ title: "First", url: "https://example.com/1" }] }
    };
    await asActor(alice, "np-5a", (scopedDb) => repo.replaceLatestSnapshot(scopedDb, first));

    const read = await asActor(alice, "np-5b", (scopedDb) => repo.readLatestSnapshot(scopedDb));
    expect(read?.compiledAt.toISOString()).toBe("2026-07-11T06:00:00.000Z");
    expect(read?.payload).toEqual(first.payload);

    // Replace again: still exactly one row for Alice, with the new content.
    const second = {
      compiledAt: new Date("2026-07-11T07:00:00Z"),
      expiresAt: new Date("2026-07-11T13:00:00Z"),
      payload: { articles: [] }
    };
    await asActor(alice, "np-5c", (scopedDb) => repo.replaceLatestSnapshot(scopedDb, second));
    const reread = await asActor(alice, "np-5d", (scopedDb) => repo.readLatestSnapshot(scopedDb));
    expect(reread?.compiledAt.toISOString()).toBe("2026-07-11T07:00:00.000Z");
    expect(reread?.payload).toEqual({ articles: [] });

    const rowCount = await bootstrap.query(
      `SELECT count(*)::int AS n FROM app.news_compilation_snapshots WHERE owner_user_id = $1`,
      [alice]
    );
    expect(rowCount.rows[0]?.n).toBe(1);

    for (const [actor, tag] of [
      [bob, "np-5e"],
      [admin, "np-5f"]
    ] as const) {
      expect(await asActor(actor, tag, (scopedDb) => repo.readLatestSnapshot(scopedDb))).toBeNull();
    }
  });

  it("replaceLatestSnapshot rejects an invalid payload before SQL (stored row untouched)", async () => {
    const [, alice] = await signUpAdminAliceBob("np-guard");

    const good = {
      compiledAt: new Date("2026-07-11T06:00:00Z"),
      expiresAt: new Date("2026-07-11T12:00:00Z"),
      payload: { articles: [] }
    };
    await asActor(alice, "np-6a", (scopedDb) => repo.replaceLatestSnapshot(scopedDb, good));

    await expect(
      asActor(alice, "np-6b", (scopedDb) =>
        repo.replaceLatestSnapshot(scopedDb, {
          ...good,
          compiledAt: new Date("2026-07-11T08:00:00Z"),
          payload: { articles: {} } // articles must be an array
        })
      )
    ).rejects.toThrow(/articles/);

    const read = await asActor(alice, "np-6c", (scopedDb) => repo.readLatestSnapshot(scopedDb));
    expect(read?.compiledAt.toISOString()).toBe("2026-07-11T06:00:00.000Z");
  });
});
