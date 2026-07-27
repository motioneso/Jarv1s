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
    setSweepCursor: notImplemented("setSweepCursor")
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

  it("3. profile.list reports completedSteps and readyToCrawl per profile", async () => {
    const { store, portals } = createFakeStore([
      makeProfile({
        id: "p1",
        name: "Ready",
        state: "active",
        criteria: { ...EMPTY_CRITERIA, titles: ["Eng"], wantNarrative: "x" }
      }),
      makeProfile({ id: "p2", name: "Fresh" })
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
          readyToCrawl: true
        },
        {
          profileId: "p2",
          name: "Fresh",
          state: "in_conversation",
          briefingDetail: "count",
          completedSteps: [],
          readyToCrawl: false
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
        valid: { profileId: "p1", criteria: {} }
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

  it("11. the manifest declares exactly these nine handlers, checked in both directions", () => {
    const manifestPath = fileURLToPath(
      new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      assistantTools?: Array<{ handler: string }>;
    };
    const manifestHandlers = (manifest.assistantTools ?? []).map((tool) => tool.handler).sort();

    // The nine dotted keys createCriteriaSetHandler/createProfileCreateHandler/etc. above are
    // actually registered under, per profile.ts/resume.ts/portal.ts (Task 16). There is no
    // landed registry (Task 13's index.ts) to import this list from yet, so this is the
    // independent source of truth the manifest is checked against.
    const registeredHandlers = [
      "profile.create",
      "profile.list",
      "criteria.set",
      "profile.set-context",
      "profile.set-briefing-detail",
      "resume.set",
      "resume.get",
      "portal.set-enabled",
      "portal.list"
    ].sort();

    for (const handler of registeredHandlers) {
      expect(manifestHandlers).toContain(handler);
    }
    for (const handler of manifestHandlers) {
      expect(registeredHandlers).toContain(handler);
    }
    expect(manifestHandlers).toEqual(registeredHandlers);
  });
});
