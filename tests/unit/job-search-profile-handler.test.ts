// tests/unit/job-search-profile-handler.test.ts
//
// Task 16 (#1300): the conversation/profile/résumé/settings tools — job-search.profile.create,
// job-search.profile.list, job-search.criteria.set, job-search.profile.set-context,
// job-search.profile.set-briefing-detail, job-search.resume.set, job-search.resume.get,
// job-search.portal.set-enabled, job-search.portal.list.
//
// Drives the nine handler factories directly against a small in-memory fake of Task 13's
// `JobSearchStore` — never the SDK runtime, never a real Postgres connection. `ctx()` below is
// a Proxy that throws on any access to a `ModuleWorkerContext` field other than `input`: every
// handler in this task is documented as "the same four steps: validate, call the store, shape
// a record, return it", and this proxy is what makes "a handler never enqueues, notifies, or
// reaches an adapter" a structural guarantee rather than an assertion about absence of a field.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { CONTEXT_SUMMARY_MAX } from "../../external-modules/job-search/src/domain/criteria.js";
import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";
import type {
  BriefingDetail,
  JobSearchStore,
  PortalState,
  Profile,
  Resume
} from "../../external-modules/job-search/src/domain/store-port.js";
import {
  createCriteriaSetHandler,
  createProfileBootstrapHandler,
  createProfileCreateHandler,
  createProfileListHandler,
  createSetBriefingDetailHandler,
  createSetContextHandler
} from "../../external-modules/job-search/src/worker/handlers/profile.js";
import {
  createResumeGetHandler,
  createResumeSetHandler
} from "../../external-modules/job-search/src/worker/handlers/resume.js";
import {
  createPortalListHandler,
  createPortalSetEnabledHandler
} from "../../external-modules/job-search/src/worker/handlers/portal.js";

// --- test fixtures -----------------------------------------------------------------------

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

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "Test Profile",
    state: overrides.state ?? "in_conversation",
    criteria: overrides.criteria ?? EMPTY_CRITERIA,
    contextSummary: overrides.contextSummary ?? null,
    schedule: overrides.schedule ?? null,
    briefingDetail: overrides.briefingDetail ?? "count",
    surfaceKey: overrides.surfaceKey ?? "surface-1",
    createdAt: overrides.createdAt ?? new Date(0).toISOString()
  };
}

/** A handler that reaches for a capability this fake does not implement is a handler that has
 * drifted outside the nine tools' declared job (store read/write, never a crawl or a score) —
 * `notImplemented` turns that drift into a thrown error rather than a silent `undefined`. */
function notImplemented(name: string) {
  return (): never => {
    throw new Error(`fake store: ${name} is not part of Task 16's contract`);
  };
}

function createFakeStore(seedProfiles: Profile[] = []) {
  const profiles = new Map<string, Profile>(seedProfiles.map((profile) => [profile.id, profile]));
  const portals = new Map<string, PortalState[]>();
  const resumes = new Map<string, Resume[]>();

  const store: JobSearchStore = {
    listProfiles: async () => [...profiles.values()],
    getProfile: async (id) => profiles.get(id) ?? null,
    createProfile: async (name) => {
      const profile = makeProfile({ id: `p${profiles.size + 1}`, name });
      profiles.set(profile.id, profile);
      return profile;
    },
    updateCriteria: async (id, criteria) => {
      const profile = profiles.get(id);
      if (profile) profiles.set(id, { ...profile, criteria });
    },
    setProfileState: async (profileId, state) => {
      const profile = profiles.get(profileId);
      if (profile) profiles.set(profileId, { ...profile, state });
    },
    setProfileContext: async (profileId, context) => {
      const profile = profiles.get(profileId);
      if (profile) profiles.set(profileId, { ...profile, contextSummary: context });
    },
    setBriefingDetail: async (profileId, detail: BriefingDetail) => {
      const profile = profiles.get(profileId);
      if (profile) profiles.set(profileId, { ...profile, briefingDetail: detail });
    },
    listPortals: async (profileId) => portals.get(profileId) ?? [],
    setPortalState: async (profileId, state) => {
      const existing = portals.get(profileId) ?? [];
      portals.set(profileId, [
        ...existing.filter((portal) => portal.sourceId !== state.sourceId),
        state
      ]);
    },
    upsertPostings: notImplemented("upsertPostings"),
    setEmbedding: notImplemented("setEmbedding"),
    listUnscored: notImplemented("listUnscored"),
    listUnscoredPostingsWithEmbeddings: notImplemented("listUnscoredPostingsWithEmbeddings"),
    listMatches: notImplemented("listMatches"),
    upsertMatch: notImplemented("upsertMatch"),
    setMatchState: notImplemented("setMatchState"),
    getMatch: notImplemented("getMatch"),
    getLatestResume: async (profileId) => {
      const list = resumes.get(profileId) ?? [];
      return list[list.length - 1];
    },
    getResumeVersion: async (profileId, version) => {
      const list = resumes.get(profileId) ?? [];
      return list.find((resume) => resume.version === version);
    },
    setResume: async (profileId, content) => {
      const list = resumes.get(profileId) ?? [];
      const resume: Resume = {
        id: `resume-${list.length + 1}`,
        version: list.length + 1,
        content,
        updatedAt: new Date().toISOString()
      };
      resumes.set(profileId, [...list, resume]);
      return resume;
    },
    getSweepCursor: notImplemented("getSweepCursor"),
    setSweepCursor: notImplemented("setSweepCursor"),
    // Task 24 (#1309) additions to JobSearchStore — out of scope for these eleven handlers
    // (job-search-source-handler.test.ts exercises the real thing against its own fake).
    listCustomSources: notImplemented("listCustomSources"),
    addCustomSource: notImplemented("addCustomSource"),
    removeCustomSource: notImplemented("removeCustomSource"),
    // Task 15 (#1299) addition to JobSearchStore — out of scope for these eleven handlers.
    getPostings: notImplemented("getPostings")
  };

  return { store, profiles, portals, resumes };
}

/** Every handler under test touches only `ctx.input` — reaching for `fetch`, `kv`, `notify`,
 * `ai`, `db`, or `auth` is out of scope for these nine tools by design (validate → store →
 * shape → return, nothing else). Throwing on any other property access makes that a structural
 * fact the test suite enforces rather than a claim in a comment. */
function ctx(input: Record<string, unknown>): ModuleWorkerContext {
  return new Proxy(
    { input },
    {
      get(target, prop) {
        if (prop === "input") return target.input;
        throw new Error(
          `handler touched ctx.${String(prop)} — Task 16 handlers only read ctx.input`
        );
      }
    }
  ) as ModuleWorkerContext;
}

// --- tests ---------------------------------------------------------------------------------

describe("job-search conversation/profile/résumé/settings tools (#1300)", () => {
  it("1. flips an in_conversation profile to active once criteria completes it, enqueuing nothing", async () => {
    const { store, portals } = createFakeStore([makeProfile({ id: "p1" })]);
    portals.set("p1", [{ sourceId: "freehire", enabled: true, lastOkAt: null, cause: null }]);
    const handler = createCriteriaSetHandler(store);

    const result = await handler(
      ctx({
        actorUserId: "u1",
        profileId: "p1",
        criteria: { titles: ["Staff Engineer"], wantNarrative: "Something ambitious" }
      })
    );

    // The ctx proxy above already proves no queue/notify capability was touched; this checks
    // the other half — the returned record itself carries no "queued"/"jobId"-shaped field.
    expect(result).toEqual({
      profileId: "p1",
      state: "active",
      completedSteps: ["role", "want", "sources"],
      readyToCrawl: true
    });
    expect((await store.getProfile("p1"))?.state).toBe("active");
  });

  // profile.bootstrap is the queue-only handler behind the module's empty state (the browser
  // cannot invoke a write tool over REST, and the model calling profile.create was a coin flip
  // that dead-ended the first click on a live instance). It must be safe to run twice: the
  // queue's 5s manual singleton does not cover the panel's "Try again" or a pg-boss retry, and a
  // second empty profile would put a switcher on screen that the user never asked for.
  it("1b. profile.bootstrap creates the first profile and returns the existing one on a rerun", async () => {
    const { store } = createFakeStore([]);
    const handler = createProfileBootstrapHandler(store);
    // A queue envelope, not a flat tool input — this handler is only ever reached from the
    // `job-search.profile-bootstrap` queue, and the live path failed exactly here once: reading it
    // with `stripEnvelope` left the host's own `jobKind` in place and the unknown-key check
    // rejected it, so every bootstrap job errored and the empty state waited forever.
    const envelope = (n: number) => ({
      actorUserId: "u1",
      jobKind: "profile.bootstrap",
      idempotencyKey: `k${n}`,
      params: {}
    });

    const first = await handler(ctx(envelope(1)));
    expect(first).toMatchObject({ name: "My job search", state: "in_conversation", created: true });

    const second = await handler(ctx(envelope(2)));
    expect(second).toMatchObject({ profileId: first.profileId, created: false });
    expect(await store.listProfiles()).toHaveLength(1);
  });

  it("2. an incomplete profile stays in_conversation and reports which steps are missing", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createCriteriaSetHandler(store);

    const result = await handler(
      ctx({ profileId: "p1", criteria: { titles: ["Staff Engineer"] } })
    );

    expect(result).toEqual({
      profileId: "p1",
      state: "in_conversation",
      completedSteps: ["role"],
      readyToCrawl: false
    });
  });

  it("2b. a second criteria.set keeps what the first one recorded", async () => {
    // The live failure: the seed prompt tells the model to save each answer the moment it hears
    // it, and criteria.set replaced the whole record — so saving the role wiped the want narrative
    // and put the "want" chip back to not-done, with the transcript still showing both as saved.
    // Asserting through the handler's own completedSteps rather than by reading the store, because
    // completedSteps is what the onboarding screen renders and the user's evidence of the loss.
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createCriteriaSetHandler(store);

    await handler(ctx({ profileId: "p1", criteria: { wantNarrative: "Small team, real ownership" } }));
    const second = await handler(ctx({ profileId: "p1", criteria: { titles: ["Staff Engineer"] } }));

    expect(second).toMatchObject({ completedSteps: ["role", "want"] });
    const stored = await store.getProfile("p1");
    expect(stored?.criteria.wantNarrative).toBe("Small team, real ownership");
    expect(stored?.criteria.titles).toEqual(["Staff Engineer"]);
  });

  it("2c. a criteria.set that sets nothing fails instead of reporting success", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createCriteriaSetHandler(store);

    await expect(handler(ctx({ profileId: "p1", criteria: {} }))).rejects.toThrow(
      /at least one field/
    );
  });

  it("3. profile.list reports completedSteps and readyToCrawl per profile", async () => {
    const { store, portals } = createFakeStore([
      makeProfile({
        id: "p1",
        name: "Ready",
        state: "active",
        criteria: { ...EMPTY_CRITERIA, titles: ["Eng"], wantNarrative: "x" },
        // Distinct from "p1" and from the other profile's surfaceKey, so this test also catches
        // a regression to emitting the row id (or a shared constant) instead of the real column
        // (Task 17/#1301's binding deviation fix).
        surfaceKey: "surface-p1"
      }),
      makeProfile({ id: "p2", name: "Fresh", surfaceKey: "surface-p2" })
    ]);
    portals.set("p1", [{ sourceId: "freehire", enabled: true, lastOkAt: null, cause: null }]);
    const handler = createProfileListHandler(store);

    const result = await handler(ctx({ actorUserId: "u1" }));

    expect(result).toEqual({
      profiles: [
        {
          profileId: "p1",
          name: "Ready",
          state: "active",
          briefingDetail: "count",
          completedSteps: ["role", "want", "sources"],
          readyToCrawl: true,
          surfaceKey: "surface-p1"
        },
        {
          profileId: "p2",
          name: "Fresh",
          state: "in_conversation",
          briefingDetail: "count",
          completedSteps: [],
          readyToCrawl: false,
          surfaceKey: "surface-p2"
        }
      ]
    });
  });

  it("4. resume.set bumps the version and keeps the prior row", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const setHandler = createResumeSetHandler(store);

    const first = await setHandler(ctx({ profileId: "p1", content: "v1 text" }));
    expect(first).toEqual({ profileId: "p1", version: 1, updatedAt: expect.any(String) });

    const second = await setHandler(ctx({ profileId: "p1", content: "v2 text" }));
    expect(second).toEqual({ profileId: "p1", version: 2, updatedAt: expect.any(String) });

    expect(await store.getResumeVersion("p1", 1)).toMatchObject({ version: 1, content: "v1 text" });
    expect(await store.getLatestResume("p1")).toMatchObject({ version: 2, content: "v2 text" });
  });

  it("5. keeps the crawl path out of the résumé handlers (no adapters/ports import)", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../external-modules/job-search/src/worker/handlers/resume.ts", import.meta.url)
      ),
      "utf8"
    );
    expect(source).not.toMatch(/from ["'].*\/ports\.js["']/);
    expect(source).not.toMatch(/from ["'].*\/adapters\//);
  });

  describe("6. every handler strips actorUserId but rejects a genuinely unknown key", () => {
    const cases: Array<{
      name: string;
      build: (store: JobSearchStore) => (input: ModuleWorkerContext) => Promise<unknown>;
      valid: Record<string, unknown>;
    }> = [
      { name: "profile.create", build: createProfileCreateHandler, valid: { name: "New Profile" } },
      { name: "profile.list", build: createProfileListHandler, valid: {} },
      {
        name: "criteria.set",
        build: createCriteriaSetHandler,
        // Non-empty on purpose: `criteria: {}` is no longer a valid call — a patch that sets
        // nothing is rejected rather than saved as a no-op — so an empty one here would fail this
        // envelope test for a reason that has nothing to do with envelopes.
        valid: { profileId: "p1", criteria: { titles: ["Eng"] } }
      },
      {
        name: "profile.set-context",
        build: createSetContextHandler,
        valid: { profileId: "p1", summary: "context" }
      },
      {
        name: "profile.set-briefing-detail",
        build: createSetBriefingDetailHandler,
        valid: { profileId: "p1", detail: "count" }
      },
      {
        name: "resume.set",
        build: createResumeSetHandler,
        valid: { profileId: "p1", content: "resume text" }
      },
      { name: "resume.get", build: createResumeGetHandler, valid: { profileId: "p1" } },
      {
        name: "portal.set-enabled",
        build: createPortalSetEnabledHandler,
        valid: { profileId: "p1", sourceId: "freehire", enabled: true }
      },
      { name: "portal.list", build: createPortalListHandler, valid: { profileId: "p1" } }
    ];

    for (const testCase of cases) {
      it(`${testCase.name} accepts the actorUserId envelope and rejects an unknown key`, async () => {
        const { store } = createFakeStore([makeProfile({ id: "p1" })]);
        const handler = testCase.build(store);

        // The host spreads actorUserId onto every tool input (#1300's standing rule) — a
        // strict validator strips it rather than rejecting the call.
        await expect(handler(ctx({ ...testCase.valid, actorUserId: "u1" }))).resolves.toBeTruthy();

        // A field the tool's own schema does not declare is a real error, named by key —
        // whether the tool used validateProfileInput (Task 13) or its own local check.
        await expect(handler(ctx({ ...testCase.valid, bogus: "nope" }))).rejects.toThrow(
          /unknown key: bogus/
        );
      });
    }
  });

  it("7. profile.set-context rejects an over-length summary instead of truncating it", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createSetContextHandler(store);

    await handler(ctx({ profileId: "p1", summary: "first summary" }));

    const tooLong = "x".repeat(CONTEXT_SUMMARY_MAX + 1);
    await expect(handler(ctx({ profileId: "p1", summary: tooLong }))).rejects.toThrow(
      /1200 characters or fewer/
    );

    // Rejected, not silently trimmed to the cap: the prior stored value is untouched.
    expect((await store.getProfile("p1"))?.contextSummary).toBe("first summary");
  });

  it("8. profile.set-context replaces the summary wholesale, never appends", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createSetContextHandler(store);

    await handler(ctx({ profileId: "p1", summary: "first summary" }));
    await handler(ctx({ profileId: "p1", summary: "second summary" }));

    expect((await store.getProfile("p1"))?.contextSummary).toBe("second summary");
  });

  it("9. profile.set-briefing-detail accepts exactly count, top, or full and rejects a fourth value", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createSetBriefingDetailHandler(store);

    for (const detail of ["count", "top", "full"] as const) {
      await expect(handler(ctx({ profileId: "p1", detail }))).resolves.toEqual({
        profileId: "p1",
        briefingDetail: detail
      });
    }

    await expect(handler(ctx({ profileId: "p1", detail: "verbose" }))).rejects.toThrow(
      /detail must be one of count, top, full/
    );
  });

  it("10. no handler result carries a blended score field", async () => {
    const { store, portals } = createFakeStore([makeProfile({ id: "p1" })]);
    portals.set("p1", [{ sourceId: "freehire", enabled: true, lastOkAt: null, cause: null }]);

    const results: unknown[] = [];
    results.push(await createProfileCreateHandler(store)(ctx({ name: "New" })));
    results.push(await createProfileListHandler(store)(ctx({})));
    results.push(
      await createCriteriaSetHandler(store)(
        ctx({ profileId: "p1", criteria: { titles: ["Eng"], wantNarrative: "x" } })
      )
    );
    results.push(
      await createSetContextHandler(store)(ctx({ profileId: "p1", summary: "context" }))
    );
    results.push(
      await createSetBriefingDetailHandler(store)(ctx({ profileId: "p1", detail: "top" }))
    );
    results.push(await createResumeSetHandler(store)(ctx({ profileId: "p1", content: "resume" })));
    results.push(await createResumeGetHandler(store)(ctx({ profileId: "p1" })));
    results.push(
      await createPortalSetEnabledHandler(store)(
        ctx({ profileId: "p1", sourceId: "freehire", enabled: false })
      )
    );
    results.push(await createPortalListHandler(store)(ctx({ profileId: "p1" })));

    // L9: Fit and Want are never blended into one score, anywhere in this module.
    const serialized = JSON.stringify(results);
    for (const forbidden of [
      /"score"/i,
      /"overall"/i,
      /"combinedScore"/i,
      /"matchScore"/i,
      /"rank"/i
    ]) {
      expect(serialized).not.toMatch(forbidden);
    }
  });

  // Case 11 ("the manifest declares exactly these eleven handlers") was removed here, not lost.
  // It compared the manifest against a hand-typed list of eleven names, and said so itself: "There
  // is no landed registry (Task 13's index.ts) to import this list from yet, so this is the
  // independent source of truth the manifest is checked against." That premise stopped being true
  // when `7c4ac2e7` landed `worker/registry.ts`'s HANDLERS map, and the list then went stale the
  // moment Task 15 added the crawl handlers — a hand-maintained roster in one task's test file
  // fails every time a *different* task adds a handler, with no clear owner to fix it.
  //
  // The replacement is strictly stronger and lives in
  // `tests/unit/job-search-manifest.test.ts:192` — describe("registry.ts's HANDLERS map vs. the
  // manifest's declared handler names (#1299)"). It checks both directions against the real
  // imported HANDLERS map rather than a retyped copy, covers `worker.queues[].handler` and
  // `briefing.handler` as well as `assistantTools[].handler` (this case only ever read the last
  // of the three), and carries its own vacuous-pass floor.
});
