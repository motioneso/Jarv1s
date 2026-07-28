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
  createMatchGetHandler,
  createMatchSetStateHandler,
  MATCHES_LIST_MAX_LIMIT,
  SETTABLE_STATES,
  TITLE_MAX_CHARS,
  URL_MAX_CHARS
} from "../../external-modules/job-search/src/worker/handlers/matches.js";
import type { Match, Posting } from "../../external-modules/job-search/src/domain/records.js";
import type { JobSearchStore } from "../../external-modules/job-search/src/domain/store-port.js";

// N39 removed `REASON_MAX_CHARS` from matches.ts entirely — there is no longer a row-level
// reason cap to import. `MatchDetail` is deliberately untruncated, so these tests use a plain,
// arbitrarily-large local length to prove "longer than any cap that used to exist" without
// depending on a constant the production code no longer has a reason to define.
const LONG_REASON_LENGTH = 400;

function notUsed(name: string) {
  return async () => {
    throw new Error(`FakeStore.${name} should not be called`);
  };
}

function createFakeStore(input: {
  matches?: Match[];
  postings?: Posting[];
  // Defaults to a lookup against `matches` by id — enough for the common "found" case. Tests
  // exercising a not-found path (wrong id, wrong owner, a synthetic unscored id) override this
  // directly rather than contorting `matches` to produce a miss.
  getMatchImpl?: (matchId: string) => Promise<Match | null>;
}): JobSearchStore & {
  __listMatchesCalls: Array<{ profileId: string; limit: number }>;
  __setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }>;
  __getMatchCalls: string[];
} {
  const matches = input.matches ?? [];
  const postingsById = new Map((input.postings ?? []).map((posting) => [posting.id, posting]));
  const listMatchesCalls: Array<{ profileId: string; limit: number }> = [];
  const setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }> = [];
  const getMatchCalls: string[] = [];
  const getMatchImpl =
    input.getMatchImpl ??
    (async (matchId: string) => matches.find((match) => match.id === matchId) ?? null);

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
    getMatch: vi.fn(async (matchId: string) => {
      getMatchCalls.push(matchId);
      return getMatchImpl(matchId);
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
    __setMatchStateCalls: setMatchStateCalls,
    __getMatchCalls: getMatchCalls
  } as JobSearchStore & {
    __listMatchesCalls: Array<{ profileId: string; limit: number }>;
    __setMatchStateCalls: Array<{ matchId: string; state: Match["state"] }>;
    __getMatchCalls: string[];
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
    // N39: no fitReason/wantReason on the row — board.tsx never renders them. If this still
    // passes with a reason key present, N39 hasn't actually landed.
    expect(Object.keys(item).sort()).toEqual(
      ["company", "fit", "id", "outsideFrame", "state", "title", "url", "want"].sort()
    );
    expect(item).toEqual({
      id: "match-1",
      title: "Staff Engineer",
      company: "Acme",
      fit: 80,
      want: 70,
      outsideFrame: false,
      state: "new",
      url: "https://example.com/post-1"
    });
    // Never the blended field the product invariant forbids anywhere, including tool results.
    expect(item).not.toHaveProperty("overall");
    expect(item).not.toHaveProperty("combinedScore");
    expect(item).not.toHaveProperty("matchScore");
    expect(item).not.toHaveProperty("rank");
    // N39: reasons are detail-only now, not merely truncated to nothing on the row.
    expect(item).not.toHaveProperty("fitReason");
    expect(item).not.toHaveProperty("wantReason");
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

  it("worst case render-survival: MATCHES_LIST_MAX_LIMIT matches with every field maxed stay <=80% of the tool-result render cap", async () => {
    // packages/ai/src/routes.ts's boundedAssistantToolResultData substitutes {text: "…truncated"}
    // past 16 000 RENDERED characters — and `renderToolResult` (module-sdk) renders a uniform
    // flat array of scalars as a markdown table, not JSON.stringify. Past that cap the board has
    // nothing to render at all, not a short list, so this drives every text field the row still
    // carries post-N39 (the posting's title/company — which this module doesn't control the
    // length of — and #1330's `url`; NOT fitReason/wantReason, which N39 removed from the row
    // entirely) to its cap and checks the REAL render function, not an approximation of it.
    // Targets <=80% (12 800), not merely under 16 000, per N38: a field added later must not
    // silently blow the budget with no headroom to notice it in a diff.
    const MAX_RENDERED_TOOL_RESULT_CHARS = 16_000;
    const RENDER_HEADROOM_TARGET = MAX_RENDERED_TOOL_RESULT_CHARS * 0.8;
    const longTitle = "t".repeat(TITLE_MAX_CHARS + 200);
    const longCompany = "c".repeat(COMPANY_MAX_CHARS + 200);
    const longUrl = `https://example.com/${"u".repeat(URL_MAX_CHARS + 200)}`;
    const matches = Array.from({ length: MATCHES_LIST_MAX_LIMIT }, (_, i) =>
      makeMatch({
        id: `match-${i}`,
        postingId: `post-${i}`,
        outsideFrame: true,
        state: "dismissed"
      })
    );
    const postings = Array.from({ length: MATCHES_LIST_MAX_LIMIT }, (_, i) =>
      makePosting(`post-${i}`, { title: longTitle, company: longCompany, url: longUrl })
    );
    const store = createFakeStore({ matches, postings });
    const handler = createMatchesListHandler(store);

    const result = (await handler(
      toolCtx({ profileId: "profile-1", limit: MATCHES_LIST_MAX_LIMIT })
    )) as Record<string, unknown>;

    const rendered = renderToolResult({ data: result });
    expect(rendered.length).toBeLessThan(MAX_RENDERED_TOOL_RESULT_CHARS);
    expect(rendered.length).toBeLessThanOrEqual(RENDER_HEADROOM_TARGET);
  });

  it("N39 ceiling: the real <=80% row-count boundary for the reason-free row is 30, not 31", async () => {
    // Pins the arithmetic behind matches.ts's N39 comment as a committed test, not just a scratch
    // script's output. `MATCHES_LIST_MAX_LIMIT` is intentionally held below this boundary (15 for
    // now, 25 once `board.tsx` is synced in the same commit — see the constant's own comment) —
    // this test proves the boundary itself so a future change to title/company/url's caps, or to
    // the chosen limit, is checked against the real ceiling rather than a remembered number.
    const MAX_RENDERED_TOOL_RESULT_CHARS = 16_000;
    const RENDER_HEADROOM_TARGET = MAX_RENDERED_TOOL_RESULT_CHARS * 0.8;
    const longTitle = "t".repeat(TITLE_MAX_CHARS);
    const longCompany = "c".repeat(COMPANY_MAX_CHARS);
    const longUrl = `https://example.com/${"u".repeat(URL_MAX_CHARS - "https://example.com/".length)}`;

    // Real match ids are Postgres uuids (36 chars) — matters here because id is unbounded and
    // this test is about the real byte budget, not the short fixture ids `makeMatch` defaults to.
    function uuidShaped(i: number): string {
      return `${i}`.padStart(8, "0") + "-aaaa-bbbb-cccc-" + `${i}`.padStart(12, "0");
    }
    function renderAt(limit: number): string {
      const matches = Array.from({ length: limit }, (_, i) =>
        makeMatch({
          id: uuidShaped(i),
          postingId: `post-${i}`,
          outsideFrame: true,
          state: "dismissed"
        })
      );
      const postings = Array.from({ length: limit }, (_, i) =>
        makePosting(`post-${i}`, { title: longTitle, company: longCompany, url: longUrl })
      );
      return renderToolResult({
        data: { items: matches.map((match, i) => toBoardShape(match, postings[i]!)) }
      });
    }
    function toBoardShape(match: Match, posting: Posting) {
      return {
        id: match.id,
        title: posting.title.slice(0, TITLE_MAX_CHARS),
        company: posting.company.slice(0, COMPANY_MAX_CHARS),
        fit: match.fit,
        want: match.want,
        outsideFrame: match.outsideFrame,
        state: match.state,
        url: posting.url.slice(0, URL_MAX_CHARS)
      };
    }

    expect(renderAt(30).length).toBeLessThanOrEqual(RENDER_HEADROOM_TARGET);
    expect(renderAt(31).length).toBeGreaterThan(RENDER_HEADROOM_TARGET);
  });
});

describe("createMatchGetHandler", () => {
  it("rejects an unknown key", async () => {
    const store = createFakeStore({});
    const handler = createMatchGetHandler(store);

    await expect(handler(toolCtx({ matchId: "match-1", extra: 1 }))).rejects.toThrow(
      /unknown key: extra/
    );
    expect(store.getMatch).not.toHaveBeenCalled();
  });

  it("requires matchId", async () => {
    const store = createFakeStore({});
    const handler = createMatchGetHandler(store);

    await expect(handler(toolCtx({}))).rejects.toThrow(/matchId is required/);
    expect(store.getMatch).not.toHaveBeenCalled();
  });

  it("returns the untruncated detail for a found match, including the posting url — assert the exact keys", async () => {
    const longReason = "x".repeat(LONG_REASON_LENGTH);
    const match = makeMatch({
      id: "match-1",
      postingId: "post-1",
      fitReason: longReason,
      wantReason: longReason
    });
    const posting = makePosting("post-1", { title: "Staff Engineer", company: "Acme" });
    const store = createFakeStore({ matches: [match], postings: [posting] });
    const handler = createMatchGetHandler(store);

    const result = (await handler(toolCtx({ matchId: "match-1" }))) as {
      match: Record<string, unknown>;
    };

    expect(store.__getMatchCalls).toEqual(["match-1"]);
    // Pinned separately from matches.ts's BoardMatch key list (test 5, above): the two shapes
    // diverge on purpose. If MatchDetail ever grows a truncateText call, or loses a reason key
    // to match BoardMatch, this fails loudly rather than silently.
    expect(Object.keys(result.match).sort()).toEqual(
      [
        "company",
        "fit",
        "fitReason",
        "id",
        "outsideFrame",
        "state",
        "title",
        "url",
        "want",
        "wantReason"
      ].sort()
    );
    // The whole point of this handler: a reason far longer than any cap that ever existed on the
    // row path comes back whole, proving this is a genuinely different read path from
    // matches.list, not the same truncation reapplied. If a truncateText call is reintroduced
    // here, this assertion — not just a length check — catches it.
    expect(result).toEqual({
      matchId: "match-1",
      match: {
        id: "match-1",
        title: "Staff Engineer",
        company: "Acme",
        url: "https://example.com/post-1",
        fit: 80,
        want: 70,
        fitReason: longReason,
        wantReason: longReason,
        outsideFrame: false,
        state: "new"
      }
    });
  });

  it("returns match: null for an id the store doesn't resolve (wrong owner, deleted, or a synthetic unscored id)", async () => {
    const store = createFakeStore({ getMatchImpl: async () => null });
    const handler = createMatchGetHandler(store);

    const result = await handler(toolCtx({ matchId: "post-42" }));

    expect(result).toEqual({ matchId: "post-42", match: null });
  });

  it("returns match: null when the match's posting has since been removed", async () => {
    const match = makeMatch({ id: "match-1", postingId: "post-gone" });
    const store = createFakeStore({ matches: [match], postings: [] });
    const handler = createMatchGetHandler(store);

    const result = await handler(toolCtx({ matchId: "match-1" }));

    expect(result).toEqual({ matchId: "match-1", match: null });
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
