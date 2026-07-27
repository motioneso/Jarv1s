// tests/unit/job-search-score-stage.test.ts
//
// Task 15 (#1299): unit tests for the score stage, against an in-memory fake `JobSearchStore`,
// `EmbedPort`, `AiPort`, and `NotifyPort` — no SDK, no network, no model. Every store method is
// a `vi.fn()` so a test can assert which calls did or did not happen, matching Task 14's
// job-search-crawl-stage.test.ts style.
import { describe, expect, it, vi } from "vitest";

import type { EmbedPort } from "../../external-modules/job-search/src/worker/stages/crawl.js";
import {
  AI_CALL_BUDGET,
  runScore,
  type AiPort,
  type NotifyPort
} from "../../external-modules/job-search/src/worker/stages/score.js";
import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";
import type {
  JobSearchStore,
  Profile,
  PostingWithEmbedding,
  Resume,
  Match
} from "../../external-modules/job-search/src/domain/store-port.js";

const PROFILE_ID = "profile-1";
const NOW = "2026-07-27T10:00:00.000Z";

function makeCriteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
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
    wantNarrative: "Meaningful work with real autonomy.",
    ...overrides
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: PROFILE_ID,
    name: "Default search",
    state: "active",
    criteria: makeCriteria(),
    contextSummary: null,
    schedule: null,
    briefingDetail: "top",
    surfaceKey: "job-search-default",
    createdAt: NOW,
    ...overrides
  };
}

function makePosting(id: string): PostingWithEmbedding {
  return {
    id,
    sourceId: "freehire",
    externalId: id,
    title: "Staff Engineer",
    company: `Company for ${id}`,
    location: "Remote",
    url: `https://example.com/${id}`,
    body: `Full description for ${id}`,
    postedAt: null,
    embedding: [1, 0, 0]
  };
}

/** Every method is a `vi.fn()`. A method `runScore` never touches throws, so a test that
 * accidentally depends on one fails loudly rather than silently returning `undefined`. */
function createFakeStore(input: {
  profile: Profile;
  candidates: PostingWithEmbedding[];
  resume?: Resume;
}): JobSearchStore & { __matches: Match[] } {
  const { profile, candidates, resume } = input;
  const matches: Match[] = [];

  const notUsed = (name: string) => async () => {
    throw new Error(`FakeStore.${name} should not be called by runScore`);
  };

  return {
    listProfiles: vi.fn(notUsed("listProfiles")),
    getProfile: vi.fn(async (id: string) => (id === profile.id ? profile : null)),
    createProfile: vi.fn(notUsed("createProfile")),
    updateCriteria: vi.fn(notUsed("updateCriteria")),
    setProfileState: vi.fn(notUsed("setProfileState")),
    setProfileContext: vi.fn(notUsed("setProfileContext")),
    setBriefingDetail: vi.fn(notUsed("setBriefingDetail")),
    listPortals: vi.fn(notUsed("listPortals")),
    setPortalState: vi.fn(notUsed("setPortalState")),
    upsertPostings: vi.fn(notUsed("upsertPostings")),
    setEmbedding: vi.fn(notUsed("setEmbedding")),
    listUnscored: vi.fn(notUsed("listUnscored")),
    listUnscoredPostingsWithEmbeddings: vi.fn(async () => candidates),
    listMatches: vi.fn(notUsed("listMatches")),
    upsertMatch: vi.fn(async (_profileId: string, match: Omit<Match, "id">) => {
      matches.push({ ...match, id: `match-${matches.length}` });
    }),
    setMatchState: vi.fn(notUsed("setMatchState")),
    getLatestResume: vi.fn(async () => resume),
    getResumeVersion: vi.fn(notUsed("getResumeVersion")),
    setResume: vi.fn(notUsed("setResume")),
    getSweepCursor: vi.fn(notUsed("getSweepCursor")),
    setSweepCursor: vi.fn(notUsed("setSweepCursor")),
    listCustomSources: vi.fn(notUsed("listCustomSources")),
    addCustomSource: vi.fn(notUsed("addCustomSource")),
    removeCustomSource: vi.fn(notUsed("removeCustomSource")),
    getPostings: vi.fn(notUsed("getPostings")),
    __matches: matches
  } as JobSearchStore & { __matches: Match[] };
}

function createFakeEmbed(): EmbedPort {
  return {
    embedDocuments: vi.fn(async () => {
      throw new Error("embedDocuments should not be called by runScore — that is the crawl stage's job");
    }),
    embedQuery: vi.fn(async () => [1, 0, 0]),
    dimensions: vi.fn(async () => 3)
  };
}

function createFakeNotify(): NotifyPort & { __posted: Array<{ key: string; body: string }> } {
  const posted: Array<{ key: string; body: string }> = [];
  return {
    post: vi.fn(async (input: { key: string; title: string; body: string }) => {
      posted.push({ key: input.key, body: input.body });
    }),
    __posted: posted
  };
}

const okResult = { fit: 80, want: 70, fitReason: "Strong match on skills.", wantReason: "Team shape fits." };

/** A queue of responses, one per call — throws if exhausted, so a test that reads more calls
 * than it planned for fails loudly instead of hanging on `undefined.ok`. */
function scriptedAi(responses: ReadonlyArray<Parameters<AiPort["generateStructured"]>[0] extends never ? never : Awaited<ReturnType<AiPort["generateStructured"]>>>): AiPort & { calls: Array<{ prompt: string }> } {
  const calls: Array<{ prompt: string }> = [];
  let index = 0;
  return {
    generateStructured: vi.fn(async (input) => {
      calls.push({ prompt: input.prompt });
      const response = responses[index];
      index++;
      if (response === undefined) {
        throw new Error("scriptedAi: ran out of scripted responses");
      }
      return response;
    }),
    calls
  };
}

function runDeps(overrides: {
  store: JobSearchStore;
  ai: AiPort;
  budget: number;
  notify?: NotifyPort;
  embed?: EmbedPort;
  deadlineAt?: number;
  clock?: () => number;
}) {
  return {
    store: overrides.store,
    embed: overrides.embed ?? createFakeEmbed(),
    ai: overrides.ai,
    notify: overrides.notify ?? createFakeNotify(),
    profileId: PROFILE_ID,
    budget: overrides.budget,
    now: NOW,
    deadlineAt: overrides.deadlineAt ?? Date.now() + 60_000,
    clock: overrides.clock ?? (() => Date.now())
  };
}

describe("runScore", () => {
  it("test 1: triage picks the batch — only selected postings are sent to the model", async () => {
    // Ten postings, budget 3: triage selects at most 3, so at most 3 generateStructured calls.
    const candidates = Array.from({ length: 10 }, (_, i) => makePosting(`p-${i}`));
    const store = createFakeStore({ profile: makeProfile(), candidates });
    const ai = scriptedAi(Array.from({ length: 3 }, () => ({ ok: true as const, object: okResult })));

    const result = await runScore(runDeps({ store, ai, budget: 3 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(3);
    expect(result.scored).toBe(3);
  });

  it("test 2: outsideFrame from triage is persisted onto the match", async () => {
    // Rig one posting so it lands in the recall bucket: low criteria similarity, high profile
    // similarity, by giving it an orthogonal-then-aligned embedding relative to the two query
    // vectors the fake embed port returns (both [1,0,0]) — instead, directly control via a
    // second embed call. Simpler: since embedQuery always returns [1,0,0] here, cosine
    // similarity to every posting embedding [1,0,0] is 1 for both axes, which never triggers
    // outsideFrame. Use a custom embed port returning different vectors for criteria vs context.
    const posting = makePosting("p-outside");
    const store = createFakeStore({ profile: makeProfile(), candidates: [posting] });
    const ai = scriptedAi([{ ok: true, object: okResult }]);
    let call = 0;
    const embed: EmbedPort = {
      embedDocuments: vi.fn(async () => {
        throw new Error("not used");
      }),
      // First call is the criteria vector (orthogonal to the posting -> low similarity),
      // second is the context vector (aligned with the posting -> high similarity).
      embedQuery: vi.fn(async () => {
        call++;
        return call === 1 ? [0, 1, 0] : [1, 0, 0];
      }),
      dimensions: vi.fn(async () => 3)
    };

    await runScore(runDeps({ store, ai, budget: 1, embed }));

    expect(store.__matches).toHaveLength(1);
    expect(store.__matches[0]?.outsideFrame).toBe(true);
  });

  it("test 3: an {ok: true} envelope whose object fails parseScoreResult leaves the posting unscored and increments failed", async () => {
    const posting = makePosting("p-badparse");
    const store = createFakeStore({ profile: makeProfile(), candidates: [posting] });
    const ai = scriptedAi([{ ok: true, object: { fit: 200, want: 70, fitReason: "x", wantReason: "y" } }]);

    const result = await runScore(runDeps({ store, ai, budget: 1 }));

    expect(result.failed).toBe(1);
    expect(result.scored).toBe(0);
    expect(store.__matches).toHaveLength(0);
  });

  it("test 4: one bad result does not abort the batch — the other postings still score", async () => {
    const postings = [makePosting("p-bad"), makePosting("p-good")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([
      { ok: true, object: { fit: 200, want: 70, fitReason: "x", wantReason: "y" } },
      { ok: true, object: okResult }
    ]);

    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(result.failed).toBe(1);
    expect(result.scored).toBe(1);
  });

  it("test 5: needs_config halts immediately and scores nothing further; exactly one generateStructured call", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2"), makePosting("p-3")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: false, error: "needs_config" }]);

    const result = await runScore(runDeps({ store, ai, budget: 3 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.scored).toBe(0);
    expect(result.halted?.reason).toBe("needs_config");
  });

  it("test 6: usage_limited halts and leaves the rest unscored, not failed", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: false, error: "usage_limited" }]);

    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(result.failed).toBe(0);
    expect(result.halted?.reason).toBe("usage_limited");
    // Neither posting was written as a match — both remain "unscored" by omission.
    expect(store.__matches).toHaveLength(0);
  });

  it("test 7: aborted ends the stage — exactly one call, zero failed", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: false, error: "aborted" }]);

    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(0);
    expect(result.halted?.reason).toBe("aborted");
  });

  it("test 8: provider_error gets exactly one retry across the whole stage, on the same posting", async () => {
    const posting = makePosting("p-retry");
    const store = createFakeStore({ profile: makeProfile(), candidates: [posting] });
    const ai = scriptedAi([{ ok: false, error: "provider_error" }, { ok: true, object: okResult }]);

    // Budget 2, not 1: the retry only fires when a call remains in the budget after the first
    // failure (`aiCallsUsed < scoreBudget`) — at budget 1 the stage has no room for a retry at
    // all and halts usage_limited instead (see test 13).
    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(2);
    // Both calls carried the same posting id in their prompt — the retry never silently
    // dropped the posting it claimed to retry for the next one.
    expect(ai.calls[0]?.prompt).toContain("p-retry");
    expect(ai.calls[1]?.prompt).toContain("p-retry");
    expect(result.scored).toBe(1);
    expect(result.halted).toBeNull();
  });

  it("test 8b: a second provider_error anywhere in the stage halts", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([
      { ok: false, error: "provider_error" },
      { ok: true, object: okResult },
      { ok: false, error: "provider_error" }
    ]);

    // Budget 3: posting 1 costs two calls (fail + retry), leaving exactly one call for posting
    // 2 — enough for it to be reached and hit the stage's second, unretried provider_error.
    const result = await runScore(runDeps({ store, ai, budget: 3 }));

    expect(result.halted?.reason).toBe("provider_error");
  });

  it("test 9: validation_failed is per-posting — increments failed, leaves unscored, keeps going", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: false, error: "validation_failed" }, { ok: true, object: okResult }]);

    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(result.failed).toBe(1);
    expect(result.scored).toBe(1);
    expect(result.halted).toBeNull();
  });

  it("test 10: never more than budget calls, never more than AI_CALL_BUDGET — 40 candidates, budget 8 -> exactly 8 calls, remainder deferred", async () => {
    const postings = Array.from({ length: 40 }, (_, i) => makePosting(`p-${i}`));
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi(Array.from({ length: 8 }, () => ({ ok: true as const, object: okResult })));

    const result = await runScore(runDeps({ store, ai, budget: 8 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(8);
    expect(result.scored).toBe(8);
    expect(result.deferred).toBe(32);
  });

  it("test 11: budget 0 makes no calls at all and returns aiCallsUsed 0 without an error", async () => {
    const postings = [makePosting("p-1")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([]);

    const result = await runScore(runDeps({ store, ai, budget: 0 }));

    expect(ai.generateStructured).not.toHaveBeenCalled();
    expect(result.aiCallsUsed).toBe(0);
    expect(result.halted).toBeNull();
  });

  it("test 12: aiCallsUsed equals the number of generateStructured calls, including failures — a retry counts", async () => {
    const posting = makePosting("p-1");
    const store = createFakeStore({ profile: makeProfile(), candidates: [posting] });
    const ai = scriptedAi([{ ok: false, error: "provider_error" }, { ok: true, object: okResult }]);

    // Budget 2 for the same reason as test 8 — a retry needs a spare call in the budget.
    const result = await runScore(runDeps({ store, ai, budget: 2 }));

    expect(result.aiCallsUsed).toBe(2);
  });

  it("test 13: a retry cannot exceed budget — budget 1, one candidate, first call provider_error -> exactly one call and a usage_limited halt", async () => {
    const posting = makePosting("p-1");
    const store = createFakeStore({ profile: makeProfile(), candidates: [posting] });
    const ai = scriptedAi([{ ok: false, error: "provider_error" }]);

    const result = await runScore(runDeps({ store, ai, budget: 1 }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.halted?.reason).toBe("usage_limited");
  });

  it("test 14: a retry cannot exceed AI_CALL_BUDGET either — 8 candidates, budget 8, first returns provider_error -> exactly 8 calls total", async () => {
    const postings = Array.from({ length: 8 }, (_, i) => makePosting(`p-${i}`));
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const responses: Array<Awaited<ReturnType<AiPort["generateStructured"]>>> = [
      { ok: false, error: "provider_error" },
      ...Array.from({ length: 7 }, () => ({ ok: true as const, object: okResult }))
    ];
    const ai = scriptedAi(responses);

    const result = await runScore(runDeps({ store, ai, budget: AI_CALL_BUDGET }));

    expect(ai.generateStructured).toHaveBeenCalledTimes(8);
    // The retry consumed the eighth posting's call, so the eighth posting is deferred.
    expect(result.deferred).toBe(1);
  });

  it("test 15: a notification fires once per pass with the new-match count, not once per match", async () => {
    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: true, object: okResult }, { ok: true, object: okResult }]);
    const notify = createFakeNotify();

    await runScore(runDeps({ store, ai, budget: 2, notify }));

    expect(notify.post).toHaveBeenCalledTimes(1);
    expect(notify.__posted[0]?.body).toContain("2");
  });

  it("test 16: the notification body never contains a blended number", async () => {
    const postings = [makePosting("p-1")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: true, object: okResult }]);
    const notify = createFakeNotify();

    await runScore(runDeps({ store, ai, budget: 1, notify }));

    expect(notify.__posted[0]?.body).not.toMatch(/\b(overall|combined|score of)\b/i);
  });

  it("test 17: a pass that scores nothing posts no notification; a pass that scores 2 says 2, not a store-wide count", async () => {
    const zeroStore = createFakeStore({ profile: makeProfile(), candidates: [] });
    const zeroAi = scriptedAi([]);
    const zeroNotify = createFakeNotify();
    await runScore(runDeps({ store: zeroStore, ai: zeroAi, budget: 8, notify: zeroNotify }));
    expect(zeroNotify.post).not.toHaveBeenCalled();

    const postings = [makePosting("p-1"), makePosting("p-2")];
    const store = createFakeStore({ profile: makeProfile(), candidates: postings });
    const ai = scriptedAi([{ ok: true, object: okResult }, { ok: true, object: okResult }]);
    const notify = createFakeNotify();
    await runScore(runDeps({ store, ai, budget: 2, notify }));

    expect(notify.__posted[0]?.body).toContain("2");
    expect(notify.__posted[0]?.body).not.toMatch(/30/);
  });
});
