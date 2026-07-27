# Module content self-operation (issue #1265) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development, executed
> inline task-by-task by the same agent (this repo disables `executing-plans` /
> `subagent-driven-development` — see `coordinated-build` skill). Steps use checkbox syntax.

**Goal:** Close Spec 2's two remaining gaps — drop the unvalidated `guidance` free-text field from
`news.addTopic`'s assistant-tool schema, and give the `sports` module its first write tools
(`sports.followTeam` / `sports.unfollowTeam`) classified `granted_at_install` — so "follow the
Yankees" and "add a news topic" both run with zero confirmation cards.

**Architecture:** News's 5 write tools are already fully classified (landed in #1263/#1268,
verified current on this branch) — only the `guidance` schema fix remains there. Sports needs a
service-layer extraction (`routes.ts` calls `repository.create/remove` directly today, no
shared function) before assistant tools can reuse the same write path the REST routes use.
`SportsService` gains `followTeam`/`unfollowTeam` methods operating on an already actor-scoped
`DataContextDb` (mirroring the existing `getFollowedFactsForToday` briefing-tool pattern — no
`dataContext.withDataContext` needed on the tool-execute path). A new `packages/sports/src/chat-tools.ts`
holds the tool `execute`/`summarize` functions, composed at boot the same way
`briefing-tool.ts`/`configureSportsBriefingService` already is.

**Tech Stack:** TypeScript, Fastify, Kysely, vitest. No new dependencies, no new migration (the
`app.sports_follows` table + RLS already exist from `sql/0133_sports_follows.sql`).

## Global Constraints

- `selfOperationGrant` is exactly one of `"granted_at_install" | "confirm_always" | "user_promotable"`
  on every tool with `risk !== "read"` (CLAUDE.md hard invariant; enforced by
  `assertBuiltInSelfOperationManifests()`).
- A `granted_at_install` tool MUST also declare `executionPolicy: "auto"` and an `actionFamilyId`
  whose `assistantActionFamilies` entry lists `trusted_auto` in `allowedTiers` (Spec 2, "Decisions
  (locked)").
- One action family per module, not per tool (Spec 2) — sports gets exactly one family,
  `sports_follows`.
- Tools take a catalog key only, never a free-text team name (Spec 2) — reuse
  `catalogEntry()` from `packages/sports/src/source/catalog.ts`, the same validator
  `routes.ts:161` already uses.
- `tests/unit/self-operation-manifests.test.ts` asserts EXACT counts — update them to the new
  exact numbers, never a range (explicit handoff rule; this is a documented shared-surface
  collision with #1264 — call it out in the commit/PR body, don't silently fix).
- DataContextDb only for all repository/service I/O (CLAUDE.md hard invariant) — every new method
  signature below takes `DataContextDb`, never a root Kysely instance.
- `git add` only each task's own files per commit; `Co-Authored-By: Claude` trailer.

---

### Task 1: Drop `guidance` from `news.addTopic`'s assistant-tool input schema

**Files:**

- Modify: `packages/news/src/manifest.ts:335–356` (the `news.addTopic` tool declaration)
- Create: `tests/unit/news-manifest.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing new — this is a schema-only edit. `newsAddTopicExecute`
  (`packages/news/src/chat-tools.ts:243`) keeps reading `guidance` dynamically off the raw input
  object; it is unaffected because it never validated against the schema's declared properties.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/news-manifest.test.ts
import { describe, expect, it } from "vitest";

import { newsModuleManifest } from "../../packages/news/src/manifest.js";

describe("news manifest — addTopic guidance removal (#1265)", () => {
  it("does not accept a guidance field on the assistant-tool schema", () => {
    const tools = newsModuleManifest.assistantTools ?? [];
    const addTopic = tools.find((candidate) => candidate.name === "news.addTopic");
    expect(addTopic, "expected tool news.addTopic to exist").toBeDefined();
    const schema = addTopic?.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).not.toHaveProperty("guidance");
    expect(schema.properties).toHaveProperty("label");
  });

  it("keeps addTopic granted_at_install with only label required", () => {
    const tools = newsModuleManifest.assistantTools ?? [];
    const addTopic = tools.find((candidate) => candidate.name === "news.addTopic");
    const schema = addTopic?.inputSchema as { required: string[] };
    expect(schema.required).toEqual(["label"]);
    expect(addTopic?.selfOperationGrant).toBe("granted_at_install");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/news-manifest.test.ts`
Expected: FAIL on the first assertion — `schema.properties` currently has a `guidance` key.

- [ ] **Step 3: Write minimal implementation**

In `packages/news/src/manifest.ts`, replace the `news.addTopic` declaration's description and
`inputSchema` (keep every other field — `permissionId`, `actionFamilyId`, `risk`,
`executionPolicy`, `selfOperationGrant`, `summarize`, `execute` — unchanged):

```typescript
    {
      name: "news.addTopic",
      description:
        "Follow a custom news topic (e.g. 'local climate policy'). The topic is policy-checked before it is added.",
      permissionId: "news.prefs",
      actionFamilyId: "news_personalization",
      risk: "write",
      executionPolicy: "auto",
      selfOperationGrant: "granted_at_install",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short human-readable topic label" }
        },
        required: ["label"]
      },
      summarize: summarizeNewsAddTopic,
      execute: newsAddTopicExecute
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/news-manifest.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/news/src/manifest.ts tests/unit/news-manifest.test.ts
git commit -m "fix(news): drop unvalidated guidance field from addTopic tool schema (#1265)"
```

---

### Task 2: Widen `SportsService` with a shared `SportsFollowsWriter` + `followTeam`/`unfollowTeam`

**Files:**

- Modify: `packages/sports/src/sports-service.ts` (add `SportsFollowsWriter`, widen
  `SportsServiceDependencies.repository`, add two methods)
- Modify: `packages/sports/src/routes.ts` (import `SportsFollowsWriter` from `sports-service.js`
  instead of declaring its own copy)
- Modify: `tests/unit/sports-service.test.ts` (widen the shared `makeDeps()` fake repository)
- Create: `tests/unit/sports-service-follows.test.ts`

**Interfaces:**

- Consumes: `catalogEntry(competitionKey: string)` from `./source/catalog.js` (existing, returns
  `undefined` for an unknown key — same validator `routes.ts:161` uses today).
- Produces (for Task 3/4 to call):
  - `SportsFollowsWriter` — `{ list, create, remove }`, exported from `sports-service.js`.
  - `SportsService.followTeam(scopedDb: DataContextDb, input: { competitionKey: string; teamKey?: string | null }): Promise<{ ok: true; follow: SportsFollowDto } | { ok: false; error: string }>`
  - `SportsService.unfollowTeam(scopedDb: DataContextDb, input: { competitionKey: string; teamKey?: string | null }): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sports-service-follows.test.ts
import { describe, expect, it } from "vitest";

import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";
import type { DataContextDb } from "@jarv1s/db";

import {
  SportsService,
  type SportsFollowsWriter
} from "../../packages/sports/src/sports-service.js";

function makeFakeWriter(initial: SportsFollowDto[] = []): SportsFollowsWriter & {
  readonly rows: SportsFollowDto[];
} {
  const rows = [...initial];
  return {
    rows,
    async list() {
      return rows;
    },
    async create(_db: DataContextDb, input: CreateSportsFollowRequest) {
      const teamKey = input.teamKey ?? null;
      const existing = rows.find(
        (r) => r.competitionKey === input.competitionKey && r.teamKey === teamKey
      );
      if (existing) return existing;
      const created: SportsFollowDto = {
        id: `f-${rows.length + 1}`,
        competitionKey: input.competitionKey,
        teamKey,
        createdAt: "2026-07-27T00:00:00.000Z"
      };
      rows.push(created);
      return created;
    },
    async remove(_db: DataContextDb, id: string) {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }
  };
}

function makeService(writer: SportsFollowsWriter) {
  return new SportsService({
    datasetClient: {} as never,
    dataContext: {
      withDataContext() {
        throw new Error("not used by followTeam/unfollowTeam");
      }
    },
    repository: writer
  });
}

describe("SportsService.followTeam / unfollowTeam (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);
    const result = await service.followTeam({} as DataContextDb, {
      competitionKey: "not-a-league"
    });
    expect(result.ok).toBe(false);
    expect(writer.rows).toHaveLength(0);
  });

  it("follows a catalog team and unfollow fully restores state (idempotent)", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);

    const followed = await service.followTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(followed.ok).toBe(true);
    expect(writer.rows).toHaveLength(1);

    const unfollowed = await service.unfollowTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(unfollowed.ok).toBe(true);
    if (unfollowed.ok) expect(unfollowed.removed).toBe(true);
    expect(writer.rows).toHaveLength(0);

    const refollowed = await service.followTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(refollowed.ok).toBe(true);
    expect(writer.rows).toHaveLength(1);
  });

  it("unfollowing something never followed is a no-op, not an error", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);
    const result = await service.unfollowTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.removed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/sports-service-follows.test.ts`
Expected: FAIL to even compile/import — `followTeam`/`unfollowTeam`/`SportsFollowsWriter` don't
exist yet on `sports-service.ts`.

- [ ] **Step 3: Write minimal implementation**

In `packages/sports/src/sports-service.ts`, add the writer interface next to
`SportsFollowsReader` (around line 71) and widen the dependency type:

```typescript
/** The subset of `SportsFollowsRepository` the service needs to follow/unfollow (injectable for
 *  tests). The routes' CRUD handlers and the assistant tools share this same write surface. */
export interface SportsFollowsWriter extends SportsFollowsReader {
  create(scopedDb: DataContextDb, input: CreateSportsFollowRequest): Promise<SportsFollowDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
}
```

Change `SportsServiceDependencies.repository` (line 82) from `SportsFollowsReader` to
`SportsFollowsWriter`, and the private field (line 143) to match:

```typescript
  readonly repository: SportsFollowsWriter;
```

```typescript
  private readonly repository: SportsFollowsWriter;
```

Add the import for `CreateSportsFollowRequest` and `catalogEntry` at the top of the file if not
already imported (`catalogEntry` already is, per its use in `getFollowedFactsForToday`;
`CreateSportsFollowRequest` needs adding to the existing `@jarv1s/shared` import list).

Add the two methods near `getFollowedFactsForToday` (end of the class):

```typescript
  /** Follow a catalog team or whole competition. Catalog-key validated, same rule as
   *  `POST /api/sports/follows` (routes.ts) — the route and the assistant tool share this. */
  async followTeam(
    scopedDb: DataContextDb,
    input: { competitionKey: string; teamKey?: string | null }
  ): Promise<{ ok: true; follow: SportsFollowDto } | { ok: false; error: string }> {
    if (!catalogEntry(input.competitionKey)) {
      return { ok: false, error: `Unknown competition: ${input.competitionKey}` };
    }
    const follow = await this.repository.create(scopedDb, {
      competitionKey: input.competitionKey,
      teamKey: input.teamKey ?? null
    });
    return { ok: true, follow };
  }

  /** Unfollow by catalog key, not by opaque follow id — the assistant never sees row ids. Removing
   *  something never followed is a no-op (`removed: false`), not an error: follow -> unfollow ->
   *  follow must be idempotent (Spec 2). */
  async unfollowTeam(
    scopedDb: DataContextDb,
    input: { competitionKey: string; teamKey?: string | null }
  ): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
    if (!catalogEntry(input.competitionKey)) {
      return { ok: false, error: `Unknown competition: ${input.competitionKey}` };
    }
    const teamKey = input.teamKey ?? null;
    const existing = await this.repository.list(scopedDb);
    const match = existing.find(
      (f) => f.competitionKey === input.competitionKey && f.teamKey === teamKey
    );
    if (!match) return { ok: true, removed: false };
    const removed = await this.repository.remove(scopedDb, match.id);
    return { ok: true, removed };
  }
```

In `packages/sports/src/routes.ts`, delete the locally-declared `SportsFollowsWriter` interface
(lines 24–31) and import it from `sports-service.js` instead:

```typescript
import {
  SportsService,
  type SportsFollowsReader,
  type SportsFollowsWriter
} from "./sports-service.js";
```

(the module already imports `SportsService, type SportsFollowsReader` from that path — just add
`SportsFollowsWriter` to the same import).

In `tests/unit/sports-service.test.ts`, widen the shared fake repository inside `makeDeps()`
(around line 261) so the file still typechecks against `SportsFollowsWriter`:

```typescript
    repository: {
      list: async () => follows,
      async create() {
        throw new Error("not exercised by this test file — see sports-service-follows.test.ts");
      },
      async remove() {
        throw new Error("not exercised by this test file — see sports-service-follows.test.ts");
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/sports-service-follows.test.ts tests/unit/sports-service.test.ts tests/unit/sports-service-dedupe.test.ts tests/unit/sports-service-story-identity.test.ts tests/unit/sports-routes.test.ts`
Expected: PASS across all five files (the last four are the existing suites this widening touches
or that share `makeDeps`).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts packages/sports/src/routes.ts tests/unit/sports-service.test.ts tests/unit/sports-service-follows.test.ts
git commit -m "feat(sports): add SportsService.followTeam/unfollowTeam (#1265)"
```

---

### Task 3: Route the REST follow/unfollow endpoints through the service

**Files:**

- Modify: `packages/sports/src/routes.ts:153–188` (`POST /api/sports/follows`,
  `DELETE /api/sports/follows/:id`)

**Interfaces:**

- Consumes: `SportsService.followTeam`/`SportsService.unfollowTeam` from Task 2.
- Produces: no interface change — response shapes (`{ follow }`, `{ ok }`) are unchanged, so
  `tests/unit/sports-routes.test.ts` (already exists, already injects a full fake `repository`)
  should pass unmodified. `DELETE` semantics change subtly: it now resolves by catalog key via the
  service's `unfollowTeam`, not by opaque row id — **this route already only ever receives its own
  `id` param, not a catalog key, so this task keeps the route on `repository.remove(db, id)`
  directly and does NOT switch it to `unfollowTeam`.** Only `POST /api/sports/follows` (which
  already takes `competitionKey`/`teamKey`, a catalog-keyed body) switches to `service.followTeam`.
  `unfollowTeam` is consumed by the new assistant tool in Task 4, not by this REST route — the
  route's `DELETE /:id` and the tool's catalog-keyed unfollow are two different resolution paths
  by design (spec: REST clients already know the row id from `GET /api/sports/follows`; the
  assistant doesn't).

- [ ] **Step 1: Write the failing test**

Add one case to `tests/unit/sports-routes.test.ts` (a repo-injected assertion, appended near the
existing `"POST /api/sports/follows persists via the repository"` test at line 335):

```typescript
it("POST /api/sports/follows still rejects an unknown competitionKey with 400", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/sports/follows",
    payload: { competitionKey: "not-a-league" }
  });
  expect(response.statusCode).toBe(400);
});
```

(Match the existing file's `buildApp()`/injection helper name exactly — read the file's top-of-file
setup before inserting; if the helper is named differently, use that name instead of `buildApp()`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/sports-routes.test.ts`
Expected: this specific case should already PASS even before the change (the route already
catalog-checks before calling the repository) — this step confirms no regression, not a new
failure. Proceed to Step 3 regardless; the real regression check is Step 4 re-running the full
file after the refactor.

- [ ] **Step 3: Write minimal implementation**

In `packages/sports/src/routes.ts`, replace the `POST /api/sports/follows` handler body:

```typescript
server.post(
  "/api/sports/follows",
  { schema: createSportsFollowResponseSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = request.body as CreateSportsFollowRequest;
      const result = await dependencies.dataContext.withDataContext(accessContext, (db) =>
        service.followTeam(db, input)
      );
      if (!result.ok) throw new HttpError(400, result.error);
      return { follow: result.follow };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Leave `DELETE /api/sports/follows/:id` exactly as-is (still calls `repository.remove(db, id)`
directly — see Interfaces note above for why).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/sports-routes.test.ts`
Expected: PASS, including the pre-existing `"POST /api/sports/follows persists via the repository"`
test and the new 400 case.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/routes.ts tests/unit/sports-routes.test.ts
git commit -m "refactor(sports): route POST /follows through SportsService.followTeam (#1265)"
```

---

### Task 4: Add `sports.followTeam` / `sports.unfollowTeam` assistant tools + action family

**Files:**

- Create: `packages/sports/src/chat-tools.ts`
- Modify: `packages/sports/src/manifest.ts` (add `assistantActionFamilies`, two new
  `assistantTools` entries)
- Modify: `packages/module-registry/src/index.ts` (call `configureSportsChatTools` alongside the
  existing `configureSportsBriefingService` call, around line 1515)
- Create: `tests/unit/sports-chat-tools.test.ts`
- Modify: `tests/unit/sports-manifest.test.ts` (update the tool-count assertion, add family/tool
  assertions)

**Interfaces:**

- Consumes: `SportsService`, `SportsFollowsRepository` (Task 2/existing), `catalogEntry` (existing).
- Produces: `sportsFollowTeamExecute`, `sportsUnfollowTeamExecute`, `summarizeSportsFollowTeam`,
  `summarizeSportsUnfollowTeam`, `configureSportsChatTools(datasetClient)` — all exported from
  `packages/sports/src/chat-tools.ts`, consumed by `manifest.ts` and `module-registry`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sports-chat-tools.test.ts
import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";
import type { ToolExecute } from "@jarv1s/module-sdk";

import {
  configureSportsChatTools,
  sportsFollowTeamExecute,
  sportsUnfollowTeamExecute
} from "../../packages/sports/src/chat-tools.js";

const FAKE_DB = { db: {} } as unknown as DataContextDb;

async function callTool(execute: ToolExecute, input: Record<string, unknown>) {
  return execute(FAKE_DB, input, { actorUserId: "user-a", requestId: "req-1" });
}

describe("sports chat tools (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    configureSportsChatTools({} as never);
    const result = await callTool(sportsFollowTeamExecute, { competitionKey: "not-a-league" });
    expect((result.data as { error?: string }).error).toMatch(/unknown competition/i);
  });

  it("follow then unfollow via the tools is idempotent", async () => {
    const rows: SportsFollowDto[] = [];
    let idCounter = 0;
    configureSportsChatTools({} as never);
    // Re-point the module's repository at an in-memory fake by re-running configure is not
    // possible without a seam, so this test exercises the catalog-rejection path only; full
    // follow/unfollow round-trip coverage lives in sports-service-follows.test.ts (Task 2) against
    // the real SportsService, and cross-actor RLS isolation is covered at the repository/RLS layer
    // in tests/integration/sports-follows-repository.test.ts. This placeholder assertion keeps the
    // suite honest about what it covers instead of silently asserting nothing.
    void rows;
    void idCounter;
    expect(true).toBe(true);
  });
});
```

Actually — a placeholder test with `expect(true).toBe(true)` violates the "No Placeholders" rule.
Replace the whole file with this instead, which gives `configureSportsChatTools` a real seam by
constructing its own service via dependency injection rather than trying to reach into the
module's private singleton:

```typescript
// tests/unit/sports-chat-tools.test.ts
import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";
import type { ToolExecute } from "@jarv1s/module-sdk";

import {
  configureSportsChatTools,
  sportsFollowTeamExecute,
  sportsUnfollowTeamExecute
} from "../../packages/sports/src/chat-tools.js";
import type { SportsFollowsWriter } from "../../packages/sports/src/sports-service.js";

const FAKE_DB = { db: {} } as unknown as DataContextDb;
const CTX = { actorUserId: "user-a", requestId: "req-1" };

function makeFakeWriter(): SportsFollowsWriter {
  const rows: SportsFollowDto[] = [];
  return {
    async list() {
      return rows;
    },
    async create(_db: DataContextDb, input: CreateSportsFollowRequest) {
      const teamKey = input.teamKey ?? null;
      const existing = rows.find(
        (r) => r.competitionKey === input.competitionKey && r.teamKey === teamKey
      );
      if (existing) return existing;
      const created: SportsFollowDto = {
        id: `f-${rows.length + 1}`,
        competitionKey: input.competitionKey,
        teamKey,
        createdAt: "2026-07-27T00:00:00.000Z"
      };
      rows.push(created);
      return created;
    },
    async remove(_db: DataContextDb, id: string) {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }
  };
}

async function callTool(execute: ToolExecute, input: Record<string, unknown>) {
  return execute(FAKE_DB, input, CTX);
}

describe("sports chat tools (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    configureSportsChatTools({} as never, makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, { competitionKey: "not-a-league" });
    expect((result.data as { error?: string }).error).toMatch(/unknown competition/i);
  });

  it("follow then unfollow via the tools is idempotent", async () => {
    const writer = makeFakeWriter();
    configureSportsChatTools({} as never, writer);

    const followed = await callTool(sportsFollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((followed.data as { follow?: SportsFollowDto }).follow?.teamKey).toBe("dal");

    const unfollowed = await callTool(sportsUnfollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((unfollowed.data as { removed?: boolean }).removed).toBe(true);

    const reunfollowed = await callTool(sportsUnfollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((reunfollowed.data as { removed?: boolean }).removed).toBe(false);
  });

  it("rejects a missing competitionKey before any write", async () => {
    configureSportsChatTools({} as never, makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, {});
    expect((result.data as { error?: string }).error).toMatch(/provide a competitionkey/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/sports-chat-tools.test.ts`
Expected: FAIL to compile/import — `chat-tools.ts` doesn't exist yet, and
`configureSportsChatTools` doesn't accept a second `writer` argument.

- [ ] **Step 3: Write minimal implementation**

Create `packages/sports/src/chat-tools.ts`:

```typescript
import type { DatasetClient } from "@jarv1s/datasets";
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult, ToolSummarize } from "@jarv1s/module-sdk";

import { SportsFollowsRepository } from "./repository.js";
import { SportsService, type SportsFollowsWriter } from "./sports-service.js";

/**
 * Content-write counterpart to `briefing-tool.ts`'s read-only singleton — same composition-root
 * timing constraint (constructed once at boot, before any request reaches `execute`), kept in its
 * own file because these are write tools with their own action family (Spec 2), not the briefing
 * read path. `writer` is injectable so tests don't need a real Postgres-backed repository.
 */
let service: SportsService | undefined;

export function configureSportsChatTools(
  datasetClient: DatasetClient,
  writer: SportsFollowsWriter = new SportsFollowsRepository()
): void {
  service = new SportsService({
    datasetClient,
    dataContext: {
      withDataContext() {
        throw new Error("sports chat tools read/write the gateway-scoped db directly");
      }
    },
    repository: writer
  });
}

function stringField(input: unknown, key: string): string | undefined {
  const value = (input as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireService(): SportsService {
  if (!service) {
    throw new Error(
      "sports chat tools used before configureSportsChatTools ran (composition-root bug)"
    );
  }
  return service;
}

export const sportsFollowTeamExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const competitionKey = stringField(input, "competitionKey");
  if (!competitionKey) return { data: { error: "Provide a competitionKey to follow." } };
  const teamKey = stringField(input, "teamKey") ?? null;
  const result = await requireService().followTeam(scopedDb, { competitionKey, teamKey });
  if (!result.ok) return { data: { error: result.error } };
  return { data: { follow: result.follow } };
};

export const summarizeSportsFollowTeam: ToolSummarize = (input) => {
  const competitionKey = stringField(input, "competitionKey") ?? "unknown competition";
  const teamKey = stringField(input, "teamKey");
  return teamKey ? `Follow ${teamKey} (${competitionKey})` : `Follow all of ${competitionKey}`;
};

export const sportsUnfollowTeamExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const competitionKey = stringField(input, "competitionKey");
  if (!competitionKey) return { data: { error: "Provide a competitionKey to unfollow." } };
  const teamKey = stringField(input, "teamKey") ?? null;
  const result = await requireService().unfollowTeam(scopedDb, { competitionKey, teamKey });
  if (!result.ok) return { data: { error: result.error } };
  return { data: { removed: result.removed } };
};

export const summarizeSportsUnfollowTeam: ToolSummarize = (input) => {
  const competitionKey = stringField(input, "competitionKey") ?? "unknown competition";
  const teamKey = stringField(input, "teamKey");
  return teamKey ? `Unfollow ${teamKey} (${competitionKey})` : `Unfollow all of ${competitionKey}`;
};
```

In `packages/sports/src/manifest.ts`, add the import (alongside the existing
`sportsFollowedFactsTodayExecute` import):

```typescript
import {
  sportsFollowTeamExecute,
  sportsUnfollowTeamExecute,
  summarizeSportsFollowTeam,
  summarizeSportsUnfollowTeam
} from "./chat-tools.js";
```

Add `assistantActionFamilies` right before `assistantTools` (after `routes: [...]`, matching
News's placement):

```typescript
  assistantActionFamilies: [
    {
      id: "sports_follows",
      label: "Sports follows",
      description: "Follow and unfollow the active actor's own teams and competitions.",
      defaultTier: "ask_each_time",
      allowedTiers: ["ask_each_time", "trusted_auto", "always_confirm"]
    }
  ],
```

Append the two tools inside the existing `assistantTools` array, after
`sports.followedFactsToday`:

```typescript
    {
      name: "sports.followTeam",
      description:
        "Follow a team or an entire competition/league (e.g. 'the Yankees' or 'the Premier League'). Resolve the name to a catalog competitionKey (and teamKey for a specific team) via the sports catalog/search first, then call this with the exact keys.",
      permissionId: "sports.follow",
      actionFamilyId: "sports_follows",
      risk: "write",
      executionPolicy: "auto",
      selfOperationGrant: "granted_at_install",
      inputSchema: {
        type: "object",
        properties: {
          competitionKey: {
            type: "string",
            description: "Catalog competition key, e.g. \"nfl\" or \"eng.1\""
          },
          teamKey: {
            type: "string",
            description: "Catalog team key within the competition; omit to follow the whole competition"
          }
        },
        required: ["competitionKey"]
      },
      summarize: summarizeSportsFollowTeam,
      execute: sportsFollowTeamExecute
    },
    {
      name: "sports.unfollowTeam",
      description:
        "Stop following a team or competition previously followed. Requires the same competitionKey (and teamKey if a specific team) used to follow it.",
      permissionId: "sports.follow",
      actionFamilyId: "sports_follows",
      risk: "write",
      executionPolicy: "auto",
      selfOperationGrant: "granted_at_install",
      inputSchema: {
        type: "object",
        properties: {
          competitionKey: {
            type: "string",
            description: "Catalog competition key, e.g. \"nfl\" or \"eng.1\""
          },
          teamKey: {
            type: "string",
            description: "Catalog team key within the competition; omit to unfollow the whole competition"
          }
        },
        required: ["competitionKey"]
      },
      summarize: summarizeSportsUnfollowTeam,
      execute: sportsUnfollowTeamExecute
    }
```

In `packages/module-registry/src/index.ts`, add the import next to `configureSportsBriefingService`
(line ~241):

```typescript
  configureSportsBriefingService,
  configureSportsChatTools,
```

and call it right after the existing `configureSportsBriefingService(datasetClient);` (line ~1515):

```typescript
configureSportsBriefingService(datasetClient);
configureSportsChatTools(datasetClient);
```

Update `tests/unit/sports-manifest.test.ts`'s tool-count test and add new assertions:

```typescript
it("exposes one read-risk briefing tool and two write-risk follow tools", () => {
  expect(sportsModuleManifest.assistantTools).toHaveLength(3);
  const byName = Object.fromEntries(
    sportsModuleManifest.assistantTools.map((tool) => [tool.name, tool])
  );
  expect(byName["sports.followedFactsToday"]?.risk).toBe("read");
  for (const name of ["sports.followTeam", "sports.unfollowTeam"]) {
    expect(byName[name]?.risk).toBe("write");
    expect(byName[name]?.actionFamilyId).toBe("sports_follows");
    expect(byName[name]?.executionPolicy).toBe("auto");
    expect(byName[name]?.selfOperationGrant).toBe("granted_at_install");
  }
});

it("declares exactly one action family, sports_follows, with trusted_auto allowed", () => {
  expect(sportsModuleManifest.assistantActionFamilies).toHaveLength(1);
  const family = sportsModuleManifest.assistantActionFamilies?.[0];
  expect(family?.id).toBe("sports_follows");
  expect(family?.allowedTiers).toContain("trusted_auto");
});
```

(Replace the existing `it("exposes exactly one read-risk briefing tool", ...)` test with the first
block above — same file, same `describe`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/sports-chat-tools.test.ts tests/unit/sports-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/chat-tools.ts packages/sports/src/manifest.ts packages/module-registry/src/index.ts tests/unit/sports-chat-tools.test.ts tests/unit/sports-manifest.test.ts
git commit -m "feat(sports): add sports.followTeam/unfollowTeam assistant tools, granted at install (#1265)"
```

---

### Task 5: Update the complete built-in self-operation inventory + add a Sports classification block

**Files:**

- Modify: `tests/unit/self-operation-manifests.test.ts`

**Interfaces:**

- Consumes: `sportsModuleManifest` (needs adding to the file's manifest import list),
  `getBuiltInModuleManifests()` (existing).
- Produces: nothing further downstream — this is the terminal inventory check.

- [ ] **Step 1: Write the failing test**

Add the import (alongside the other manifest imports, e.g. after `webModuleManifest`):

```typescript
import { sportsModuleManifest } from "../../packages/sports/src/manifest.js";
```

Add a constant near the other `GRANTED_AT_INSTALL_*` constants:

```typescript
const GRANTED_AT_INSTALL_SPORTS_TOOLS = ["sports.followTeam", "sports.unfollowTeam"];
```

Add a new describe block, modeled exactly on the existing News one (insert after the News block,
before the Email block):

```typescript
describe("Sports self-operation manifest classification", () => {
  it("classifies both follow tools as granted_at_install", () => {
    const tools = sportsModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_SPORTS_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.risk).toBe("write");
      expect(tool?.actionFamilyId).toBe("sports_follows");
      expect(tool?.executionPolicy).toBe("auto");
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });
});
```

Update the exact counts in the `"Complete built-in self-operation inventory (#1263)"` describe
block (lines ~340–353): change `expect(grantedAtInstall.length).toBe(29)` to
`expect(grantedAtInstall.length).toBe(31)`, and
`expect(grantedAtInstall.length + confirmAlways.length + userPromotable.length).toBe(38)` to
`.toBe(40)`. Update the test's own description string and the prose comment above it to say "31"
and "40" instead of "29"/"38", and add a one-line comment noting the 2-tool addition:

```typescript
// #1265: +2 (sports.followTeam, sports.unfollowTeam), both granted_at_install — the sports
// module's first write tools. Collides with #1264's own count bump on this same shared test;
// whichever PR lands second must re-add the other's delta, not silently overwrite it.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/self-operation-manifests.test.ts`
Expected: FAIL — the new Sports describe block passes (tools now exist from Task 4), but the
inventory counts are still asserting the pre-edit exact numbers (29/38) against a now-31/40 count,
until Step 3's edit lands. If run strictly after Task 4 is already committed, write the count
assertions first at their OLD values to see the intended fail, then apply Step 3.

- [ ] **Step 3: Write minimal implementation**

Apply the count edits described in Step 1 above (`29` → `31`, `38` → `40`, description string and
comment updated to match).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/self-operation-manifests.test.ts`
Expected: PASS, all describe blocks including the new Sports one and the updated inventory counts.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/self-operation-manifests.test.ts
git commit -m "test(self-operation): classify sports.followTeam/unfollowTeam, bump inventory 29->31 (#1265)"
```

---

### Task 6: Cross-actor RLS isolation test for sports follows via the tool path

**Files:**

- Create: `tests/integration/sports-follows-tool-rls.test.ts`

**Interfaces:**

- Consumes: real `DataContextRunner`/`withDataContext` test harness already used by
  `tests/integration/sports-follows-repository.test.ts` (mirror its setup — read that file's
  top-of-file imports/helpers before writing this one, since the exact harness helper names live
  there and must match, not be guessed).
- Produces: nothing further downstream.

- [ ] **Step 1: Write the failing test**

First read `tests/integration/sports-follows-repository.test.ts` in full to copy its exact
DB-harness setup (test DB connection helper, `AccessContext` construction, cleanup). Then write:

```typescript
// tests/integration/sports-follows-tool-rls.test.ts
import { describe, expect, it } from "vitest";

import { SportsFollowsRepository } from "../../packages/sports/src/repository.js";
import { SportsService } from "../../packages/sports/src/sports-service.js";
// Import the same test DB/data-context helpers sports-follows-repository.test.ts uses —
// match its exact imports (e.g. withTestDataContext / makeAccessContext), do not invent new ones.

describe("sports follow tools — cross-actor RLS isolation (#1265)", () => {
  it("a follow created by user A is invisible and unremovable from user B's tool call", async () => {
    const repository = new SportsFollowsRepository();
    const service = new SportsService({
      datasetClient: {} as never,
      dataContext: {
        withDataContext() {
          throw new Error(
            "not used — this test calls followTeam/unfollowTeam with a scoped db directly"
          );
        }
      },
      repository
    });

    // Use the shared harness to open a scoped db for user A, follow the Cowboys, then open a
    // separately scoped db for user B and assert unfollowTeam for the same key is a no-op
    // (removed: false) and list() from user B's scope never includes user A's follow. Fill in the
    // exact harness calls from sports-follows-repository.test.ts's own setup here.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/sports-follows-tool-rls.test.ts`
Expected: FAIL — the test body above is intentionally incomplete pending the harness read; this
step is a placeholder marker for the implementer to replace with a real assertion body using the
exact harness from the sibling repository test file, then re-run until it fails for the _right_
reason (missing implementation, not a typo) before Step 3.

- [ ] **Step 3: Write minimal implementation**

No production code change expected — RLS isolation already exists at the table/migration level
(`sql/0133_sports_follows.sql`, `owner_user_id` + `app.current_actor_user_id()`, same mechanism
every other owner-only table uses). This task only needs the test body completed using the sibling
file's real harness calls (scoped-db-per-actor, `service.followTeam(dbA, {...})`, then
`service.unfollowTeam(dbB, {...})` asserting `removed: false`, and `repository.list(dbB)` asserting
it does not contain user A's follow).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/sports-follows-tool-rls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/sports-follows-tool-rls.test.ts
git commit -m "test(sports): cross-actor RLS isolation for followTeam/unfollowTeam (#1265)"
```

---

### Task 7: News preview/confirm regression check + denylist check

**Files:**

- Read (verify only, no edit expected): `tests/integration/news-revalidation.test.ts` or
  `tests/unit/news-settings-pane.test.tsx` — grep for an existing test asserting `confirmSource`
  rejects a label/domain mismatch against the cached preview.
- Create (only if no such test exists after the grep above):
  `tests/unit/news-confirm-source-mismatch.test.ts`
- Modify: `tests/unit/self-operation-manifests.test.ts` (one additional denylist assertion)

**Interfaces:**

- Consumes: `isSelfOperationExcluded` (existing, already imported in the test file).

- [ ] **Step 1: Write the failing test**

Run `grep -rn "domain do not match\|mismatch" tests/integration/news-revalidation.test.ts
tests/unit/news-settings-pane.test.tsx` first. If a matching test already exists, this task is
verify-only — skip to Step 5 with a comment-only commit is NOT allowed by "no placeholders", so
instead: if found, note the exact file/line in the plan's completion and move to Task 8 without a
commit for this task. If NOT found, add to `tests/unit/self-operation-manifests.test.ts`:

```typescript
describe("Sports/News denylist check (#1265)", () => {
  it("neither news nor sports write tools intersect the Spec 1 excluded set", () => {
    const modules = [newsModuleManifest, sportsModuleManifest];
    for (const manifest of modules) {
      for (const tool of manifest.assistantTools ?? []) {
        if (tool.risk === "read") continue;
        expect(
          isSelfOperationExcluded(manifest.id, tool),
          `expected ${manifest.id}.${tool.name} not to be self-operation-excluded`
        ).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/self-operation-manifests.test.ts`
Expected: PASS immediately (this is a positive-confirmation test, not a red/green TDD case — the
exclusion table is already hardcoded to `moduleId: "settings"|"ai"` only, verified in this
session's investigation). Record that it passed on first run — this is expected, not a plan
defect.

- [ ] **Step 3: Write minimal implementation**

None needed — Step 2 already passes.

- [ ] **Step 4: Run test to verify it passes**

Already confirmed in Step 2.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/self-operation-manifests.test.ts
git commit -m "test(self-operation): assert news/sports write tools never hit the exclusion denylist (#1265)"
```

---

## Self-review notes (spec coverage check)

- Spec "Tests" bullet 1 (no confirmation card on any news/sports write tool) — covered by Task 5's
  `granted_at_install` + `executionPolicy: "auto"` assertions on all 7 tools (5 news + 2 sports);
  the gateway's policy resolution (`policy.ts:47-49`, out of scope to re-verify here — already
  covered by Spec 1's own build assertion) is what turns that combination into "no card," not this
  plan's tests directly, so the manifest-level assertions are the correct boundary for this plan.
- Spec "Tests" bullet 2 (missing `executionPolicy: "auto"` fails the build) — already covered by
  `assertBuiltInSelfOperationManifests()`, pre-existing, not part of this plan's new work; no task
  needed.
- Spec "Tests" bullets 3–4 (catalog rejection, unfollow idempotency) — Task 2 + Task 4.
- Spec "Tests" bullet 5 (cross-actor RLS) — Task 6.
- Spec "Tests" bullet 6 (denylist) — Task 7.
- Spec "Tests" bullet 7 (news preview/confirm regression) — Task 7 (verify-existing-or-add).
- Spec "Files" list — every listed file is touched by Task 1, 2, 3, or 4 except
  `packages/sports/src/service.ts`, which the handoff already confirmed should NOT be created
  (extend the existing `sports-service.ts` instead) — noted explicitly in this plan's Architecture
  section and in Task 2.
- Exit criterion (UAT Playwright run) is NOT a task in this plan — it is the
  `coordinated-wrap-up` gate, run against a real dev instance after all 7 tasks land and
  `pnpm verify:foundation` is green.
