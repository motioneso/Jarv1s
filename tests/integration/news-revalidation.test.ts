import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";

import type { NewsAiPort, NewsSafeFetchPort } from "../../packages/news/src/discovery/ports.js";
import type {
  NewsSourceValidationState,
  NewsTopicValidationState
} from "../../packages/news/src/personalization-repository.js";
import {
  revalidateOwnerNews,
  type NewsRevalidationDeps,
  type NewsRevalidationLogFields
} from "../../packages/news/src/revalidation.js";

// #975 Slice 4 Task 3 — provider-change revalidation core, exercised with stub ports
// (pattern: news-refresh-jobs.test.ts). The repository is an in-memory spy so we can
// assert "zero writes" for the idempotent/skip paths; RLS behavior of the real repository
// methods is covered by news-personalization-repository.test.ts.
const scopedDb = {} as unknown as DataContextDb;

type MutableSource = {
  -readonly [K in keyof NewsSourceValidationState]: NewsSourceValidationState[K];
};
type MutableTopic = {
  -readonly [K in keyof NewsTopicValidationState]: NewsTopicValidationState[K];
};

function makeSource(overrides: Partial<MutableSource> = {}): MutableSource {
  return {
    id: "src-1",
    label: "The Example Times",
    canonicalDomain: "news.example.com",
    homepageUrl: "https://news.example.com",
    feedUrl: "https://news.example.com/feed",
    retrievalMethod: "feed",
    validationStatus: "approved",
    validationFingerprint: "fp2",
    healthStatus: "available",
    ...overrides
  };
}

function makeTopic(overrides: Partial<MutableTopic> = {}): MutableTopic {
  return {
    id: "top-1",
    label: "AI Safety",
    guidance: "focus on policy",
    validationStatus: "approved",
    validationFingerprint: "fp2",
    ...overrides
  };
}

function makeRepository(sources: MutableSource[], topics: MutableTopic[]) {
  const writes: string[] = [];
  const repository: NewsRevalidationDeps["repository"] = {
    listSourceValidationStates: async () => sources.map((source) => ({ ...source })),
    listTopicValidationStates: async () => topics.map((topic) => ({ ...topic })),
    updateSourceValidation: async (_db, sourceId, input) => {
      writes.push(`source:${sourceId}:${input.validationStatus}`);
      const source = sources.find((candidate) => candidate.id === sourceId);
      if (!source) throw new Error(`unknown source ${sourceId}`);
      source.validationStatus = input.validationStatus;
      if (input.validationFingerprint !== null) {
        source.validationFingerprint = input.validationFingerprint;
      }
    },
    updateTopicValidation: async (_db, topicId, input) => {
      writes.push(`topic:${topicId}:${input.validationStatus}`);
      const topic = topics.find((candidate) => candidate.id === topicId);
      if (!topic) throw new Error(`unknown topic ${topicId}`);
      topic.validationStatus = input.validationStatus;
      if (input.validationFingerprint !== null) {
        topic.validationFingerprint = input.validationFingerprint;
      }
    },
    updateSourceHealth: async (_db, sourceId, health) => {
      writes.push(`health:${sourceId}:${health}`);
      const source = sources.find((candidate) => candidate.id === sourceId);
      if (!source) throw new Error(`unknown source ${sourceId}`);
      source.healthStatus = health;
    },
    readPolicyVerdict: async () => null,
    upsertPolicyVerdict: async () => {
      writes.push("verdict-upsert");
    }
  };
  return { repository, writes, sources, topics };
}

const FEED_BODY =
  `<?xml version="1.0"?><rss><channel>` +
  `<item><title>Example headline about important current events</title>` +
  `<link>https://news.example.com/story</link></item>` +
  `</channel></rss>`;

const fetchOk: NewsSafeFetchPort = async (url) => ({
  ok: true,
  status: 200,
  finalUrl: url,
  contentType: "application/rss+xml",
  body: FEED_BODY,
  truncated: false
});

const fetchFail: NewsSafeFetchPort = async () => ({ ok: false, reason: "network" });

/** Stub AI: fixed fingerprint, approves/rejects per `allowed`, category read from schema. */
function makeAi(opts: { fingerprint: string | null; allowed?: boolean }): NewsAiPort {
  return {
    fingerprint: async () => opts.fingerprint,
    generateJson: async (_db, input) => {
      const schema = input.schema as {
        properties: { category: { enum: readonly string[] } };
      };
      return {
        ok: true,
        object: { allowed: opts.allowed ?? true, category: schema.properties.category.enum[0] }
      };
    }
  };
}

function makeLogger() {
  const events: NewsRevalidationLogFields[] = [];
  return { logger: { info: (fields: NewsRevalidationLogFields) => events.push(fields) }, events };
}

describe("news revalidation core (#975 Slice 4)", () => {
  it("skips everything when all items are approved under the current fingerprint", async () => {
    const { repository, writes } = makeRepository([makeSource()], [makeTopic()]);
    const { logger } = makeLogger();
    const outcome = await revalidateOwnerNews(scopedDb, {
      fetch: fetchOk,
      ai: makeAi({ fingerprint: "fp2" }),
      repository,
      logger
    });
    expect(outcome).toEqual({
      sourcesChecked: 0,
      topicsChecked: 0,
      sourcesNeedingAttention: 0,
      topicsNeedingAttention: 0,
      transitionedToAttention: false
    });
    expect(writes).toEqual([]);
  });

  it("re-approves drifted items under the new fingerprint without raising attention", async () => {
    const { repository, sources, topics } = makeRepository(
      [makeSource({ validationFingerprint: "fp1" })],
      [makeTopic({ validationFingerprint: "fp1" })]
    );
    const { logger } = makeLogger();
    const outcome = await revalidateOwnerNews(scopedDb, {
      fetch: fetchOk,
      ai: makeAi({ fingerprint: "fp2" }),
      repository,
      logger
    });
    expect(outcome).toEqual({
      sourcesChecked: 1,
      topicsChecked: 1,
      sourcesNeedingAttention: 0,
      topicsNeedingAttention: 0,
      transitionedToAttention: false
    });
    expect(sources[0]).toMatchObject({
      validationStatus: "approved",
      validationFingerprint: "fp2",
      healthStatus: "available"
    });
    expect(topics[0]).toMatchObject({
      validationStatus: "approved",
      validationFingerprint: "fp2"
    });
  });

  it("marks unreachable sources unavailable + needs_revalidation and raises attention", async () => {
    const { repository, sources } = makeRepository(
      [makeSource({ validationFingerprint: "fp1" })],
      []
    );
    const { logger } = makeLogger();
    const outcome = await revalidateOwnerNews(scopedDb, {
      fetch: fetchFail,
      ai: makeAi({ fingerprint: "fp2" }),
      repository,
      logger
    });
    expect(outcome).toMatchObject({
      sourcesChecked: 1,
      sourcesNeedingAttention: 1,
      transitionedToAttention: true
    });
    expect(sources[0]).toMatchObject({
      validationStatus: "needs_revalidation",
      healthStatus: "unavailable"
    });
  });

  it("rejects items the new provider disallows and raises attention", async () => {
    const { repository, sources, topics } = makeRepository(
      [makeSource({ validationFingerprint: "fp1" })],
      [makeTopic({ validationFingerprint: "fp1" })]
    );
    const { logger } = makeLogger();
    const outcome = await revalidateOwnerNews(scopedDb, {
      fetch: fetchOk,
      ai: makeAi({ fingerprint: "fp2", allowed: false }),
      repository,
      logger
    });
    expect(outcome).toEqual({
      sourcesChecked: 1,
      topicsChecked: 1,
      sourcesNeedingAttention: 1,
      topicsNeedingAttention: 1,
      transitionedToAttention: true
    });
    expect(sources[0]).toMatchObject({ validationStatus: "rejected", validationFingerprint: "fp2" });
    expect(topics[0]).toMatchObject({ validationStatus: "rejected", validationFingerprint: "fp2" });
  });

  it("does not re-raise attention on a second identical run (notification dedupe)", async () => {
    const { repository } = makeRepository(
      [makeSource({ validationFingerprint: "fp1" })],
      [makeTopic({ validationFingerprint: "fp1" })]
    );
    const { logger } = makeLogger();
    const deps = {
      fetch: fetchOk,
      ai: makeAi({ fingerprint: "fp2", allowed: false }),
      repository,
      logger
    };
    const first = await revalidateOwnerNews(scopedDb, deps);
    expect(first.transitionedToAttention).toBe(true);
    const second = await revalidateOwnerNews(scopedDb, deps);
    expect(second).toMatchObject({
      sourcesNeedingAttention: 1,
      topicsNeedingAttention: 1,
      transitionedToAttention: false
    });
  });

  it("makes no writes and logs a metadata-only skip when no model is configured", async () => {
    const { repository, writes } = makeRepository(
      [makeSource({ validationFingerprint: "fp1" })],
      [makeTopic({ validationFingerprint: "fp1" })]
    );
    const { logger, events } = makeLogger();
    const outcome = await revalidateOwnerNews(scopedDb, {
      fetch: fetchOk,
      ai: makeAi({ fingerprint: null }),
      repository,
      logger
    });
    expect(outcome).toEqual({
      sourcesChecked: 0,
      topicsChecked: 0,
      sourcesNeedingAttention: 0,
      topicsNeedingAttention: 0,
      transitionedToAttention: false
    });
    expect(writes).toEqual([]);
    expect(events).toEqual([{ event: "news_revalidation_skipped", reason: "no_model" }]);
  });
});
