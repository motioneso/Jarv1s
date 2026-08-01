// tests/unit/job-search-crawl-stage.test.ts
//
// Task 14 (#1298): unit tests for the crawl stage, against an in-memory fake `JobSearchStore`
// and fake `Portal`s — no SDK, no network, no model. Every method on the fake store is a
// `vi.fn()` so a test can assert not just the resulting state but which calls did or did not
// happen (test 4's "never crawled" and test 6's "never writes fit or want" both depend on that).

import { describe, expect, it, vi } from "vitest";
import {
  runCrawl,
  type EmbedPort
} from "../../external-modules/job-search/src/worker/stages/crawl.js";
import {
  describeFailure,
  type FailureCause,
  type Posting,
  type SearchCriteria
} from "../../external-modules/job-search/src/domain/records.js";
import type {
  JobSearchStore,
  Profile,
  PortalState
} from "../../external-modules/job-search/src/domain/store-port.js";
import type {
  CrawlResult,
  FetchLike,
  Portal
} from "../../external-modules/job-search/src/adapters/types.js";

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
    wantNarrative: "",
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

function makePosting(overrides: Partial<Posting> & { id: string; sourceId: string }): Posting {
  return {
    externalId: overrides.id,
    title: "Staff Engineer",
    company: `Company for ${overrides.id}`,
    location: "Remote",
    url: `https://example.com/${overrides.id}`,
    body: `Full description for ${overrides.id}`,
    postedAt: null,
    ...overrides
  };
}

/** Every method is a `vi.fn()` wrapping a tiny in-memory implementation, so tests can assert
 * on call counts/args as well as on the resulting state. Methods `runCrawl` never touches
 * (listProfiles, createProfile, ...) still need a body — they throw, so a test that
 * accidentally depends on one fails loudly instead of silently returning `undefined`. */
function createFakeStore(
  profile: Profile,
  priorPortalStates: readonly PortalState[] = []
): JobSearchStore {
  const profiles = new Map<string, Profile>([[profile.id, profile]]);
  const portalStates = new Map<string, PortalState>(priorPortalStates.map((s) => [s.sourceId, s]));
  const postings = new Map<string, Posting>();
  const embeddings = new Map<string, readonly number[]>();

  const notUsed = (name: string) => async () => {
    throw new Error(`FakeStore.${name} should not be called by runCrawl`);
  };

  return {
    listProfiles: vi.fn(notUsed("listProfiles")),
    getProfile: vi.fn(async (id: string) => profiles.get(id) ?? null),
    createProfile: vi.fn(notUsed("createProfile")),
    renameProfile: vi.fn(notUsed("renameProfile")),
    updateCriteria: vi.fn(notUsed("updateCriteria")),
    setProfileState: vi.fn(notUsed("setProfileState")),
    setProfileContext: vi.fn(notUsed("setProfileContext")),
    setBriefingDetail: vi.fn(notUsed("setBriefingDetail")),
    listPortals: vi.fn(async () => [...portalStates.values()]),
    setPortalState: vi.fn(async (_profileId: string, state: PortalState) => {
      portalStates.set(state.sourceId, state);
    }),
    upsertPostings: vi.fn(async (_profileId: string, incoming: readonly Posting[]) => {
      for (const posting of incoming) postings.set(posting.id, posting);
      return incoming.slice();
    }),
    setEmbedding: vi.fn(async (postingId: string, vector: readonly number[]) => {
      embeddings.set(postingId, vector);
    }),
    listUnscored: vi.fn(notUsed("listUnscored")),
    listUnscoredPostingsWithEmbeddings: vi.fn(notUsed("listUnscoredPostingsWithEmbeddings")),
    listMatches: vi.fn(notUsed("listMatches")),
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
    // Task 24 (#1309) additions to JobSearchStore — runCrawl never touches custom sources.
    listCustomSources: vi.fn(notUsed("listCustomSources")),
    addCustomSource: vi.fn(notUsed("addCustomSource")),
    removeCustomSource: vi.fn(notUsed("removeCustomSource")),
    // Task 15 (#1299) addition to JobSearchStore — runCrawl never reads postings back.
    getPostings: vi.fn(notUsed("getPostings")),
    // Exposed for assertions only; not part of the JobSearchStore surface `runCrawl` sees.
    __postings: postings,
    __embeddings: embeddings,
    __portalStates: portalStates
  } as JobSearchStore & {
    __postings: Map<string, Posting>;
    __embeddings: Map<string, readonly number[]>;
    __portalStates: Map<string, PortalState>;
  };
}

/** An "on" row for a board.
 *
 * `runCrawl` crawls only boards the user has explicitly switched on — a board with no stored row
 * is not crawled. These tests used to rely on the opposite (absent read as enabled), which is
 * what let a live run crawl LinkedIn against a user who had asked for freehire.me and nothing
 * else. Every test below that expects a board to be walked now says so. */
function enabledRow(sourceId: string): PortalState {
  return { sourceId, enabled: true, lastOkAt: null, cause: null };
}

function makePortal(
  id: string,
  crawl: Portal["crawl"] = vi.fn(
    async () => ({ postings: [], failure: null }) satisfies CrawlResult
  )
): Portal {
  return { id, label: `Label for ${id}`, host: `${id}.example.com`, crawl };
}

function healthyCrawl(postings: Posting[]): Portal["crawl"] {
  return vi.fn(async () => ({ postings, failure: null }) satisfies CrawlResult);
}

function failingCrawl(postings: Posting[], failure: FailureCause): Portal["crawl"] {
  return vi.fn(async () => ({ postings, failure }) satisfies CrawlResult);
}

function createFakeEmbed(): EmbedPort & {
  embedDocuments: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
} {
  return {
    embedDocuments: vi.fn(async (texts: readonly string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    embedQuery: vi.fn(async () => {
      throw new Error(
        "embedQuery should not be called by runCrawl — that is the triage stage's job"
      );
    }),
    dimensions: vi.fn(async () => 3)
  };
}

const noopFetch: FetchLike = vi.fn(async () => {
  throw new Error("this test's portals do not call fetch directly");
});

describe("runCrawl", () => {
  it("test 1: a clean crawl stores deduped postings and records lastOkAt for each portal", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [
      enabledRow("freehire"),
      enabledRow("linkedin")
    ]) as ReturnType<typeof createFakeStore> & {
      __postings: Map<string, Posting>;
      __portalStates: Map<string, PortalState>;
    };
    const freehirePosting = makePosting({ id: "fh-1", sourceId: "freehire", company: "Acme" });
    const linkedinPosting = makePosting({ id: "li-1", sourceId: "linkedin", company: "Globex" });
    const portals = [
      makePortal("freehire", healthyCrawl([freehirePosting])),
      makePortal("linkedin", healthyCrawl([linkedinPosting]))
    ];
    const embed = createFakeEmbed();

    const result = await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(result.found).toBe(2);
    expect(result.kept).toBe(2);
    expect(result.degraded).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(store.__postings.has("fh-1")).toBe(true);
    expect(store.__postings.has("li-1")).toBe(true);

    const freehireState = store.__portalStates.get("freehire");
    const linkedinState = store.__portalStates.get("linkedin");
    expect(freehireState).toEqual({
      sourceId: "freehire",
      enabled: true,
      lastOkAt: NOW,
      cause: null
    });
    expect(linkedinState).toEqual({
      sourceId: "linkedin",
      enabled: true,
      lastOkAt: NOW,
      cause: null
    });
  });

  it("test 2: one portal failing does not lose the others' results", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [
      enabledRow("freehire"),
      enabledRow("linkedin")
    ]) as ReturnType<typeof createFakeStore> & {
      __postings: Map<string, Posting>;
      __portalStates: Map<string, PortalState>;
    };
    const freehirePosting = makePosting({ id: "fh-2", sourceId: "freehire", company: "Acme" });
    const linkedinPartial = makePosting({ id: "li-2", sourceId: "linkedin", company: "Initech" });
    const rateLimited = describeFailure({
      kind: "rate_limited",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 1,
      expected: null,
      lastOkAt: null,
      retryAt: null
    });
    const portals = [
      makePortal("freehire", healthyCrawl([freehirePosting])),
      makePortal("linkedin", failingCrawl([linkedinPartial], rateLimited))
    ];
    const embed = createFakeEmbed();

    const result = await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(store.__postings.has("fh-2")).toBe(true);
    expect(store.__postings.has("li-2")).toBe(true);
    expect(result.degraded).toEqual([rateLimited]);

    // N41: result.degraded above is the stage's RETURN value — it says nothing about what got
    // written. This is the actual persisted row (crawl.ts:181's store.setPortalState write), so
    // an implementation that reported the cause but dropped the write would fail here even
    // though every assertion above it still passes.
    const linkedinState = store.__portalStates.get("linkedin");
    expect(linkedinState?.cause?.kind).toBe("rate_limited");
    expect(linkedinState?.enabled).toBe(true);
  });

  it("test 3: a login_required portal is written back with enabled: false", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [enabledRow("linkedin")]) as ReturnType<
      typeof createFakeStore
    > & {
      __portalStates: Map<string, PortalState>;
    };
    const loginRequired = describeFailure({
      kind: "login_required",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 0,
      expected: null,
      lastOkAt: null,
      retryAt: null
    });
    const portals = [makePortal("linkedin", failingCrawl([], loginRequired))];
    const embed = createFakeEmbed();

    await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(store.__portalStates.get("linkedin")?.enabled).toBe(false);
  });

  it("test 4: a disabled portal is not crawled on the next pass", async () => {
    const profile = makeProfile();
    const priorState: PortalState = {
      sourceId: "linkedin",
      enabled: false,
      lastOkAt: null,
      cause: describeFailure({
        kind: "login_required",
        sourceId: "linkedin",
        sourceLabel: "LinkedIn",
        retrieved: 0,
        expected: null,
        lastOkAt: null,
        retryAt: null
      })
    };
    const store = createFakeStore(profile, [priorState, enabledRow("freehire")]);
    const disabledCrawl = healthyCrawl([]);
    const portals = [
      makePortal("linkedin", disabledCrawl),
      makePortal("freehire", healthyCrawl([]))
    ];
    const embed = createFakeEmbed();

    await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(disabledCrawl).not.toHaveBeenCalled();
  });

  it("test 5: postings are embedded in batches of <=128, and embedQuery is never called", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [enabledRow("freehire")]);
    const postings = Array.from({ length: 150 }, (_, index) =>
      makePosting({
        id: `fh-${index}`,
        sourceId: "freehire",
        company: `Company ${index}`,
        title: `Role ${index}`,
        url: `https://example.com/${index}`
      })
    );
    const portals = [makePortal("freehire", healthyCrawl(postings))];
    const embed = createFakeEmbed();

    const result = await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(result.kept).toBe(150);
    expect(embed.embedDocuments).toHaveBeenCalledTimes(2);
    const batchSizes = embed.embedDocuments.mock.calls.map(
      (call: unknown[]) => (call[0] as readonly string[]).length
    );
    expect(batchSizes).toEqual([128, 22]);
    for (const size of batchSizes) expect(size).toBeLessThanOrEqual(128);
    expect(embed.embedQuery).not.toHaveBeenCalled();
  });

  it("test 6: the stage never writes a fit or want value", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [enabledRow("freehire")]);
    const portals = [
      makePortal("freehire", healthyCrawl([makePosting({ id: "fh-6", sourceId: "freehire" })]))
    ];
    const embed = createFakeEmbed();

    await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    // upsertMatch is the only store method that could carry a fit/want value; runCrawl never
    // calls it, leaving the crawled posting visibly `unscored` rather than silently absent.
    expect(store.upsertMatch).not.toHaveBeenCalled();
  });

  it("test 7: stops starting portals past the deadline and reports that it did", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [
      enabledRow("freehire"),
      enabledRow("linkedin")
    ]) as ReturnType<typeof createFakeStore> & {
      __postings: Map<string, Posting>;
    };
    const deadlineAt = 1_000;
    const firstPosting = makePosting({ id: "fh-7", sourceId: "freehire" });
    const firstCrawl = healthyCrawl([firstPosting]);
    const secondCrawl = healthyCrawl([makePosting({ id: "li-7", sourceId: "linkedin" })]);
    const portals = [makePortal("freehire", firstCrawl), makePortal("linkedin", secondCrawl)];
    const embed = createFakeEmbed();

    // One clock() read per loop iteration: the first is before starting portal one (inside the
    // deadline), the second is before starting portal two (the deadline has since passed).
    const clock = vi.fn().mockReturnValueOnce(900).mockReturnValueOnce(1_050);

    const result = await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt,
      clock
    });

    expect(firstCrawl).toHaveBeenCalledTimes(1);
    expect(secondCrawl).not.toHaveBeenCalled();
    expect(store.__postings.has("fh-7")).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("test 8: a portal that throws does not prevent later portals from running", async () => {
    const profile = makeProfile();
    const store = createFakeStore(profile, [
      enabledRow("freehire"),
      enabledRow("linkedin")
    ]) as ReturnType<typeof createFakeStore> & {
      __postings: Map<string, Posting>;
      __portalStates: Map<string, PortalState>;
    };
    const throwingCrawl = vi.fn(async () => {
      throw new Error("invalid_rpc");
    });
    const secondPosting = makePosting({ id: "li-8", sourceId: "linkedin" });
    const secondCrawl = healthyCrawl([secondPosting]);
    const portals = [makePortal("freehire", throwingCrawl), makePortal("linkedin", secondCrawl)];
    const embed = createFakeEmbed();

    await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(secondCrawl).toHaveBeenCalledTimes(1);
    expect(store.__postings.has("li-8")).toBe(true);
    const freehireState = store.__portalStates.get("freehire");
    expect(freehireState?.cause?.kind).toBe("network");
    expect(freehireState?.lastOkAt).toBeNull();
  });

  it("test 8b: a board the user never switched on is not crawled at all", async () => {
    // The live regression this exists to hold shut: the user asked for freehire.me and nothing
    // else, and LinkedIn — never mentioned, no row, absent from the settings screen — supplied
    // 70 of the 89 postings that came back. Asserting on the crawl function itself rather than
    // on the posting count, because "no postings" is also what a board that ran and found
    // nothing looks like; the point is that it never ran.
    const profile = makeProfile();
    const store = createFakeStore(profile, [enabledRow("freehire")]) as ReturnType<
      typeof createFakeStore
    > & { __postings: Map<string, Posting>; __portalStates: Map<string, PortalState> };
    const linkedinCrawl = healthyCrawl([makePosting({ id: "li-8b", sourceId: "linkedin" })]);
    const portals = [
      makePortal("freehire", healthyCrawl([makePosting({ id: "fh-8b", sourceId: "freehire" })])),
      makePortal("linkedin", linkedinCrawl)
    ];

    await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed: createFakeEmbed(),
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(linkedinCrawl).not.toHaveBeenCalled();
    expect(store.__postings.has("fh-8b")).toBe(true);
    expect(store.__postings.has("li-8b")).toBe(false);
    // Nor does a skipped board get a row written as a side effect — it stays invisible until
    // the user turns it on, which is what the settings screen shows them.
    expect(store.__portalStates.has("linkedin")).toBe(false);
  });

  it("test 9: found counts every raw posting, kept counts only what survives dedupe and hard-excludes", async () => {
    // `found === kept` on every test above leaves the distinction unfalsifiable — if dedupe
    // ever moved upstream into the portal walk, `found` would silently become the deduped
    // count and this test is the one that would catch it. Four raw postings go in: freehire's
    // own two, plus linkedin's duplicate-identity copy of freehire's and linkedin's own unique
    // one. Only two survive: the duplicate collapses into freehire's copy (higher source
    // priority), and the excluded-company posting is dropped outright.
    const profile = makeProfile({ criteria: makeCriteria({ excludeCompanies: ["Cegience"] }) });
    const store = createFakeStore(profile, [
      enabledRow("freehire"),
      enabledRow("linkedin")
    ]) as ReturnType<typeof createFakeStore> & {
      __postings: Map<string, Posting>;
    };
    const freehireUnique = makePosting({
      id: "fh-9a",
      sourceId: "freehire",
      company: "Acme",
      title: "Staff Engineer"
    });
    const freehireExcluded = makePosting({
      id: "fh-9b",
      sourceId: "freehire",
      company: "Cegience",
      title: "Staff Engineer"
    });
    const linkedinDuplicate = makePosting({
      id: "li-9a",
      sourceId: "linkedin",
      company: "Acme",
      title: "Staff Engineer"
    });
    const linkedinUnique = makePosting({
      id: "li-9b",
      sourceId: "linkedin",
      company: "Globex",
      title: "Staff Engineer"
    });
    const portals = [
      makePortal("freehire", healthyCrawl([freehireUnique, freehireExcluded])),
      makePortal("linkedin", healthyCrawl([linkedinDuplicate, linkedinUnique]))
    ];
    const embed = createFakeEmbed();

    const result = await runCrawl({
      store,
      portals,
      fetch: noopFetch,
      embed,
      profileId: PROFILE_ID,
      now: NOW,
      deadlineAt: Date.now() + 60_000,
      clock: () => Date.now()
    });

    expect(result.found).toBe(4);
    expect(result.kept).toBe(2);
    expect(store.__postings.has("fh-9a")).toBe(true);
    expect(store.__postings.has("li-9b")).toBe(true);
    expect(store.__postings.has("fh-9b")).toBe(false);
    expect(store.__postings.has("li-9a")).toBe(false);
  });
});
