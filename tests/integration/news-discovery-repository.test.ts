import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createDatabase,
  DataContextRunner,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import { sql, type Kysely } from "kysely";

import {
  NEWS_MAX_CUSTOM_TOPICS,
  NEWS_MAX_CUSTOM_SOURCES,
  NewsDuplicateSourceError,
  NewsPersonalizationLimitError,
  NewsPersonalizationRepository
} from "../../packages/news/src/personalization-repository.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;
const repo = new NewsPersonalizationRepository();

describe("news discovery repository", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let bootstrap: pg.Client;

  const asActor = <T>(actorUserId: string, fn: (db: DataContextDb) => Promise<T>): Promise<T> =>
    dataContext.withDataContext({ actorUserId, requestId: crypto.randomUUID() }, fn);

  const sourceInput = (index: number) => ({
    label: `Publisher ${index}`,
    canonicalDomain: `publisher-${index}.example.com`,
    homepageUrl: `https://publisher-${index}.example.com`,
    feedUrl: null,
    retrievalMethod: "scrape" as const,
    validationFingerprint: "opaque-fingerprint"
  });

  beforeEach(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
    await bootstrap.connect();
  });

  afterEach(async () => {
    await Promise.allSettled([appDb.destroy(), bootstrap.end()]);
  });

  it("enables and forces RLS on refresh state and policy verdicts", async () => {
    const result = await bootstrap.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE nspname = 'app' AND relname = ANY($1) ORDER BY relname`,
      [["news_policy_verdicts", "news_refresh_state"]]
    );
    expect(result.rows).toEqual([
      { relname: "news_policy_verdicts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "news_refresh_state", relrowsecurity: true, relforcerowsecurity: true }
    ]);
  });

  it("creates, replaces, deletes, caps, and owner-isolates sources", async () => {
    const created = await asActor(ids.userA, (db) => repo.createCustomSource(db, sourceInput(1)));
    expect(created).toMatchObject({ canonicalDomain: "publisher-1.example.com" });
    expect(JSON.stringify(created)).not.toContain("fingerprint");
    await expect(
      asActor(ids.userA, (db) => repo.createCustomSource(db, sourceInput(1)))
    ).rejects.toBeInstanceOf(NewsDuplicateSourceError);
    await expect(
      asActor(ids.userB, (db) => repo.replaceCustomSource(db, created.id, sourceInput(2)))
    ).resolves.toBeNull();
    await expect(asActor(ids.userB, (db) => repo.deleteCustomSource(db, created.id))).resolves.toBe(
      false
    );

    for (let index = 2; index <= NEWS_MAX_CUSTOM_SOURCES; index += 1) {
      await asActor(ids.userA, (db) => repo.createCustomSource(db, sourceInput(index)));
    }
    await expect(
      asActor(ids.userA, (db) => repo.createCustomSource(db, sourceInput(99)))
    ).rejects.toBeInstanceOf(NewsPersonalizationLimitError);
  });

  it("writes topics with case-insensitive uniqueness and owner isolation", async () => {
    const topic = await asActor(ids.userA, (db) =>
      repo.createCustomTopic(db, {
        label: "AI Safety",
        guidance: "Policy",
        validationFingerprint: "opaque-fingerprint"
      })
    );
    await expect(
      asActor(ids.userA, (db) =>
        repo.createCustomTopic(db, {
          label: "ai safety",
          guidance: null,
          validationFingerprint: "opaque-fingerprint"
        })
      )
    ).rejects.toThrow();
    await expect(
      asActor(ids.userB, (db) =>
        repo.updateCustomTopic(db, topic.id, { label: "Changed", guidance: null })
      )
    ).resolves.toBeNull();
    await expect(asActor(ids.userB, (db) => repo.deleteCustomTopic(db, topic.id))).resolves.toBe(
      false
    );
    for (let index = 2; index <= NEWS_MAX_CUSTOM_TOPICS; index += 1) {
      await asActor(ids.userA, (db) =>
        repo.createCustomTopic(db, {
          label: `Topic ${index}`,
          guidance: null,
          validationFingerprint: "opaque-fingerprint"
        })
      );
    }
    await expect(
      asActor(ids.userA, (db) =>
        repo.createCustomTopic(db, {
          label: "Topic 11",
          guidance: null,
          validationFingerprint: "opaque-fingerprint"
        })
      )
    ).rejects.toBeInstanceOf(NewsPersonalizationLimitError);
  });

  it("scopes and expires provider-policy verdicts", async () => {
    await asActor(ids.userA, (db) =>
      repo.upsertPolicyVerdict(db, {
        canonicalDomain: "publisher.example.com",
        fingerprint: "fp-a",
        verdict: "approved",
        ttlMs: 60_000
      })
    );
    await expect(
      asActor(ids.userA, (db) => repo.readPolicyVerdict(db, "publisher.example.com", "fp-a"))
    ).resolves.toBe("approved");
    await expect(
      asActor(ids.userA, (db) => repo.readPolicyVerdict(db, "publisher.example.com", "fp-b"))
    ).resolves.toBeNull();
    await expect(
      asActor(ids.userB, (db) => repo.readPolicyVerdict(db, "publisher.example.com", "fp-a"))
    ).resolves.toBeNull();
    await bootstrap.query(
      `UPDATE app.news_policy_verdicts SET expires_at = now() - interval '1 second'`
    );
    await expect(
      asActor(ids.userA, (db) => repo.readPolicyVerdict(db, "publisher.example.com", "fp-a"))
    ).resolves.toBeNull();
  });

  it("uses generations to reject stale publication and atomically prunes domains", async () => {
    await expect(asActor(ids.userA, (db) => repo.readRefreshState(db))).resolves.toEqual({
      state: "idle",
      updatedAt: null
    });
    await expect(asActor(ids.userA, (db) => repo.bumpRefreshRequest(db))).resolves.toBe(1);
    const generation = await asActor<number>(ids.userA, (db) => repo.beginRefreshRun(db));
    await expect(asActor(ids.userA, (db) => repo.bumpRefreshRequest(db))).resolves.toBe(2);
    const snapshot = {
      compiledAt: new Date("2026-07-11T12:00:00Z"),
      expiresAt: new Date("2026-07-11T12:30:00Z"),
      payload: {
        articles: [
          {
            id: "one",
            publisher: "News Example",
            canonicalDomain: "news.example.com",
            headline: "One",
            url: "https://news.example.com/one",
            publishedAt: "2026-07-11T11:00:00.000Z",
            excerpt: null,
            imageUrl: null,
            topics: [],
            preferred: true,
            rank: 1
          },
          {
            id: "two",
            publisher: "Other",
            canonicalDomain: "other.test",
            headline: "Two",
            url: "https://other.test/two",
            publishedAt: "2026-07-11T10:00:00.000Z",
            excerpt: null,
            imageUrl: null,
            topics: [],
            preferred: false,
            rank: 2
          }
        ]
      }
    };
    await expect(
      asActor(ids.userA, (db) => repo.publishSnapshotIfCurrent(db, generation, snapshot))
    ).resolves.toBe(false);
    const current = await asActor<number>(ids.userA, (db) => repo.beginRefreshRun(db));
    await expect(
      asActor(ids.userA, (db) => repo.publishSnapshotIfCurrent(db, current, snapshot))
    ).resolves.toBe(true);
    await asActor(ids.userA, (db) => repo.pruneSnapshotDomain(db, "example.com"));
    await expect(asActor(ids.userA, (db) => repo.readLatestSnapshot(db))).resolves.toMatchObject({
      payload: { articles: [{ canonicalDomain: "other.test", headline: "Two" }] }
    });
    await expect(asActor(ids.userB, (db) => repo.readRefreshState(db))).resolves.toEqual({
      state: "idle",
      updatedAt: null
    });
  });

  it("new-table RLS denies cross-owner updates and deletes", async () => {
    await asActor(ids.userA, (db) => repo.bumpRefreshRequest(db));
    await asActor(ids.userA, (db) =>
      repo.upsertPolicyVerdict(db, {
        canonicalDomain: "private.example",
        fingerprint: "fp",
        verdict: "approved",
        ttlMs: 60_000
      })
    );
    await asActor(ids.userB, async (scopedDb) => {
      const refreshUpdate = await scopedDb.db
        .updateTable("app.news_refresh_state")
        .set({ state: "failed" })
        .where("owner_user_id", "=", ids.userA)
        .executeTakeFirst();
      const refreshDelete = await scopedDb.db
        .deleteFrom("app.news_refresh_state")
        .where("owner_user_id", "=", ids.userA)
        .executeTakeFirst();
      const verdictUpdate = await scopedDb.db
        .updateTable("app.news_policy_verdicts")
        .set({ verdict: "rejected" })
        .where("owner_user_id", "=", ids.userA)
        .executeTakeFirst();
      const verdictDelete = await scopedDb.db
        .deleteFrom("app.news_policy_verdicts")
        .where("owner_user_id", "=", ids.userA)
        .executeTakeFirst();
      expect(refreshUpdate.numUpdatedRows).toBe(0n);
      expect(refreshDelete.numDeletedRows).toBe(0n);
      expect(verdictUpdate.numUpdatedRows).toBe(0n);
      expect(verdictDelete.numDeletedRows).toBe(0n);
      await expect(
        sql`SELECT 1 FROM app.news_refresh_state WHERE owner_user_id = ${ids.userA}`.execute(
          scopedDb.db
        )
      ).resolves.toMatchObject({ rows: [] });
    });
    await expect(asActor(ids.userA, (db) => repo.readRefreshState(db))).resolves.toMatchObject({
      state: "queued"
    });
    await expect(
      asActor(ids.userA, (db) => repo.readPolicyVerdict(db, "private.example", "fp"))
    ).resolves.toBe("approved");
  });

  it("worker reads only its own curated news preferences", async () => {
    await bootstrap.query(
      `INSERT INTO app.news_prefs (owner_user_id, kind, key)
       VALUES ($1, 'source', 'bbc'), ($2, 'source', 'guardian')`,
      [ids.userA, ids.userB]
    );
    await bootstrap.query("SET ROLE jarvis_worker_runtime");
    await bootstrap.query("SELECT set_config('app.actor_user_id', $1, false)", [ids.userA]);
    const result = await bootstrap.query(
      `SELECT owner_user_id, key FROM app.news_prefs ORDER BY key`
    );
    expect(result.rows).toEqual([{ owner_user_id: ids.userA, key: "bbc" }]);
  });

  // Since migration 0161 (#975 Slice 4) the worker's UPDATE grant is health_status plus the
  // revalidation columns (validation_status, validation_fingerprint, validated_at, updated_at)
  // — those are positively covered owner-scoped in news-personalization-repository.test.ts.
  // This test keeps the negative controls: identity columns stay worker-unwritable.
  it("worker column grant permits health but never identity columns on same-owner source rows", async () => {
    const created = await asActor(ids.userA, (db) => repo.createCustomSource(db, sourceInput(1)));
    await bootstrap.query("SET ROLE jarvis_worker_runtime");
    await bootstrap.query("SELECT set_config('app.actor_user_id', $1, false)", [ids.userA]);
    const changed = await bootstrap.query(
      `UPDATE app.news_custom_sources SET health_status = 'unavailable' WHERE id = $1`,
      [created.id]
    );
    expect(changed.rowCount).toBe(1);
    for (const statement of [
      "label = 'Changed'",
      "homepage_url = 'https://changed.example'",
      "feed_url = 'https://changed.example/feed'",
      "owner_user_id = owner_user_id"
    ]) {
      await expect(
        bootstrap.query(`UPDATE app.news_custom_sources SET ${statement} WHERE id = $1`, [
          created.id
        ])
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("worker RLS hides and prevents updates to another owner's rows", async () => {
    const other = await asActor(ids.userB, (db) => repo.createCustomSource(db, sourceInput(1)));
    await bootstrap.query("SET ROLE jarvis_worker_runtime");
    await bootstrap.query("SELECT set_config('app.actor_user_id', $1, false)", [ids.userA]);
    const visible = await bootstrap.query(`SELECT id FROM app.news_custom_sources WHERE id = $1`, [
      other.id
    ]);
    expect(visible.rows).toEqual([]);
    const changed = await bootstrap.query(
      `UPDATE app.news_custom_sources SET health_status = 'unavailable' WHERE id = $1`,
      [other.id]
    );
    expect(changed.rowCount).toBe(0);
  });
});
