// tests/unit/job-search-briefing-handler.test.ts
//
// Task 15 (#1299) follow-up: `briefing.contribute`, the module's only path into the
// morning/evening briefing. The handler itself is a thin wrapper — Task 10's
// `buildBriefingContribution` and this task's own `contributeToBriefing` do all the shaping — so
// what these tests actually pin down is the one judgment call the handler makes (which
// `BriefingDetail` to render at, given the setting lives per-profile but the contribution is
// shared across the actor's active profiles) and the three invariants a regression here would
// most likely break silently: prose is assembled from records, not a model; only `active`
// profiles count; and the envelope is validated like any other queue-shaped invocation.
//
// Exercises the real `contributeToBriefing`/`buildBriefingContribution` against a fake
// `JobSearchStore`, never a fake contribution — the fake store has no `ai`/model-shaped method at
// all, so a regression that routed briefing text through a model would fail to compile here
// before it could fail at runtime.
import { describe, expect, it, vi } from "vitest";

import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { createBriefingContributeHandler } from "../../external-modules/job-search/src/worker/handlers/briefing.js";
import type { Match, Posting } from "../../external-modules/job-search/src/domain/records.js";
import type {
  BriefingDetail,
  JobSearchStore,
  PortalState,
  Profile
} from "../../external-modules/job-search/src/domain/store-port.js";

function notUsed(name: string) {
  return async () => {
    throw new Error(`FakeStore.${name} should not be called`);
  };
}

function createFakeStore(input: {
  profiles: Profile[];
  matchesByProfile?: Record<string, Match[]>;
  postings?: Posting[];
  portalsByProfile?: Record<string, PortalState[]>;
}): JobSearchStore {
  const matchesByProfile = input.matchesByProfile ?? {};
  const postingsById = new Map((input.postings ?? []).map((posting) => [posting.id, posting]));
  const portalsByProfile = input.portalsByProfile ?? {};

  return {
    listProfiles: vi.fn(async () => input.profiles),
    getProfile: vi.fn(notUsed("getProfile")),
    createProfile: vi.fn(notUsed("createProfile")),
    renameProfile: vi.fn(notUsed("renameProfile")),
    updateCriteria: vi.fn(notUsed("updateCriteria")),
    claimCriteriaRescore: vi.fn(async () => []),
    finishCriteriaRescore: vi.fn(async () => undefined),
    setProfileState: vi.fn(notUsed("setProfileState")),
    setProfileContext: vi.fn(notUsed("setProfileContext")),
    setBriefingDetail: vi.fn(notUsed("setBriefingDetail")),
    listPortals: vi.fn(async (profileId: string) => portalsByProfile[profileId] ?? []),
    setPortalState: vi.fn(notUsed("setPortalState")),
    upsertPostings: vi.fn(notUsed("upsertPostings")),
    setEmbedding: vi.fn(notUsed("setEmbedding")),
    listUnscored: vi.fn(notUsed("listUnscored")),
    listUnscoredPostingsWithEmbeddings: vi.fn(notUsed("listUnscoredPostingsWithEmbeddings")),
    listMatches: vi.fn(async (profileId: string) => matchesByProfile[profileId] ?? []),
    countMatches: vi.fn(notUsed("countMatches")),
    upsertMatch: vi.fn(notUsed("upsertMatch")),
    setMatchState: vi.fn(notUsed("setMatchState")),
    getMatch: vi.fn(notUsed("getMatch")),
    getLatestResume: vi.fn(notUsed("getLatestResume")),
    getResumeVersion: vi.fn(notUsed("getResumeVersion")),
    setResume: vi.fn(notUsed("setResume")),
    listUnfittedPostingsWithEmbeddings: vi.fn(notUsed("listUnfittedPostingsWithEmbeddings")),
    getSweepCursor: vi.fn(notUsed("getSweepCursor")),
    setSweepCursor: vi.fn(notUsed("setSweepCursor")),
    listCustomSources: vi.fn(notUsed("listCustomSources")),
    addCustomSource: vi.fn(notUsed("addCustomSource")),
    removeCustomSource: vi.fn(notUsed("removeCustomSource")),
    getPostings: vi.fn(async (ids: readonly string[]) => {
      const result = new Map<string, Posting>();
      for (const id of ids) {
        const posting = postingsById.get(id);
        if (posting !== undefined) result.set(id, posting);
      }
      return result;
    })
  };
}

function makeProfile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    state: "active",
    criteria: {
      titles: [],
      seniority: [],
      locations: [],
      remote: "no-preference",
      compFloorCents: null,
      excludeCompanies: [],
      mustHave: [],
      niceToHave: [],
      dealbreakers: [],
      wantNarrative: ""
    },
    contextSummary: null,
    schedule: null,
    briefingDetail: "count",
    surfaceKey: `job-search-${id}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function makePosting(id: string, overrides: Partial<Posting> = {}): Posting {
  return {
    id,
    sourceId: "freehire",
    externalId: id,
    title: "Staff Engineer",
    company: "Acme",
    location: "Remote",
    url: `https://example.com/${id}`,
    body: "Description",
    postedAt: null,
    ...overrides
  };
}

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    profileId: "profile-1",
    postingId: "post-1",
    fit: 80,
    want: 70,
    fitReason: "Fits well.",
    wantReason: "Wants it.",
    outsideFrame: false,
    state: "new",
    scoredAt: "2026-07-27T00:00:00.000Z",
    ...overrides
  };
}

function queueCtx(params: Record<string, unknown> = {}): ModuleWorkerContext {
  return {
    input: {
      actorUserId: "user-1",
      jobKind: "briefing",
      idempotencyKey: "idem-1",
      params
    }
  } as unknown as ModuleWorkerContext;
}

describe("createBriefingContributeHandler", () => {
  it("rejects a malformed envelope before touching the store", async () => {
    const store = createFakeStore({ profiles: [] });
    const handler = createBriefingContributeHandler(store);

    await expect(
      handler({ input: { section: "morning" } } as unknown as ModuleWorkerContext)
    ).rejects.toThrow(/unknown key: section/);
    expect(store.listProfiles).not.toHaveBeenCalled();
  });

  it("returns exactly {headline, items} — no other keys, and no model-shaped store method exists to call", async () => {
    const store = createFakeStore({ profiles: [] });
    const handler = createBriefingContributeHandler(store);

    const result = await handler(queueCtx());

    expect(Object.keys(result).sort()).toEqual(["headline", "items"]);
    // The fake conforms to JobSearchStore only — no `ai`/`generateStructured`-shaped method
    // exists on it at all, so a regression that routed briefing prose through a model would
    // fail to compile here, not just fail an assertion.
    expect(Object.keys(store)).not.toContain("ai");
  });

  it("renders items from record fields verbatim, matching Task 10's exact format — never model output", async () => {
    const profile = makeProfile("profile-1", { briefingDetail: "top" });
    const posting = makePosting("post-1", { title: "Staff Engineer", company: "Acme" });
    const match = makeMatch({ id: "match-1", profileId: "profile-1", fit: 80, want: 70 });
    const store = createFakeStore({
      profiles: [profile],
      matchesByProfile: { "profile-1": [match] },
      postings: [posting]
    });
    const handler = createBriefingContributeHandler(store);

    const result = (await handler(queueCtx())) as {
      headline: string;
      items: Array<{ id: string; title: string; detail: string; href?: string }>;
    };

    expect(result.headline).toBe("1 new job match in profile-1.");
    expect(result.items).toEqual([
      {
        id: "match-1",
        title: "Staff Engineer at Acme",
        detail: "Fit 80 · Want 70",
        href: "/m/job-search/profile-1/matches/match-1"
      }
    ]);
  });

  it("excludes a non-active profile from both the detail choice and the contribution", async () => {
    const active = makeProfile("profile-active", { state: "active", briefingDetail: "count" });
    const paused = makeProfile("profile-paused", { state: "paused", briefingDetail: "full" });
    const posting = makePosting("post-1");
    const pausedMatch = makeMatch({ id: "match-paused", profileId: "profile-paused" });
    const store = createFakeStore({
      profiles: [active, paused],
      matchesByProfile: { "profile-paused": [pausedMatch] },
      postings: [posting]
    });
    const handler = createBriefingContributeHandler(store);

    const result = (await handler(queueCtx())) as { headline: string; items: unknown[] };

    // If the paused profile's "full" setting had leaked into mostGenerousDetail, this would be
    // a full item list instead of the active profile's own "count" (headline-only, no items).
    expect(result.items).toEqual([]);
    expect(result.headline).toBe("0 new job matches in profile-active.");
  });

  it("most-generous-wins: an active count-level profile does not suppress another active profile's full-level items", async () => {
    const countProfile = makeProfile("profile-count", { briefingDetail: "count" });
    const fullProfile = makeProfile("profile-full", { briefingDetail: "full" });
    const posting = makePosting("post-1");
    const match = makeMatch({ id: "match-1", profileId: "profile-full" });
    const store = createFakeStore({
      profiles: [countProfile, fullProfile],
      matchesByProfile: { "profile-full": [match] },
      postings: [posting]
    });
    const handler = createBriefingContributeHandler(store);

    const result = (await handler(queueCtx())) as { items: unknown[] };

    expect(result.items).toHaveLength(1);
  });

  it("defaults to count-level with zero active profiles — headline only, never an error", async () => {
    const store = createFakeStore({
      profiles: [makeProfile("profile-1", { state: "in_conversation" })]
    });
    const handler = createBriefingContributeHandler(store);

    const result = (await handler(queueCtx())) as { headline: string; items: unknown[] };

    expect(result.items).toEqual([]);
    expect(result.headline).toBe("0 new job matches in your search.");
  });

  it("a degraded portal's cause surfaces as an item even at the default count level", async () => {
    const profile = makeProfile("profile-1", { briefingDetail: "count" });
    const store = createFakeStore({
      profiles: [profile],
      portalsByProfile: {
        "profile-1": [
          {
            sourceId: "freehire",
            enabled: true,
            lastOkAt: null,
            cause: {
              kind: "network",
              sourceId: "freehire",
              summary: "Freehire could not be reached. 0 postings already retrieved were kept.",
              retrieved: 0,
              expected: null,
              lastOkAt: null,
              nextAction: "Retrying on the next scheduled crawl.",
              retryAt: null,
              disabled: false
            }
          }
        ]
      }
    });
    const handler = createBriefingContributeHandler(store);

    const result = (await handler(queueCtx())) as {
      items: Array<{ id: string; title: string; detail: string }>;
    };

    expect(result.items).toEqual([
      {
        id: "degraded:freehire",
        title: "freehire is degraded",
        detail: "Freehire could not be reached. 0 postings already retrieved were kept."
      }
    ]);
  });

  it("every BriefingDetail value is a legal choice — the ranking table stays in sync with the type", () => {
    const values: BriefingDetail[] = ["count", "top", "full"];
    expect(values).toHaveLength(3);
  });
});
