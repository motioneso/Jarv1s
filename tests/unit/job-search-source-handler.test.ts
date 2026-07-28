// tests/unit/job-search-source-handler.test.ts
//
// Task 24 (#1309): job-search.source.add and job-search.source.remove — user-named job board
// sources. Drives the two handler factories directly against a small in-memory fake of
// `JobSearchStore`, matching job-search-profile-handler.test.ts's house style (Task 16) with
// one addition: these are the first handlers in the module to touch `ctx.kv` (the platform
// fetch-host grant), so the `ctx()` proxy here allows exactly `input` and `kv` through and
// throws on everything else (fetch, ai, auth, deadlineAt, notify) — the same structural "never
// reaches an adapter" guarantee, extended by only the one capability these handlers actually
// use.
import { describe, expect, it } from "vitest";

import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { JOB_SEARCH_STATIC_FETCH_HOSTS } from "../../external-modules/job-search/src/db/tables.js";
import type {
  CustomSource,
  JobSearchStore,
  Profile
} from "../../external-modules/job-search/src/domain/store-port.js";
import {
  createSourceAddHandler,
  createSourceRemoveHandler,
  FETCH_HOST_GRANTS_NAMESPACE
} from "../../external-modules/job-search/src/worker/handlers/source.js";

// --- test fixtures -----------------------------------------------------------------------

const EMPTY_CRITERIA = {
  titles: [],
  seniority: [],
  locations: [],
  remote: "no-preference" as const,
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
    state: overrides.state ?? "active",
    criteria: overrides.criteria ?? EMPTY_CRITERIA,
    contextSummary: overrides.contextSummary ?? null,
    schedule: overrides.schedule ?? null,
    briefingDetail: overrides.briefingDetail ?? "count",
    surfaceKey: overrides.surfaceKey ?? "surface-1",
    createdAt: overrides.createdAt ?? new Date(0).toISOString()
  };
}

/** A handler that reaches for a capability this fake does not implement has drifted outside
 * source.add/source.remove's declared job — turns that drift into a thrown error rather than a
 * silent `undefined`, same convention as job-search-profile-handler.test.ts. */
function notImplemented(name: string) {
  return (): never => {
    throw new Error(`fake store: ${name} is not part of Task 24's source handlers' contract`);
  };
}

/** `calls` is shared with the kv fake below so ordering assertions (cases 7-8) read as one
 * timeline, not two separately-asserted mocks that could drift out of sync with each other. */
function createFakeStore(seedProfiles: Profile[] = []) {
  const profiles = new Map<string, Profile>(seedProfiles.map((profile) => [profile.id, profile]));
  const sources = new Map<string, CustomSource[]>();
  const calls: string[] = [];
  let nextId = 1;

  const store: JobSearchStore = {
    listProfiles: notImplemented("listProfiles"),
    getProfile: async (id) => profiles.get(id) ?? null,
    createProfile: notImplemented("createProfile"),
    updateCriteria: notImplemented("updateCriteria"),
    setProfileState: notImplemented("setProfileState"),
    setProfileContext: notImplemented("setProfileContext"),
    setBriefingDetail: notImplemented("setBriefingDetail"),
    listPortals: notImplemented("listPortals"),
    setPortalState: notImplemented("setPortalState"),
    upsertPostings: notImplemented("upsertPostings"),
    setEmbedding: notImplemented("setEmbedding"),
    listUnscored: notImplemented("listUnscored"),
    listUnscoredPostingsWithEmbeddings: notImplemented("listUnscoredPostingsWithEmbeddings"),
    listMatches: notImplemented("listMatches"),
    upsertMatch: notImplemented("upsertMatch"),
    setMatchState: notImplemented("setMatchState"),
    getMatch: notImplemented("getMatch"),
    getLatestResume: notImplemented("getLatestResume"),
    getResumeVersion: notImplemented("getResumeVersion"),
    setResume: notImplemented("setResume"),
    clearUnfittedMatches: notImplemented("clearUnfittedMatches"),
    getSweepCursor: notImplemented("getSweepCursor"),
    setSweepCursor: notImplemented("setSweepCursor"),
    listCustomSources: async (profileId) => {
      calls.push("store.listCustomSources");
      return sources.get(profileId) ?? [];
    },
    addCustomSource: async (profileId, url, label) => {
      calls.push("store.addCustomSource");
      const source: CustomSource = {
        id: `cs${nextId}`,
        sourceId: `custom:cs${nextId}`,
        host: new URL(url).hostname.toLowerCase(),
        label,
        url,
        createdAt: new Date(0).toISOString()
      };
      nextId += 1;
      sources.set(profileId, [...(sources.get(profileId) ?? []), source]);
      return source;
    },
    removeCustomSource: async (profileId, sourceId) => {
      calls.push("store.removeCustomSource");
      const existing = sources.get(profileId) ?? [];
      sources.set(
        profileId,
        existing.filter((candidate) => candidate.sourceId !== sourceId)
      );
    },
    getPostings: notImplemented("getPostings")
  };

  return { store, calls };
}

/** Mirrors `ModuleWorkerContext["kv"]`'s four-method shape exactly, with a real in-memory
 * `Map` per scope+namespace (finance's `fakeKv()` precedent). `deleteThrows` exists solely for
 * case 8's "a kv failure prevents the store call" proof — nothing else in this file needs a kv
 * fake that can fail. */
function createFakeKv(
  calls: string[],
  options: { deleteThrows?: boolean } = {}
): ModuleWorkerContext["kv"] {
  const backing = new Map<string, Map<string, Record<string, unknown>>>();
  const ns = (scope: string, namespace: string) => {
    const nsKey = `${scope}:${namespace}`;
    let map = backing.get(nsKey);
    if (!map) {
      map = new Map();
      backing.set(nsKey, map);
    }
    return map;
  };

  return {
    get: async (scope, namespace, key) => ns(scope, namespace).get(key) ?? null,
    set: async (scope, namespace, key, value) => {
      calls.push(`kv.set ${scope} ${namespace} ${key}`);
      ns(scope, namespace).set(key, value);
    },
    delete: async (scope, namespace, key) => {
      calls.push(`kv.delete ${scope} ${namespace} ${key}`);
      if (options.deleteThrows) throw new Error("kv unavailable");
      return ns(scope, namespace).delete(key);
    },
    list: async (scope, namespace) => [...ns(scope, namespace).keys()]
  };
}

/** Only `input` and `kv` are allowed through — one capability more than
 * job-search-profile-handler.test.ts's version, matching exactly what source.ts's two handlers
 * actually touch. fetch/ai/auth/deadlineAt/notify remain a thrown error, so "never fetches or
 * calls ai" stays a structural guarantee here too, not just a claim in a comment. */
function ctx(input: Record<string, unknown>, kv: ModuleWorkerContext["kv"]): ModuleWorkerContext {
  return new Proxy(
    { input, kv },
    {
      get(target, prop) {
        if (prop === "input") return target.input;
        if (prop === "kv") return target.kv;
        throw new Error(
          `handler touched ctx.${String(prop)} — Task 24's source handlers only read ctx.input/ctx.kv`
        );
      }
    }
  ) as ModuleWorkerContext;
}

// --- tests ---------------------------------------------------------------------------------

describe("job-search custom source tools (#1309)", () => {
  describe("1. source.add rejects an invalid url, naming which check failed", () => {
    const cases: Array<{ name: string; url: string; expected: RegExp }> = [
      { name: "not a URL at all", url: "not a url", expected: /url is not a valid URL/ },
      {
        name: "non-https scheme",
        url: "http://boards.example.com/jobs",
        expected: /url must use https/
      },
      // source.ts's own comment names three causes: `new URL` throwing, a non-https scheme,
      // and a hostname `isPinnableHost` rejects. Only the IP-literal branch of the third cause
      // is reachable through this call site: `requireValidSourceUrl` lowercases the hostname
      // before calling `isPinnableHost` (so an uppercase host never reaches it) and
      // `URL#hostname` never carries a port (so a port never reaches it either). An IPv4
      // literal and a bracketed IPv6 literal are the two hostnames that still trip it here.
      {
        name: "IPv4 literal host",
        url: "https://192.168.0.1/jobs",
        expected: /url host is not a valid fetch host/
      },
      {
        name: "IPv6 literal host",
        url: "https://[::1]/jobs",
        expected: /url host is not a valid fetch host/
      }
    ];

    for (const testCase of cases) {
      it(`rejects ${testCase.name}`, async () => {
        const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
        const kv = createFakeKv(calls);
        const handler = createSourceAddHandler(store);

        await expect(handler(ctx({ profileId: "p1", url: testCase.url }, kv))).rejects.toThrow(
          testCase.expected
        );
        // A rejected validation never reaches the store or the kv grant.
        expect(calls).toEqual([]);
      });
    }
  });

  describe("2. source.add rejects a url whose host already has a built-in adapter", () => {
    for (const host of JOB_SEARCH_STATIC_FETCH_HOSTS) {
      it(`rejects ${host}`, async () => {
        const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
        const kv = createFakeKv(calls);
        const handler = createSourceAddHandler(store);

        await expect(
          handler(ctx({ profileId: "p1", url: `https://${host}/jobs` }, kv))
        ).rejects.toThrow(`${host} already has a built-in source`);
        expect(calls).toEqual([]);
      });
    }
  });

  describe("3. a successful add returns a custom:-prefixed sourceId, defaulting label to the host", () => {
    it("Part A: an omitted label defaults to the host", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const handler = createSourceAddHandler(store);

      // The ctx proxy above already proves no fetch/ai/notify capability was touched; this
      // checks the other half — the returned record's shape.
      const result = await handler(
        ctx({ profileId: "p1", url: "https://boards.example.com/jobs" }, kv)
      );

      expect(result).toEqual({
        profileId: "p1",
        sourceId: "custom:cs1",
        host: "boards.example.com",
        label: "boards.example.com",
        url: "https://boards.example.com/jobs",
        createdAt: new Date(0).toISOString()
      });
    });

    it("Part B: a supplied label is used verbatim instead of the host", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const handler = createSourceAddHandler(store);

      const result = await handler(
        ctx({ profileId: "p1", url: "https://boards.example.com/jobs", label: "My Board" }, kv)
      );

      expect(result).toMatchObject({ label: "My Board" });
    });
  });

  it("4. source.remove rejects a sourceId that is not a custom source, without ever calling the store", async () => {
    const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
    const kv = createFakeKv(calls);
    const handler = createSourceRemoveHandler(store);

    // "freehire" is a built-in portal's sourceId, not a "custom:"-prefixed one — this must be
    // rejected by the prefix check alone, before the store is ever asked about it.
    await expect(handler(ctx({ profileId: "p1", sourceId: "freehire" }, kv))).rejects.toThrow(
      /sourceId is not a custom source/
    );
    expect(calls).toEqual([]);
  });

  it("5. a removed source no longer appears in listCustomSources, even though its portal health row is left orphaned", async () => {
    const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
    const kv = createFakeKv(calls);
    const seeded = await store.addCustomSource("p1", "https://boards.example.com/jobs", "Boards");
    calls.length = 0; // seeding above went straight through the store, not the handler
    const handler = createSourceRemoveHandler(store);

    await handler(ctx({ profileId: "p1", sourceId: seeded.sourceId }, kv));

    // Whether store-sql.ts's best-effort job_search_portals delete actually lands is a real
    // Postgres concern proven at the integration layer (module-worker-rpc.test.ts); this fake
    // only models the one thing store-port.ts's own doc comment guarantees at the interface
    // level — deleting the job_search_custom_sources row is what makes the source disappear
    // from this list, independent of whatever happens to its health row.
    expect(await store.listCustomSources("p1")).toEqual([]);
  });

  describe("6. every handler strips actorUserId but rejects a genuinely unknown key", () => {
    it("source.add accepts the actorUserId envelope and rejects an unknown key", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const handler = createSourceAddHandler(store);

      await expect(
        handler(
          ctx({ actorUserId: "u1", profileId: "p1", url: "https://boards.example.com/jobs" }, kv)
        )
      ).resolves.toBeTruthy();

      await expect(
        handler(ctx({ profileId: "p1", url: "https://other.example.com/jobs", bogus: "nope" }, kv))
      ).rejects.toThrow(/unknown key: bogus/);
    });

    it("source.remove accepts the actorUserId envelope and rejects an unknown key", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const seeded = await store.addCustomSource("p1", "https://boards.example.com/jobs", "Boards");
      const handler = createSourceRemoveHandler(store);

      await expect(
        handler(ctx({ actorUserId: "u1", profileId: "p1", sourceId: seeded.sourceId }, kv))
      ).resolves.toBeTruthy();

      // requireNoUnknownKeys runs before the sourceId is even looked up, so a bogus sourceId
      // in the same call would not change which error surfaces here.
      await expect(
        handler(ctx({ profileId: "p1", sourceId: "custom:missing", bogus: "nope" }, kv))
      ).rejects.toThrow(/unknown key: bogus/);
    });
  });

  describe("7. source.add writes the store before the platform grant, in that order", () => {
    it("a successful add calls store.addCustomSource then kv.set, never the reverse", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const handler = createSourceAddHandler(store);

      await handler(ctx({ profileId: "p1", url: "https://boards.example.com/jobs" }, kv));

      expect(calls).toEqual([
        "store.addCustomSource",
        `kv.set user ${FETCH_HOST_GRANTS_NAMESPACE} boards.example.com`
      ]);
    });

    it("the built-in-host business rejection never reaches the store or kv.set", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const handler = createSourceAddHandler(store);

      await expect(
        handler(ctx({ profileId: "p1", url: "https://www.linkedin.com/jobs" }, kv))
      ).rejects.toThrow(/already has a built-in source/);
      expect(calls).toEqual([]);
    });

    it("a genuine store.addCustomSource failure prevents kv.set from ever being called", async () => {
      const { store: fakeStore, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const kv = createFakeKv(calls);
      const store: JobSearchStore = {
        ...fakeStore,
        addCustomSource: async () => {
          calls.push("store.addCustomSource");
          throw new Error("duplicate row");
        }
      };
      const handler = createSourceAddHandler(store);

      await expect(
        handler(ctx({ profileId: "p1", url: "https://boards.example.com/jobs" }, kv))
      ).rejects.toThrow(/duplicate row/);
      expect(calls).toEqual(["store.addCustomSource"]);
    });
  });

  describe("8. source.remove revokes the platform grant before deleting the store row, in that order", () => {
    it("a successful remove resolves the host via listCustomSources, then calls kv.delete, then store.removeCustomSource", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const seeded = await store.addCustomSource("p1", "https://boards.example.com/jobs", "Boards");
      calls.length = 0; // seeding above went straight through the store, not the handler
      const kv = createFakeKv(calls);
      const handler = createSourceRemoveHandler(store);

      await handler(ctx({ profileId: "p1", sourceId: seeded.sourceId }, kv));

      expect(calls).toEqual([
        "store.listCustomSources",
        `kv.delete user ${FETCH_HOST_GRANTS_NAMESPACE} boards.example.com`,
        "store.removeCustomSource"
      ]);
    });

    it("a kv.delete failure prevents store.removeCustomSource from ever being called", async () => {
      const { store, calls } = createFakeStore([makeProfile({ id: "p1" })]);
      const seeded = await store.addCustomSource("p1", "https://boards.example.com/jobs", "Boards");
      calls.length = 0;
      const kv = createFakeKv(calls, { deleteThrows: true });
      const handler = createSourceRemoveHandler(store);

      await expect(
        handler(ctx({ profileId: "p1", sourceId: seeded.sourceId }, kv))
      ).rejects.toThrow(/kv unavailable/);
      expect(calls).toEqual([
        "store.listCustomSources",
        `kv.delete user ${FETCH_HOST_GRANTS_NAMESPACE} boards.example.com`
      ]);
    });
  });
});
