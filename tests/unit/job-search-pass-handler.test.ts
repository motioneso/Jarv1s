// tests/unit/job-search-pass-handler.test.ts
//
// Task 15 (#1299): the queue handlers that actually run a pass — `crawl.run` (one profile) and
// `crawl.sweep` (the actor's own active profiles, rotated across sweeps). `pass.ts` composes
// the real `runCrawl` (Task 14) with the real `runScore` (this task) inside one invocation, so
// these tests exercise the real stages against a fake `JobSearchStore` and a fake
// `ModuleWorkerContext` — never a fake `runCrawl`/`runScore`, because the thing under test is
// the composition and the budget/deadline/rotation arithmetic around them.
//
// `ctx.fetch` always resolves with a 500 so every portal (real `freehirePortal`/`linkedinPortal`)
// reports a `network`-class failure and returns zero postings without ever touching a real
// network — neither adapter throws on a non-ok response (confirmed by reading freehire.ts), so
// this exercises the full crawl→dedupe→exclude→upsert path with a fast, deterministic outcome:
// `found: 0, kept: 0`. Score-stage behavior is controlled entirely through the fake store's
// unscored-postings list and the fake `ai` port, decoupled from whatever crawl produced.
import { describe, expect, it, vi } from "vitest";

import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import {
  createCrawlRunHandler,
  createCrawlSweepHandler
} from "../../external-modules/job-search/src/worker/handlers/pass.js";
import type { PassResult } from "../../external-modules/job-search/src/worker/handlers/pass.js";
import type {
  AiPort,
  NotifyPort
} from "../../external-modules/job-search/src/worker/stages/score.js";
import type { EmbedPort } from "../../external-modules/job-search/src/worker/stages/crawl.js";
import type {
  Posting,
  SearchCriteria
} from "../../external-modules/job-search/src/domain/records.js";
import type {
  JobSearchStore,
  Match,
  Profile,
  PostingWithEmbedding
} from "../../external-modules/job-search/src/domain/store-port.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCriteria(): SearchCriteria {
  return {
    titles: ["Staff Engineer"],
    seniority: ["staff"],
    locations: ["Remote"],
    remote: "preferred",
    compFloorCents: null,
    excludeCompanies: [],
    mustHave: [],
    niceToHave: [],
    dealbreakers: [],
    wantNarrative: "Meaningful work."
  };
}

function makeProfile(id: string, state: Profile["state"] = "active"): Profile {
  return {
    id,
    name: `Profile ${id}`,
    state,
    criteria: makeCriteria(),
    contextSummary: null,
    schedule: null,
    briefingDetail: "top",
    surfaceKey: `job-search-${id}`,
    createdAt: "2026-07-27T00:00:00.000Z"
  };
}

function makePosting(id: string): PostingWithEmbedding {
  return {
    id,
    sourceId: "freehire",
    externalId: id,
    title: "Staff Engineer",
    company: `Company ${id}`,
    location: "Remote",
    url: `https://example.com/${id}`,
    body: `Description for ${id}`,
    postedAt: null,
    embedding: [1, 0, 0]
  };
}

/** One store shared across an entire test — profiles and their unscored postings are fixed
 * inputs; the sweep cursor is genuinely stateful so a test can drive several sweeps over the
 * same store and see rotation. Every method not needed by `pass.ts`'s call graph
 * (`createCrawlRunHandler`/`createCrawlSweepHandler` -> `runCrawl` -> `runScore`) throws if
 * called, matching Task 14's fake-store convention. */
function createFakeStore(input: {
  profiles: Profile[];
  unscoredByProfile?: ReadonlyMap<string, PostingWithEmbedding[]>;
  getProfileDelayMs?: ReadonlyMap<string, number>;
}): JobSearchStore & { __getProfileCallOrder: string[]; __setSweepCursorCalls: number[] } {
  const { profiles, unscoredByProfile = new Map(), getProfileDelayMs = new Map() } = input;
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  let cursor = 0;
  const getProfileCallOrder: string[] = [];
  const setSweepCursorCalls: number[] = [];

  const notUsed = (name: string) => async () => {
    throw new Error(`FakeStore.${name} should not be called by the pass handlers`);
  };

  return {
    listProfiles: vi.fn(async () => profiles),
    getProfile: vi.fn(async (id: string) => {
      getProfileCallOrder.push(id);
      const delay = getProfileDelayMs.get(id);
      if (delay !== undefined) {
        await sleep(delay);
      }
      return byId.get(id) ?? null;
    }),
    createProfile: vi.fn(notUsed("createProfile")),
    updateCriteria: vi.fn(notUsed("updateCriteria")),
    setProfileState: vi.fn(notUsed("setProfileState")),
    setProfileContext: vi.fn(notUsed("setProfileContext")),
    setBriefingDetail: vi.fn(notUsed("setBriefingDetail")),
    listPortals: vi.fn(async () => []),
    setPortalState: vi.fn(async () => undefined),
    upsertPostings: vi.fn(async (_profileId: string, postings: Posting[]) => postings),
    setEmbedding: vi.fn(notUsed("setEmbedding")),
    listUnscored: vi.fn(notUsed("listUnscored")),
    listUnscoredPostingsWithEmbeddings: vi.fn(
      async (profileId: string) => unscoredByProfile.get(profileId) ?? []
    ),
    listMatches: vi.fn(notUsed("listMatches")),
    upsertMatch: vi.fn(async (_profileId: string, _match: Omit<Match, "id">) => undefined),
    setMatchState: vi.fn(notUsed("setMatchState")),
    getMatch: vi.fn(notUsed("getMatch")),
    getLatestResume: vi.fn(async () => undefined),
    getResumeVersion: vi.fn(notUsed("getResumeVersion")),
    setResume: vi.fn(notUsed("setResume")),
    getSweepCursor: vi.fn(async () => cursor),
    setSweepCursor: vi.fn(async (index: number) => {
      cursor = index;
      setSweepCursorCalls.push(index);
    }),
    listCustomSources: vi.fn(async () => []),
    addCustomSource: vi.fn(notUsed("addCustomSource")),
    removeCustomSource: vi.fn(notUsed("removeCustomSource")),
    getPostings: vi.fn(notUsed("getPostings")),
    __getProfileCallOrder: getProfileCallOrder,
    __setSweepCursorCalls: setSweepCursorCalls
  } as JobSearchStore & { __getProfileCallOrder: string[]; __setSweepCursorCalls: number[] };
}

const okResult = { fit: 80, want: 70, fitReason: "Fits.", wantReason: "Wants it." };

function createFakeCtx(input: {
  input: Record<string, unknown>;
  deadlineAt: number;
  ai?: AiPort;
  notify?: NotifyPort;
  embed?: EmbedPort;
}): ModuleWorkerContext {
  const notUsed = (name: string) => () => {
    throw new Error(`FakeCtx.${name} should not be called by the pass handlers`);
  };

  return {
    input: input.input,
    deadlineAt: input.deadlineAt,
    auth: {
      getCredential: notUsed("auth.getCredential"),
      setCredential: notUsed("auth.setCredential")
    },
    // Every portal fetch fails immediately and cleanly — neither built-in adapter throws on a
    // non-ok response, so this is a fast, deterministic "zero postings" crawl outcome.
    fetch: vi.fn(async () => ({
      status: 500,
      headers: {},
      bodyBase64: Buffer.from("").toString("base64")
    })),
    kv: {
      get: notUsed("kv.get"),
      set: notUsed("kv.set"),
      delete: notUsed("kv.delete"),
      list: notUsed("kv.list")
    },
    ai: input.ai ?? { generateStructured: vi.fn(async () => ({ ok: true, object: okResult })) },
    db: { query: notUsed("db.query") },
    embed:
      input.embed ??
      ({
        embedDocuments: vi.fn(notUsed("embed.embedDocuments")),
        embedQuery: vi.fn(async () => [1, 0, 0]),
        dimensions: vi.fn(async () => 3)
      } satisfies EmbedPort),
    attachments: { readText: notUsed("attachments.readText") },
    notify: input.notify ?? { post: vi.fn(async () => undefined) }
  } as ModuleWorkerContext;
}

function queueEnvelope(params: Record<string, unknown>): Record<string, unknown> {
  return {
    actorUserId: "user-1",
    jobKind: "job-search.crawl-run",
    idempotencyKey: "idem-1",
    params
  };
}

describe("createCrawlRunHandler", () => {
  it("test 1: runs both stages in one invocation — runCrawl then runScore, same profileId", async () => {
    const profile = makeProfile("p-1");
    const posting = makePosting("post-1");
    const store = createFakeStore({
      profiles: [profile],
      unscoredByProfile: new Map([["p-1", [posting]]])
    });
    const ctx = createFakeCtx({
      input: queueEnvelope({ profileId: "p-1" }),
      deadlineAt: Date.now() + 60_000
    });

    const result = await createCrawlRunHandler(store)(ctx);

    // Crawl's effect: upsertPostings was reached for this profile (even with zero kept
    // postings, since every fetch failed). Score's effect: the AI port was actually invoked for
    // the same profile's candidate. Both stages ran, in one call.
    expect(store.upsertPostings).toHaveBeenCalledWith("p-1", expect.any(Array));
    expect(ctx.ai.generateStructured).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      crawl: { found: 0, kept: 0 },
      score: { scored: 1 }
    });
  });

  it("test 2: the crawl deadline leaves room for scoring — crawl gets a share, score gets the full deadline", async () => {
    const profile = makeProfile("p-2");
    const posting = makePosting("post-2");
    // Only the FIRST store.getProfile call (crawl's) is slow — comfortably past the crawl
    // stage's 40% share of the deadline but comfortably before the invocation's full deadline.
    // If score were handed the same short deadline as crawl, it would halt "deadline" instead
    // of scoring; it does not, because CRAWL_SHARE only narrows crawl's window.
    let calls = 0;
    const store = createFakeStore({
      profiles: [profile],
      unscoredByProfile: new Map([["p-2", [posting]]])
    });
    const realGetProfile = store.getProfile;
    store.getProfile = vi.fn(async (id: string) => {
      calls++;
      if (calls === 1) await sleep(150);
      return realGetProfile(id);
    });

    const ctx = createFakeCtx({
      input: queueEnvelope({ profileId: "p-2" }),
      deadlineAt: Date.now() + 300
    });

    const result = (await createCrawlRunHandler(store)(ctx)) as unknown as PassResult;

    expect(result.crawl.truncated).toBe(true);
    expect(result.score.halted).toBeNull();
    expect(result.score.scored).toBe(1);
  }, 10_000);

  it("test 3: reads params.profileId, not input.profileId, from a real queue envelope", async () => {
    const profile = makeProfile("p-3");
    const store = createFakeStore({ profiles: [profile] });
    const ctx = createFakeCtx({
      input: queueEnvelope({ profileId: "p-3" }),
      deadlineAt: Date.now() + 60_000
    });

    await createCrawlRunHandler(store)(ctx);

    expect(store.getProfile).toHaveBeenCalledWith("p-3");
  });

  it("test 4: rejects a missing or non-string profileId itself, without reaching the store", async () => {
    const store = createFakeStore({ profiles: [] });
    const missing = createFakeCtx({ input: queueEnvelope({}), deadlineAt: Date.now() + 60_000 });
    const nonString = createFakeCtx({
      input: queueEnvelope({ profileId: 123 }),
      deadlineAt: Date.now() + 60_000
    });

    await expect(createCrawlRunHandler(store)(missing)).rejects.toThrow(/profileId is required/);
    await expect(createCrawlRunHandler(store)(nonString)).rejects.toThrow(/profileId is required/);
    expect(store.getProfile).not.toHaveBeenCalled();
  });
});

describe("createCrawlSweepHandler", () => {
  function sweepCtx(deadlineAt: number, ai?: AiPort, notify?: NotifyPort): ModuleWorkerContext {
    return createFakeCtx({ input: queueEnvelope({}), deadlineAt, ai, notify });
  }

  it("test 5: takes no params, lists the actor's own active profiles, and runs each", async () => {
    const store = createFakeStore({ profiles: [makeProfile("p-a"), makeProfile("p-b")] });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: Array<{ profileId: string; ok: boolean }>;
    };

    expect(result.processed).toEqual([
      { profileId: "p-a", ok: true },
      { profileId: "p-b", ok: true }
    ]);
    expect(store.getProfile).toHaveBeenCalledWith("p-a");
    expect(store.getProfile).toHaveBeenCalledWith("p-b");
  });

  it("test 6: skips profiles that are not active", async () => {
    const store = createFakeStore({
      profiles: [makeProfile("p-active", "active"), makeProfile("p-paused", "in_conversation")]
    });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: Array<{ profileId: string }>;
    };

    expect(result.processed).toEqual([{ profileId: "p-active", ok: true }]);
    expect(store.__getProfileCallOrder).not.toContain("p-paused");
  });

  it("test 7: one profile failing does not stop the sweep", async () => {
    const store = createFakeStore({ profiles: [makeProfile("p-fail"), makeProfile("p-ok")] });
    store.listCustomSources = vi.fn(async (profileId: string) => {
      if (profileId === "p-fail") throw new Error("custom sources boom");
      return [];
    });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: Array<{ profileId: string; ok: boolean; error?: string }>;
    };

    expect(result.processed).toEqual([
      { profileId: "p-fail", ok: false, error: "custom sources boom" },
      { profileId: "p-ok", ok: true }
    ]);
  });

  it("test 8: nine active profiles, one sweep — at most 8 AI calls total, the ninth untouched", async () => {
    const profiles = Array.from({ length: 9 }, (_, i) => makeProfile(`p-${i}`));
    const unscoredByProfile = new Map(profiles.map((p) => [p.id, [makePosting(`post-${p.id}`)]]));
    const store = createFakeStore({ profiles, unscoredByProfile });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: Array<{ profileId: string }>;
      aiCallsUsed: number;
    };

    expect(result.aiCallsUsed).toBe(8);
    expect(result.processed).toHaveLength(8);
    expect(store.__getProfileCallOrder).not.toContain("p-8");
  });

  it("test 9: the next sweep starts at the ninth profile — cursor seeded from the first sweep's write", async () => {
    const profiles = Array.from({ length: 9 }, (_, i) => makeProfile(`p-${i}`));
    const unscoredByProfile = new Map(profiles.map((p) => [p.id, [makePosting(`post-${p.id}`)]]));
    const store = createFakeStore({ profiles, unscoredByProfile });

    await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000));

    expect(store.__setSweepCursorCalls).toEqual([8]);
  });

  it("test 10: twenty profiles across three sweeps — every profile served exactly once, none twice before the rest", async () => {
    const profiles = Array.from({ length: 20 }, (_, i) => makeProfile(`p-${i}`));
    const unscoredByProfile = new Map(profiles.map((p) => [p.id, [makePosting(`post-${p.id}`)]]));
    const store = createFakeStore({ profiles, unscoredByProfile });

    const served: string[] = [];
    for (let sweep = 0; sweep < 3; sweep++) {
      const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
        processed: Array<{ profileId: string }>;
      };
      served.push(...result.processed.map((entry) => entry.profileId));
    }

    expect(served).toHaveLength(20);
    expect(new Set(served).size).toBe(20);
  });

  it("test 11: zero active profiles — no AI calls, no cursor write, no error", async () => {
    const store = createFakeStore({ profiles: [makeProfile("p-idle", "in_conversation")] });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: unknown[];
      aiCallsUsed: number;
    };

    expect(result).toEqual({ processed: [], aiCallsUsed: 0 });
    expect(store.getSweepCursor).not.toHaveBeenCalled();
    expect(store.setSweepCursor).not.toHaveBeenCalled();
  });

  it("test 12: a profile that receives zero budget is skipped without an error, first in line next sweep", async () => {
    // Profile 0 has exactly AI_CALL_BUDGET candidates, so it spends the whole invocation's
    // budget by itself; profile 1 is never even started, and the cursor stops at its index.
    const eightPostings = Array.from({ length: 8 }, (_, i) => makePosting(`post-0-${i}`));
    const profiles = [makeProfile("p-0"), makeProfile("p-1")];
    const store = createFakeStore({
      profiles,
      unscoredByProfile: new Map([
        ["p-0", eightPostings],
        ["p-1", [makePosting("post-1-0")]]
      ])
    });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 60_000))) as {
      processed: Array<{ profileId: string }>;
    };

    expect(result.processed).toEqual([{ profileId: "p-0" }].map((p) => ({ ...p, ok: true })));
    expect(store.__setSweepCursorCalls).toEqual([1]);
  });

  it("test 13: the budget is counted at the port — profile 1 spends 3 calls then throws; profile 2 is offered exactly 5", async () => {
    const threePostings = Array.from({ length: 3 }, (_, i) => makePosting(`post-1-${i}`));
    const eightPostings = Array.from({ length: 8 }, (_, i) => makePosting(`post-2-${i}`));
    const profiles = [makeProfile("p-1"), makeProfile("p-2")];
    const store = createFakeStore({
      profiles,
      unscoredByProfile: new Map([
        ["p-1", threePostings],
        ["p-2", eightPostings]
      ])
    });

    // profile 1's own three scoring calls all succeed, so `ai.used()` reaches exactly 3 before
    // the throw — the throw happens in `notify.post`, which only fires after scoring succeeded,
    // proving the budget was already spent through the counting wrapper before the failure.
    const notify: NotifyPort = {
      post: vi.fn(async (input: { key: string }) => {
        if (input.key === "new-matches:p-1") {
          throw new Error("notify boom");
        }
      })
    };
    const ai: AiPort = {
      generateStructured: vi.fn(async () => ({ ok: true as const, object: okResult }))
    };

    const result = (await createCrawlSweepHandler(store)(
      sweepCtx(Date.now() + 60_000, ai, notify)
    )) as {
      processed: Array<{ profileId: string; ok: boolean; error?: string }>;
      aiCallsUsed: number;
    };

    expect(result.processed).toEqual([
      { profileId: "p-1", ok: false, error: "notify boom" },
      { profileId: "p-2", ok: true }
    ]);
    // 3 for profile 1, then exactly 5 for profile 2 (8 - 3) — not 8, which would mean the
    // budget was re-derived from a return value instead of the counting port.
    expect(ai.generateStructured).toHaveBeenCalledTimes(8);
  });

  it("test 14: the sweep stops at the deadline and the cursor points at the first profile not started", async () => {
    const profiles = [makeProfile("p-0"), makeProfile("p-1"), makeProfile("p-2")];
    const store = createFakeStore({
      profiles,
      // Profile 1's crawl-stage getProfile call is deliberately slow enough to push the clock
      // past the invocation deadline while it is in flight — profile 2 must never be reached.
      getProfileDelayMs: new Map([["p-1", 80]])
    });

    const result = (await createCrawlSweepHandler(store)(sweepCtx(Date.now() + 40))) as {
      processed: Array<{ profileId: string }>;
    };

    expect(result.processed.map((entry) => entry.profileId)).toEqual(["p-0", "p-1"]);
    expect(store.__getProfileCallOrder).not.toContain("p-2");
    expect(store.__setSweepCursorCalls).toEqual([1]);
  }, 10_000);
});
