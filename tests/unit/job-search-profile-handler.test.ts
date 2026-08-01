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
  PostingWithEmbedding,
  Profile,
  Resume
} from "../../external-modules/job-search/src/domain/store-port.js";
import type { Match } from "../../external-modules/job-search/src/domain/records.js";
import {
  createCriteriaSetHandler,
  createProfileBootstrapHandler,
  createProfileCreateHandler,
  createProfileGetHandler,
  createProfileListHandler,
  createProfileRenameHandler,
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
    renameProfile: async (id, name) => {
      const profile = profiles.get(id);
      if (profile) profiles.set(id, { ...profile, name });
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
    countMatches: notImplemented("countMatches"),
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
    // A no-op that answers, not a thrower: `resume.set` calls it on every save, and this fake
    // keeps no matches at all, so "nothing was cleared" is the honest answer here.
    listUnfittedPostingsWithEmbeddings: async () => [],
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

/** `resume.set` is the one tool here that legitimately reaches past `ctx.input`. Task #110 made it
 * run scoring inline, because `ModuleWorkerContext` has no way to enqueue a follow-up pass — so
 * without an inline rescore, saving a résumé leaves every Fit empty until the next 6-hourly sweep.
 * That means it needs `embed`/`ai`/`notify`/`deadlineAt`.
 * Rather than loosen `ctx()` for all nine tools and lose the structural guarantee it enforces,
 * this widens the allowed set for that one handler and keeps everything else strict.
 *
 * Ports below are shaped to match the real contracts (`EmbedPort`/`AiPort`/`NotifyPort` in
 * `worker/stages/score.ts`, `ModuleNotifyPort` in `module-sdk/src/worker.ts`) — `embedQuery`/
 * `embedDocuments`/`dimensions`, `generateStructured`, `post` — not guessed names. This variant's
 * ports all throw, so `resume.set`'s fake store never even needs to reach them (see `createFakeStore`'s
 * `notImplemented` stubs below, which throw first); `scoringCtxWith` overrides individual ports for
 * tests that need scoring to actually run. */
function scoringCtx(input: Record<string, unknown>): ModuleWorkerContext {
  return scoringCtxWith(input, {});
}

function scoringCtxWith(
  input: Record<string, unknown>,
  overrides: Partial<{
    embed: unknown;
    ai: unknown;
    notify: unknown;
    deadlineAt: number;
  }>
): ModuleWorkerContext {
  const allowed: Record<string, unknown> = {
    input,
    deadlineAt: overrides.deadlineAt ?? Date.now() + 60_000,
    embed: overrides.embed ?? {
      embedQuery: async () => {
        throw new Error("no embedder in this unit test");
      },
      embedDocuments: async () => {
        throw new Error("no embedder in this unit test");
      },
      dimensions: async () => {
        throw new Error("no embedder in this unit test");
      }
    },
    ai: overrides.ai ?? {
      generateStructured: async () => {
        throw new Error("no model in this unit test");
      }
    },
    notify: overrides.notify ?? {
      post: async () => undefined
    }
  };
  return new Proxy(allowed, {
    get(target, prop) {
      if (prop in target) return target[String(prop)];
      throw new Error(`handler touched ctx.${String(prop)} — not part of resume.set's contract`);
    }
  }) as unknown as ModuleWorkerContext;
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
      readyToCrawl: true,
      statusText: "Search criteria updated"
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
      readyToCrawl: false,
      statusText: "Search criteria updated"
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

    await handler(
      ctx({ profileId: "p1", criteria: { wantNarrative: "Small team, real ownership" } })
    );
    const second = await handler(
      ctx({ profileId: "p1", criteria: { titles: ["Staff Engineer"] } })
    );

    expect(second).toMatchObject({ completedSteps: ["role", "want"] });
    const stored = await store.getProfile("p1");
    expect(stored?.criteria.wantNarrative).toBe("Small team, real ownership");
    expect(stored?.criteria.titles).toEqual(["Staff Engineer"]);
  });

  it("2bb. criteria.set accepts the manual queue envelope used by the profile editor", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const handler = createCriteriaSetHandler(store);

    await expect(
      handler(
        ctx({
          actorUserId: "u1",
          jobKind: "criteria.set",
          idempotencyKey: "criteria-1",
          params: {
            profileId: "p1",
            criteriaJson: JSON.stringify({ titles: ["Platform Architect"] })
          }
        })
      )
    ).resolves.toMatchObject({ profileId: "p1", statusText: "Search criteria updated" });
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

  it("3b. portal.list includes both built-in boards before either one has been configured", async () => {
    const { store, portals } = createFakeStore([makeProfile({ id: "p1" })]);
    portals.set("p1", [
      {
        sourceId: "linkedin",
        enabled: true,
        lastOkAt: "2026-07-31T17:01:20.588Z",
        cause: null
      }
    ]);

    const result = await createPortalListHandler(store)(ctx({ profileId: "p1" }));

    expect(result).toEqual({
      portals: [
        {
          sourceId: "freehire",
          label: "freehire.me",
          enabled: false,
          lastOkAt: null,
          cause: null
        },
        {
          sourceId: "linkedin",
          label: "LinkedIn",
          enabled: true,
          lastOkAt: "2026-07-31T17:01:20.588Z",
          cause: null
        }
      ]
    });
  });

  it("4. resume.set bumps the version and keeps the prior row", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const setHandler = createResumeSetHandler(store);

    // Asserted with toEqual, not toMatchObject, so a handler that grew an extra field — in
    // particular a resurrected count of deleted matches — fails here rather than passing quietly.
    // `rescore` is #110's inline scoring pass. Its outcome isn't pinned here — there is no real
    // embedder or model in a unit test, and scoring has its own suites — but it must be *present*,
    // and the save must still report success around it. That second half is the point: scoring is
    // caught and never rethrown, because the résumé row has already committed by then and letting
    // the error escape would make pg-boss retry the whole handler and bump the version again.
    const first = await setHandler(scoringCtx({ profileId: "p1", content: "v1 text" }));
    expect(first).toEqual({
      profileId: "p1",
      version: 1,
      updatedAt: expect.any(String),
      unchanged: false,
      statusText: "Résumé saved",
      rescore: expect.any(Object)
    });

    const second = await setHandler(scoringCtx({ profileId: "p1", content: "v2 text" }));
    expect(second).toEqual({
      profileId: "p1",
      version: 2,
      updatedAt: expect.any(String),
      unchanged: false,
      statusText: "Résumé saved",
      rescore: expect.any(Object)
    });

    expect(await store.getResumeVersion("p1", 1)).toMatchObject({ version: 1, content: "v1 text" });
    expect(await store.getLatestResume("p1")).toMatchObject({ version: 2, content: "v2 text" });
  });

  it("4a. re-saving byte-identical content is idempotent — no new version, no repair pass", async () => {
    // The invocation timeout that kills this handler is not catchable, so pg-boss can re-enter it
    // after the résumé row has already committed (observed live: an identical version 2). The
    // queue carries retryLimit: 0 for that reason, but the guard belongs in the handler too — it
    // is equally right for a user who uploads the same file twice. `unchanged: true` is what makes
    // the handler skip the Fit-empty repair pass: those matches were scored against this very
    // text, so re-scoring them would spend a model call per posting to write the same number back.
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const setHandler = createResumeSetHandler(store);

    await setHandler(scoringCtx({ profileId: "p1", content: "same text" }));
    const again = await setHandler(scoringCtx({ profileId: "p1", content: "same text" }));

    expect(again).toEqual({
      profileId: "p1",
      version: 1,
      updatedAt: expect.any(String),
      unchanged: true,
      statusText: "Résumé unchanged",
      rescore: expect.any(Object)
    });
    expect(await store.getResumeVersion("p1", 2)).toBeUndefined();
  });

  it("4b. a résumé save actually triggers a scoring pass — a candidate gets scored and written", async () => {
    // Test 4 above deliberately doesn't pin what `rescore` contains (no real embedder/model in a
    // unit test). This one gives `runScore` everything it needs to do real work, so "resume.set
    // triggers scoring" is proven end to end rather than just "scoring was attempted."
    const profile = makeProfile({
      id: "p1",
      criteria: { ...EMPTY_CRITERIA, titles: ["Staff Engineer"] }
    });
    const { store } = createFakeStore([profile]);
    const posting: PostingWithEmbedding = {
      id: "post-1",
      sourceId: "freehire",
      externalId: "ext-1",
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://example.test/post-1",
      body: "Ship things that matter.",
      postedAt: null,
      embedding: [1, 0, 0]
    };
    const upserted: Array<Omit<Match, "id">> = [];
    const scorableStore: JobSearchStore = {
      ...store,
      // Stateful on purpose: the handler scores in batches until a batch comes back empty, so a
      // fake that returns the same posting forever would report it scored once per batch. A real
      // store stops offering a posting the moment its match row exists.
      listUnscoredPostingsWithEmbeddings: async () => (upserted.length > 0 ? [] : [posting]),
      upsertMatch: async (_profileId, match) => {
        upserted.push(match);
      }
    };
    const setHandler = createResumeSetHandler(scorableStore);

    const result = await setHandler(
      scoringCtxWith(
        { profileId: "p1", content: "Ten years shipping backend systems." },
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
          }
        }
      )
    );

    expect(result).toMatchObject({
      profileId: "p1",
      rescore: { ok: true, scored: 1, failed: 0, deferred: 0, aiCallsUsed: 1, halted: null }
    });
    expect(upserted).toEqual([
      expect.objectContaining({ postingId: "post-1", fit: 80, want: 70, state: "new" })
    ]);
  });

  it("4c. a scoring failure still reports the save as succeeded, with a structured cause", async () => {
    // The default fake store's scoring-related methods are all `notImplemented` (they're out of
    // scope for these nine tools by design), so `runScore` throws almost immediately here. The
    // point isn't which method threw — it's that the throw never reaches the caller: the save
    // above it already committed, and `saveResumeContent`'s try/catch turns the throw into a
    // structured `{ok: false, cause}` field rather than failing the whole handler (which would
    // make pg-boss's retryLimit re-run the write and bump the version again for an unrelated
    // reason — see the doc comment on `saveResumeContent` in worker/handlers/resume.ts).
    const { store } = createFakeStore([makeProfile({ id: "p1" })]);
    const setHandler = createResumeSetHandler(store);

    const result = await setHandler(scoringCtx({ profileId: "p1", content: "résumé text" }));

    expect(result).toMatchObject({
      profileId: "p1",
      version: 1,
      rescore: {
        ok: false,
        cause: expect.stringContaining("listUnscoredPostingsWithEmbeddings")
      }
    });
    // The save itself is unaffected: the résumé is on file at the version the handler reported.
    expect(await store.getLatestResume("p1")).toMatchObject({ version: 1, content: "résumé text" });
  });

  it("4d. repairs Fit-empty matches in place — scores them again, never deletes them", async () => {
    // #110's whole ruling, in one test. Postings scored before the profile had a résumé carry an
    // empty Fit forever, because the ordinary candidate read is a NOT EXISTS over the match table.
    // The obvious repair is to delete those rows so they read as unscored again, and that is the
    // trap: deleting is instant and scoring is ~9s a posting, so the board visibly empties at the
    // moment the user did the one thing meant to improve it — live, 116 rows fell to 56 within five
    // seconds of the save. Bounding the delete only shrank the hole; batching it only bounded the
    // dip. So the repair reads those rows as a second candidate set and `upsertMatch` overwrites
    // them where they sit, and the board's row count never moves at all.
    const profile = makeProfile({
      id: "p1",
      criteria: { ...EMPTY_CRITERIA, titles: ["Staff Engineer"] }
    });
    const { store } = createFakeStore([profile]);

    // A 15-posting Fit-empty backlog, modelled the way the real store behaves: a posting stops
    // being a repair candidate the moment its match row has a Fit, and nothing is ever removed.
    const scored = new Set<string>();
    const upserted: Array<Omit<Match, "id">> = [];
    const backlog: PostingWithEmbedding[] = Array.from({ length: 15 }, (_, index) => ({
      id: `post-${index}`,
      sourceId: "freehire",
      externalId: `ext-${index}`,
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote",
      url: `https://example.test/post-${index}`,
      body: "Ship things that matter.",
      postedAt: null,
      embedding: [1, 0, 0]
    }));
    const repairStore: JobSearchStore = {
      ...store,
      listUnfittedPostingsWithEmbeddings: async () =>
        backlog.filter((posting) => !scored.has(posting.id)),
      // The ordinary pass runs too, and finds nothing: every posting here already has a row.
      listUnscoredPostingsWithEmbeddings: async () => [],
      upsertMatch: async (_profileId, match) => {
        upserted.push(match);
        scored.add(match.postingId);
      }
    };

    const result = await createResumeSetHandler(repairStore)(
      scoringCtxWith(
        { profileId: "p1", content: "Ten years shipping backend systems." },
        {
          deadlineAt: Date.now() + 600_000,
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
          }
        }
      )
    );

    // Every backlog row got a real Fit written over it, and each was written exactly once.
    expect(upserted).toHaveLength(15);
    expect(new Set(upserted.map((match) => match.postingId)).size).toBe(15);
    expect(upserted.every((match) => match.fit === 80)).toBe(true);
    expect(result).toMatchObject({ rescore: { ok: true, scored: 15 } });
    // And the store this handler is given has no way to delete a match at all — the repair cannot
    // regress into the delete-and-refill design without this failing first.
    expect(repairStore).not.toHaveProperty("clearUnfittedMatches");
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
      /** `resume.set` is the one handler here that legitimately reads past `ctx.input` — #110
       * made it run a scoring pass inline, which needs the invocation deadline and the ports. It
       * gets the looser context builder; every other tool keeps the strict one, so the
       * "handlers only read ctx.input" guard still has teeth where it applies. */
      makeCtx?: (input: Record<string, unknown>) => ModuleWorkerContext;
    }> = [
      { name: "profile.create", build: createProfileCreateHandler, valid: { name: "New Profile" } },
      { name: "profile.list", build: createProfileListHandler, valid: {} },
      { name: "profile.get", build: createProfileGetHandler, valid: { profileId: "p1" } },
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
        valid: { profileId: "p1", content: "resume text" },
        makeCtx: scoringCtx
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
        const makeCtx = testCase.makeCtx ?? ctx;

        // The host spreads actorUserId onto every tool input (#1300's standing rule) — a
        // strict validator strips it rather than rejecting the call.
        await expect(
          handler(makeCtx({ ...testCase.valid, actorUserId: "u1" }))
        ).resolves.toBeTruthy();

        // A field the tool's own schema does not declare is a real error, named by key —
        // whether the tool used validateProfileInput (Task 13) or its own local check.
        await expect(handler(makeCtx({ ...testCase.valid, bogus: "nope" }))).rejects.toThrow(
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
        briefingDetail: detail,
        statusText: "Briefing detail updated"
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
    results.push(
      await createResumeSetHandler(store)(scoringCtx({ profileId: "p1", content: "resume" }))
    );
    results.push(await createResumeGetHandler(store)(ctx({ profileId: "p1" })));
    results.push(await createProfileGetHandler(store)(ctx({ profileId: "p1" })));
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

  it("12. profile.get returns exactly the profile fields used by the direct editor", async () => {
    const { store } = createFakeStore([
      makeProfile({
        id: "p1",
        criteria: { ...EMPTY_CRITERIA, titles: ["Staff Engineer"] },
        contextSummary: "Wants a remote staff role."
      })
    ]);

    const result = await createProfileGetHandler(store)(ctx({ profileId: "p1" }));

    // Exact key set, not just "contains" — state/schedule/surfaceKey must not ride along.
    expect(Object.keys(result as Record<string, unknown>).sort()).toEqual(
      ["contextSummary", "criteria", "name", "profileId"].sort()
    );
    expect(result).toEqual({
      profileId: "p1",
      name: "Test Profile",
      criteria: { ...EMPTY_CRITERIA, titles: ["Staff Engineer"] },
      contextSummary: "Wants a remote staff role."
    });
  });

  it("12b. profile.get throws profileId not found for a profile that doesn't exist, matching this file's own idiom (criteria.set/set-context)", async () => {
    const { store } = createFakeStore([]);

    await expect(createProfileGetHandler(store)(ctx({ profileId: "missing" }))).rejects.toThrow(
      /profileId not found/
    );
  });

  it("renames a profile from the queue envelope", async () => {
    const { store } = createFakeStore([makeProfile({ id: "p1", name: "Old name" })]);

    const result = await createProfileRenameHandler(store)(
      ctx({
        actorUserId: "user-1",
        jobKind: "profile.rename",
        idempotencyKey: "rename-1",
        params: { profileId: "p1", name: "Platform architecture" }
      })
    );

    expect(result).toMatchObject({ profileId: "p1", name: "Platform architecture" });
    await expect(store.getProfile("p1")).resolves.toMatchObject({
      name: "Platform architecture"
    });
  });
});
