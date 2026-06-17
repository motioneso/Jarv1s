# OTNR Briefings 150 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining live OTNR #150 briefings findings: owner-scoped run lookup, remove dead route metadata guard, and make tool section extraction generic/object-guarded.

**Architecture:** Keep `DataContextDb` and metadata-only worker boundary invariants intact. Express `/run` ownership through `BriefingsRepository.getOwnedDefinitionById` under the actor-scoped DB context, then keep the worker-side metadata-only check as the real queue boundary. Replace compose's per-module output-array keys and shape callbacks with one generic "first array of object rows -> first meaningful string fields" extractor.

**Tech Stack:** TypeScript, Fastify route injection, Kysely/DataContextDb, Vitest integration tests, pg-boss.

---

## File Structure

- Modify: `packages/briefings/src/repository.ts`
  - Make `getOwnedDefinitionById` public so routes and worker generation share the same owner-scoped lookup.
- Modify: `packages/briefings/src/routes.ts`
  - Use `getOwnedDefinitionById` in `POST /api/briefings/definitions/:id/run`.
  - Remove the route-side `isBriefingRunPayloadMetadataOnly` import/check; leave worker check in `jobs.ts`.
- Modify: `packages/briefings/src/compose.ts`
  - Remove `arrayKey` and per-section `format` callbacks from `gatherToolSection`.
  - Add object guards plus generic first-array extraction and string-field line formatting.
- Modify: `tests/integration/briefings.test.ts`
  - Add a route-level regression test with an injected repository proving `/run` uses owner-scoped lookup instead of `getDefinitionById`.
- Modify: `tests/integration/briefings-synthesis.test.ts`
  - Add a generic extractor regression test using a custom tool returning a non-standard array key and non-object array members.

## Task 1: Route Owner-Scoped Run Lookup

**Files:**

- Modify: `packages/briefings/src/repository.ts`
- Modify: `packages/briefings/src/routes.ts`
- Test: `tests/integration/briefings.test.ts`

- [ ] **Step 1: Write failing route test**

Add `vi` import and a test near existing run-now tests:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
```

```ts
it("authorizes run-now through the owner-scoped repository lookup", async () => {
  const getDefinitionById = vi.spyOn(repository, "getDefinitionById");
  const getOwnedDefinitionById = vi.spyOn(repository, "getOwnedDefinitionById");
  const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createDefinition(scopedDb, {
      title: "Owner-scoped route briefing",
      selectedToolNames: ["tasks.list"]
    })
  );

  const response = await server.inject({
    method: "POST",
    url: `/api/briefings/definitions/${definition.id}/run`,
    headers: userAHeaders(),
    payload: { idempotencyKey: "owner-scoped-route-lookup" }
  });

  expect(response.statusCode).toBe(202);
  expect(getOwnedDefinitionById).toHaveBeenCalledWith(expect.anything(), definition.id);
  expect(getDefinitionById).not.toHaveBeenCalledWith(expect.anything(), definition.id);

  await handleNextBriefingJob(workerBoss);
  getDefinitionById.mockRestore();
  getOwnedDefinitionById.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export JARVIS_PGDATABASE=jarvis_build_briefings150
pnpm test:briefings -- --runInBand -t "authorizes run-now through the owner-scoped repository lookup"
```

Expected: FAIL because `getOwnedDefinitionById` is private or not called by the route.

- [ ] **Step 3: Make owner lookup public and route-owned**

Change `packages/briefings/src/repository.ts`:

```ts
  async getOwnedDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
```

Change `packages/briefings/src/routes.ts`:

```ts
const definition = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
  repository.getOwnedDefinitionById(scopedDb, request.params.id)
);

if (!definition) {
  return reply.code(404).send({ error: "Briefing definition not found" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same focused test. Expected: PASS.

## Task 2: Remove Route-Side Metadata Guard

**Files:**

- Modify: `packages/briefings/src/routes.ts`
- Test: existing `tests/integration/briefings.test.ts` metadata-only worker payload test

- [ ] **Step 1: Verify existing metadata payload test fails only if worker payload changes**

Run:

```bash
export JARVIS_PGDATABASE=jarvis_build_briefings150
pnpm test:briefings -- --runInBand -t "queues run-now jobs with metadata-only payloads"
```

Expected before code: PASS, proving behavior exists.

- [ ] **Step 2: Remove dead producer check**

Change import:

```ts
import { type BriefingRunPayload } from "./jobs.js";
```

Delete:

```ts
if (!isBriefingRunPayloadMetadataOnly(payload as unknown as Record<string, unknown>)) {
  throw new HttpError(500, "Briefing job payload contains non-metadata fields");
}
```

- [ ] **Step 3: Run metadata payload test**

Run same focused test. Expected: PASS; worker payload remains metadata-only and `jobs.ts` still checks the boundary.

## Task 3: Generic Compose Tool Extraction

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Test: `tests/integration/briefings-synthesis.test.ts`

- [ ] **Step 1: Write failing generic extractor test**

Add a test after the ToolContext test:

```ts
it("extracts tool section rows from the first object array without module-owned shape casts", async () => {
  const genericManifest: JarvisModuleManifest = {
    id: "generic-section",
    name: "GenericSection",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: "*" },
    assistantTools: [
      {
        name: "commitments.listVisible",
        description: "Returns a non-standard output key.",
        permissionId: "commitments.view",
        risk: "read" as const,
        execute: async () => ({
          data: {
            arbitraryRows: [
              "ignored primitive",
              { title: "Generic commitment", status: "blocked", ignoredEmpty: "   " },
              null
            ]
          }
        })
      }
    ]
  };

  const def = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createDefinition(scopedDb, {
      title: "Generic extractor check",
      selectedToolNames: ["commitments.listVisible"]
    })
  );

  const outcome = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.generateRun(scopedDb, def.id, {
      moduleManifests: [genericManifest],
      runKind: "manual",
      composeDeps: makeComposeDeps(undefined, [genericManifest])
    })
  );

  expect(outcome?.run.summary_text).toContain("COMMITMENTS: 1 item");
  expect(outcome?.run.summary_text).toContain("Generic commitment · blocked");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export JARVIS_PGDATABASE=jarvis_build_briefings150
pnpm test:briefings -- --runInBand -t "extracts tool section rows from the first object array"
```

Expected: FAIL because current compose looks only at `commitments` and casts array items.

- [ ] **Step 3: Add generic extractor helpers**

Replace `gatherToolSection` args with:

```ts
  args: {
    readonly key: string;
    readonly label: string;
    readonly toolName: string;
    readonly localDayField?: string;
  },
```

Add helpers:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstObjectArray(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    return value.filter(isRecord);
  }
  return [];
}

function formatGenericItem(item: Record<string, unknown>): string {
  return Object.entries(item)
    .filter(([key]) => !/(^id$|Id$|_id$|metadata|secret|credential|ciphertext)/i.test(key))
    .map(([, value]) => str(value))
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
}
```

Inside `gatherToolSection`, use:

```ts
const data = isRecord(result.data) ? result.data : {};
let items = firstObjectArray(data);
```

And:

```ts
const allLines = items.map(formatGenericItem).filter((line) => line.length > 0);
```

Remove `arrayKey` and `format` from every `gatherToolSection` call.

- [ ] **Step 4: Run generic extractor test**

Run same focused test. Expected: PASS.

## Task 4: Focused Verification, Commit, PR

**Files:**

- All modified paths above

- [ ] **Step 1: Run focused briefings tests**

```bash
export JARVIS_PGDATABASE=jarvis_build_briefings150
pnpm test:briefings
```

- [ ] **Step 2: Run maintainability checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check:file-size
```

- [ ] **Step 3: Stage only own files and commit**

```bash
git status --short
git add packages/briefings/src/repository.ts packages/briefings/src/routes.ts packages/briefings/src/compose.ts tests/integration/briefings.test.ts tests/integration/briefings-synthesis.test.ts docs/superpowers/plans/2026-06-17-otnr-briefings-150.md
git commit -m "fix(briefings): close remaining OTNR run guards" -m "Co-Authored-By: Claude Sonnet 4.6 <claude-sonnet-4.6@anthropic.com>"
```

- [ ] **Step 4: Pre-push and PR**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin overnight-batch-2026-06-16
git rebase origin/overnight-batch-2026-06-16
git push -u origin otnr-briefings-150
gh pr create --base overnight-batch-2026-06-16 --head otnr-briefings-150 --title "fix(briefings): close remaining OTNR #150 guards" --body "<filled with findings, tests, risk notes>"
```

## Self-Review

- Spec coverage: live route owner authorization, route metadata guard, and compose extraction findings all mapped to tasks.
- Placeholder scan: no `TBD`, no unspecified tests, no broad "handle edge cases" steps.
- Type consistency: `getOwnedDefinitionById` remains `BriefingDefinition | undefined`; compose helpers consume `Record<string, unknown>[]`; route keeps `BriefingRunPayload`.
