import { describe, expect, it } from "vitest";

import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";
import type {
  JobSearchStore,
  PostingWithEmbedding,
  Profile,
  Resume
} from "../../external-modules/job-search/src/domain/store-port.js";
import { createCriteriaSetHandler } from "../../external-modules/job-search/src/worker/handlers/profile.js";

const EMPTY_CRITERIA: SearchCriteria = {
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
};

function makeProfile(criteria: SearchCriteria, state: Profile["state"] = "in_conversation") {
  return {
    id: "p1",
    name: "Test Profile",
    state,
    criteria,
    contextSummary: null,
    schedule: null,
    briefingDetail: "count",
    surfaceKey: "surface-1",
    createdAt: new Date(0).toISOString()
  } satisfies Profile;
}

/** The focused criteria seam needs only these store operations. Missing operations stay absent so
 * an unexpected handler dependency fails immediately instead of being hidden by a broad fake. */
function createCriteriaStore(initialProfile: Profile) {
  const state = { profile: initialProfile, criteriaWrites: 0 };
  const store = {
    getProfile: async (id: string) => (id === state.profile.id ? state.profile : null),
    updateCriteria: async (_id: string, criteria: SearchCriteria) => {
      state.criteriaWrites++;
      state.profile = { ...state.profile, criteria };
    },
    listPortals: async () => [],
    setProfileState: async (_id: string, profileState: Profile["state"]) => {
      state.profile = { ...state.profile, state: profileState };
    },
    listUnscoredPostingsWithEmbeddings: async () => [],
    getLatestResume: async () => undefined,
    upsertMatch: async () => true,
    claimCriteriaRescore: async () => [
      { profileId: state.profile.id, criteria: state.profile.criteria }
    ],
    finishCriteriaRescore: async () => undefined
  } as unknown as JobSearchStore;

  return { state, store };
}

function queueInput(params: Record<string, unknown>): Record<string, unknown> {
  return {
    actorUserId: "u1",
    jobKind: "criteria.set",
    idempotencyKey: "criteria-test",
    params
  };
}

function inputCtx(input: Record<string, unknown>): ModuleWorkerContext {
  return { input } as unknown as ModuleWorkerContext;
}

function scoringCtx(
  params: Record<string, unknown>,
  ports: Partial<Pick<ModuleWorkerContext, "embed" | "ai" | "notify">> = {}
): ModuleWorkerContext {
  return {
    input: queueInput(params),
    deadlineAt: Date.now() + 60_000,
    embed: ports.embed ?? {
      embedQuery: async () => {
        throw new Error("unexpected embed call");
      }
    },
    ai: ports.ai ?? {
      generateStructured: async () => {
        throw new Error("unexpected model call");
      }
    },
    notify: ports.notify ?? { post: async () => undefined }
  } as unknown as ModuleWorkerContext;
}

describe("job-search queued criteria rescoring", () => {
  it("re-scores invalidated matches with the saved criteria snapshot and no notification", async () => {
    const profile = makeProfile({ ...EMPTY_CRITERIA, titles: ["Staff Engineer"] });
    const { store } = createCriteriaStore(profile);
    const resume: Resume = {
      id: "resume-1",
      version: 1,
      content: "Ten years shipping backend systems.",
      updatedAt: new Date(0).toISOString()
    };
    const posting: PostingWithEmbedding = {
      id: "post-1",
      sourceId: "freehire",
      externalId: "ext-1",
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://example.test/post-1",
      body: "Ship TypeScript services.",
      postedAt: null,
      embedding: [1, 0, 0]
    };
    const upserted: Parameters<JobSearchStore["upsertMatch"]>[1][] = [];
    const upsertOptions: Parameters<JobSearchStore["upsertMatch"]>[2][] = [];
    const notifications: unknown[] = [];
    const scorableStore: JobSearchStore = {
      ...store,
      getLatestResume: async () => resume,
      listUnscoredPostingsWithEmbeddings: async () => [posting],
      upsertMatch: async (_profileId, match, options) => {
        upserted.push(match);
        upsertOptions.push(options);
        return true;
      }
    };

    const result = await createCriteriaSetHandler(scorableStore)(
      scoringCtx(
        {
          profileId: "p1",
          criteriaJson: JSON.stringify({ mustHave: ["TypeScript"] })
        },
        {
          embed: {
            embedQuery: async () => [1, 0, 0],
            embedDocuments: async () => {
              throw new Error("runScore never embeds documents");
            },
            dimensions: async () => 3
          },
          ai: {
            generateStructured: async () => ({
              ok: true,
              object: {
                fit: 80,
                fitDisposition: "supported",
                want: 70,
                fitReason: "Strong overlap",
                wantReason: "Matches goals"
              }
            })
          },
          notify: {
            post: async (notification) => {
              notifications.push(notification);
            }
          }
        }
      )
    );

    expect(result).toMatchObject({
      profileId: "p1",
      unchanged: false,
      rescore: {
        ok: true,
        attempted: true,
        scored: 1,
        failed: 0,
        deferred: 0,
        aiCallsUsed: 1,
        halted: null
      }
    });
    expect(upserted).toEqual([
      expect.objectContaining({ postingId: "post-1", fit: 80, want: 70, state: "new" })
    ]);
    expect(upsertOptions).toEqual([
      {
        criteriaSnapshot: expect.objectContaining({
          titles: ["Staff Engineer"],
          mustHave: ["TypeScript"]
        })
      }
    ]);
    expect(notifications).toEqual([]);
  });

  it("keeps a committed criteria save successful when scoring fails", async () => {
    const { state, store } = createCriteriaStore(
      makeProfile({ ...EMPTY_CRITERIA, titles: ["Staff Engineer"] })
    );
    const failingStore: JobSearchStore = {
      ...store,
      listUnscoredPostingsWithEmbeddings: async () => {
        throw new Error("scoring unavailable");
      }
    };

    const result = await createCriteriaSetHandler(failingStore)(
      scoringCtx({
        profileId: "p1",
        criteriaJson: JSON.stringify({ mustHave: ["TypeScript"] })
      })
    );

    expect(result).toMatchObject({
      profileId: "p1",
      unchanged: false,
      rescore: { ok: false, attempted: true, cause: "scoring unavailable" },
      statusText: "Search criteria updated"
    });
    expect(state.profile.criteria.mustHave).toEqual(["TypeScript"]);
  });

  it("treats set-like permutations as no-ops while scalar changes remain effective", async () => {
    const criteria: SearchCriteria = {
      ...EMPTY_CRITERIA,
      titles: ["Staff Engineer", "Platform Engineer"],
      seniority: ["staff", "senior"],
      locations: ["Seattle", "Portland"],
      excludeCompanies: ["Acme", "Globex"],
      mustHave: ["TypeScript", "Postgres"],
      niceToHave: ["Kubernetes", "Rust"],
      dealbreakers: ["On-call every week", "No remote work"]
    };
    const { state, store } = createCriteriaStore(makeProfile(criteria));

    const result = await createCriteriaSetHandler(store)(
      inputCtx(
        queueInput({
          profileId: "p1",
          criteriaJson: JSON.stringify({
            titles: [...criteria.titles].reverse(),
            seniority: [...criteria.seniority].reverse(),
            locations: [...criteria.locations].reverse(),
            excludeCompanies: [...criteria.excludeCompanies].reverse(),
            mustHave: [...criteria.mustHave].reverse(),
            niceToHave: [...criteria.niceToHave].reverse(),
            dealbreakers: [...criteria.dealbreakers].reverse()
          })
        })
      )
    );

    expect(result).toMatchObject({
      profileId: "p1",
      unchanged: true,
      rescore: null,
      statusText: "Search criteria updated"
    });
    expect(state.criteriaWrites).toBe(0);

    const scalarChange = await createCriteriaSetHandler(store)(
      inputCtx({ profileId: "p1", criteria: { remote: "required" } })
    );
    expect(scalarChange).toMatchObject({
      unchanged: false,
      rescore: { ok: true, attempted: false }
    });
    expect(state.criteriaWrites).toBe(1);
  });

  it("runs an equivalent rescore-only continuation without rewriting criteria", async () => {
    const criteria: SearchCriteria = {
      ...EMPTY_CRITERIA,
      titles: ["Staff Engineer"],
      wantNarrative: "Small team, real ownership"
    };
    const { state, store } = createCriteriaStore(makeProfile(criteria, "active"));
    let scoreReads = 0;
    const countingStore: JobSearchStore = {
      ...store,
      listUnscoredPostingsWithEmbeddings: async () => {
        scoreReads++;
        return [];
      }
    };

    const result = await createCriteriaSetHandler(countingStore)(
      scoringCtx({
        profileId: "p1",
        criteriaJson: JSON.stringify(criteria),
        rescoreOnly: true
      })
    );

    expect(result).toMatchObject({
      profileId: "p1",
      unchanged: true,
      rescore: {
        ok: true,
        attempted: true,
        scored: 0,
        failed: 0,
        deferred: 0,
        aiCallsUsed: 0,
        halted: null
      }
    });
    expect(state.criteriaWrites).toBe(0);
    expect(scoreReads).toBe(1);
  });
});
