// tests/unit/job-search-match-handler.test.ts
//
// Task 15 (#1299): matches.list (the board's only read route, `risk: "read"`, called with
// `invokeTool` directly from the browser) and match.set-state (one handler, two shapes — a
// manual-run queue envelope from the board, or a tool call from the assistant's
// `job-search.match.dismiss`, which always sets `state: "dismissed"`).
import { describe, expect, it, vi } from "vitest";

import { renderToolResult } from "@jarv1s/module-sdk";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import {
  COMPANY_MAX_CHARS,
  createMatchesListHandler,
  createMatchSetStateHandler,
  MATCHES_LIST_MAX_LIMIT,
  REASON_MAX_CHARS,
  SETTABLE_STATES,
  TITLE_MAX_CHARS
} from "../../external-modules/job-search/src/worker/handlers/matches.js";
import type { Match, Posting } from "../../external-modules/job-search/src/domain/records.js";
import type { JobSearchStore } from "../../external-modules/job-search/src/domain/store-port.js";

function notUsed(name: string) {
  return async () => {
    throw new Error(`FakeStore.${name} should not be called`);
  };
}

function createFakeStore(input: { matches?: Match[]; postings?: Posting[] }): JobSearchStore & {
  __listMatchesCalls: Array<{ profileId: string; limit: number }>;
  __setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }>;
} {
  const matches = input.matches ?? [];
  const postingsById = new Map((input.postings ?? []).map((posting) => [posting.id, posting]));
  const listMatchesCalls: Array<{ profileId: string; limit: number }> = [];
  const setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }> = [];

  return {
    listProfiles: vi.fn(notUsed("listProfiles")),
    getProfile: vi.fn(notUsed("getProfile")),
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
    listUnscoredPostingsWithEmbeddings: vi.fn(notUsed("listUnscoredPostingsWithEmbeddings")),
    listMatches: vi.fn(async (profileId: string, limit: number) => {
      listMatchesCalls.push({ profileId, limit });
      return matches;
    }),
    upsertMatch: vi.fn(notUsed("upsertMatch")),
    setMatchState: vi.fn(async (matchId: string, state: Match["state"]) => {
      setMatchStateCalls.push({ matchId, state });
    }),
    getLatestResume: vi.fn(notUsed("getLatestResume")),
    getResumeVersion: vi.fn(notUsed("getResumeVersion")),
    setResume: vi.fn(notUsed("setResume")),
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
    }),
    __listMatchesCalls: listMatchesCalls,
    __setMatchStateCalls: setMatchStateCalls
  } as JobSearchStore & {
    __listMatchesCalls: Array<{ profileId: string; limit: number }>;
    __setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }>;
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

function toolCtx(input: Record<string, unknown>): ModuleWorkerContext {
  return { input: { ...input, actorUserId: "user-1" } } as unknown as ModuleWorkerContext;
}

function queueCtx(params: Record<string, unknown>): ModuleWorkerContext {
  return {
    input: {
      actorUserId: "user-1",
      jobKind: "job-search.match-state",
      idempotencyKey: "idem-1",
      params
    }
  } as unknown as ModuleWorkerContext;
}

describe("createMatchesListHandler", () => {
  it("test 1: no limit throws and does not default; same for 0, 101, and 1.5", async () => {
    const store = createFakeStore({});
    const handler = createMatchesListHandler(store);

    await expect(handler(toolCtx({ profileId: "profile-1" }))).rejects.toThrow(/limit/);
    await expect(handler(toolCtx({ profileId: "profile-1", limit: 0 }))).rejects.toThrow(/limit/);
    await expect(handler(toolCtx({ profileId: "profile-1", limit: 101 }))).rejects.toThrow(/limit/);
    await expect(handler(toolCtx({ profileId: "profile-1", limit: 1.5 }))).rejects.toThrow(/limit/);
    expect(store.listMatches).not.toHaveBeenCalled();
  });

  it("rejects a limit above the render-survival cap", async () => {
    const store = createFakeStore({});
    const handler = createMatchesListHandler(store);

    await expect(
      handler(toolCtx({ profileId: "profile-1", limit: MATCHES_LIST_MAX_LIMIT + 1 }))
    ).rejects.toThrow(/limit/);
    await expect(
      handler(toolCtx({ profileId: "profile-1", limit: MATCHES_LIST_MAX_LIMIT }))
    ).resolves.toBeDefined();
  });

  it("test 2: profileId and limit reach the store unchanged", async () => {
    const store = createFakeStore({ matches: [], postings: [] });
    const handler = createMatchesListHandler(store);

    await handler(toolCtx({ profileId: "profile-77", limit: 12 }));

    expect(store.__listMatchesCalls).toEqual([{ profileId: "profile-77", limit: 12 }]);
  });

  it("test 5: returns board records, never a raw store row — assert the exact keys", async () => {
    const match = makeMatch({ id: "match-1", postingId: "post-1", fit: 80, want: 70 });
    const posting = makePosting("post-1", { title: "Staff Engineer", company: "Acme" });
    const store = createFakeStore({ matches: [match], postings: [posting] });
    const handler = createMatchesListHandler(store);

    const result = (await handler(toolCtx({ profileId: "profile-1", limit: 10 }))) as {
      items: Array<Record<string, unknown>>;
    };

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(Object.keys(item).sort()).toEqual(
      [
        "id",
        "title",
        "company",
        "fit",
        "want",
        "fitReason",
        "wantReason",
        "outsideFrame",
        "state"
      ].sort()
    );
    expect(item).toEqual({
      id: "match-1",
      title: "Staff Engineer",
      company: "Acme",
      fit: 80,
      want: 70,
      fitReason: "Fits well.",
      wantReason: "Wants it.",
      outsideFrame: false,
      state: "new"
    });
    // Never the blended field the product invariant forbids anywhere, including tool results.
    expect(item).not.toHaveProperty("overall");
    expect(item).not.toHaveProperty("combinedScore");
    expect(item).not.toHaveProperty("matchScore");
    expect(item).not.toHaveProperty("rank");
  });

  it("skips a match whose posting has since been removed, rather than throwing", async () => {
    const match = makeMatch({ id: "match-1", postingId: "post-gone" });
    const store = createFakeStore({ matches: [match], postings: [] });
    const handler = createMatchesListHandler(store);

    const result = (await handler(toolCtx({ profileId: "profile-1", limit: 10 }))) as {
      items: unknown[];
    };

    expect(result.items).toEqual([]);
  });

  it("worst case render-survival: 40 matches with maximal text fields stay under the tool-result render cap", async () => {
    // packages/ai/src/routes.ts's boundedAssistantToolResultData substitutes {text: "…truncated"}
    // past 16 000 RENDERED characters — and `renderToolResult` (module-sdk) renders a uniform
    // flat array of scalars as a markdown table, not JSON.stringify. Past that cap the board has
    // nothing to render at all, not a short list, so this drives every text field (reasons AND
    // the posting's title/company, which this module doesn't control the length of) to its cap
    // and checks the REAL render function, not an approximation of it.
    const MAX_RENDERED_TOOL_RESULT_CHARS = 16_000;
    const longReason = "x".repeat(REASON_MAX_CHARS + 200);
    const longTitle = "t".repeat(TITLE_MAX_CHARS + 200);
    const longCompany = "c".repeat(COMPANY_MAX_CHARS + 200);
    const matches = Array.from({ length: MATCHES_LIST_MAX_LIMIT }, (_, i) =>
      makeMatch({
        id: `match-${i}`,
        postingId: `post-${i}`,
        fitReason: longReason,
        wantReason: longReason,
        state: "dismissed"
      })
    );
    const postings = Array.from({ length: MATCHES_LIST_MAX_LIMIT }, (_, i) =>
      makePosting(`post-${i}`, { title: longTitle, company: longCompany })
    );
    const store = createFakeStore({ matches, postings });
    const handler = createMatchesListHandler(store);

    const result = (await handler(
      toolCtx({ profileId: "profile-1", limit: MATCHES_LIST_MAX_LIMIT })
    )) as Record<string, unknown>;

    const rendered = renderToolResult({ data: result });
    expect(rendered.length).toBeLessThan(MAX_RENDERED_TOOL_RESULT_CHARS);
  });
});

describe("createMatchSetStateHandler", () => {
  it("test 3: state outside the settable set throws and calls the store zero times", async () => {
    const store = createFakeStore({});
    const handler = createMatchSetStateHandler(store);

    await expect(handler(queueCtx({ matchId: "match-1", state: "archived" }))).rejects.toThrow(
      /state must be one of/
    );
    expect(store.setMatchState).not.toHaveBeenCalled();
  });

  it("test 4: each of the three legal states calls the store exactly once with that state", async () => {
    for (const state of SETTABLE_STATES) {
      const store = createFakeStore({});
      const handler = createMatchSetStateHandler(store);

      await handler(queueCtx({ matchId: "match-1", state }));

      expect(store.__setMatchStateCalls).toEqual([{ matchId: "match-1", state }]);
    }
  });

  it("the assistant's dismiss tool shape always sets dismissed, with no state field on its input", async () => {
    const store = createFakeStore({});
    const handler = createMatchSetStateHandler(store);

    const result = await handler(toolCtx({ matchId: "match-9" }));

    expect(result).toEqual({ matchId: "match-9", state: "dismissed" });
    expect(store.__setMatchStateCalls).toEqual([{ matchId: "match-9", state: "dismissed" }]);
  });

  it("the dismiss tool shape rejects an unexpected key rather than accepting a caller-supplied state", async () => {
    const store = createFakeStore({});
    const handler = createMatchSetStateHandler(store);

    await expect(handler(toolCtx({ matchId: "match-9", state: "seen" }))).rejects.toThrow(
      /unknown key: state/
    );
    expect(store.setMatchState).not.toHaveBeenCalled();
  });
});
