# Commitment Extraction Build — Relay 2 Handoff

**Date:** 2026-06-28  
**Branch:** `rfa-537-commitment-extraction`  
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-537-commitment-extraction`  
**Spec:** `docs/superpowers/specs/2026-06-26-commitment-extraction.md`  
**Plan:** `docs/superpowers/plans/2026-06-27-commitment-extraction.md`  
**Coordinator label:** `Coordinator`  
**Risk tier:** `security` (FORCE RLS, cross-model QA + Ben merge sign-off required)

---

## Completed Tasks (Tasks 1–8, 10 commits)

| Commit     | Task                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `95b0c4bb` | module-sdk: CommitmentExtractionProvider, CommitmentResolutionVerifier, CommitmentTextBoundary, ExtractedCommitmentCandidate interfaces |
| `5075e1ae` | Task 1+2+3: pg-boss ALLOWED_PAYLOAD_KEYS + SQL migration 0125 + foundation scaffold + module-registry registration                      |
| `429e3097` | Task 4 partial: types.ts, CommitmentsRepository skeleton, vitest alias                                                                  |
| `369e1fdb` | Task 4 complete: assertDataContextDb fix, CommitmentsRepository export, 4 Kysely table types in @jarv1s/db, tsconfig paths              |
| `b12bc2ca` | Task 5: passesPrefilter + buildCandidateSignature                                                                                       |
| `f3d33c1a` | Task 6: extractCommitmentsFromText (prefilter → AI → JSON parse → fails-safe)                                                           |
| `1e9009f3` | Task 7: CommitmentExtractionJobPayload + enqueueCommitmentExtraction + registerCommitmentExtractionWorker                               |
| `4f720dd8` | Task 8: 7 REST routes (candidates CRUD + extract + state)                                                                               |

---

## Remaining Tasks (9–13)

### Task 9: 5 assistant tools (`packages/commitments/src/tools.ts`)

Test first: `tests/unit/commitment-tools-shape.test.ts`

```typescript
// tests/unit/commitment-tools-shape.test.ts
import { describe, it, expect } from "vitest";
import {
  commitmentListExecute,
  commitmentGetExecute,
  commitmentAcceptExecute,
  commitmentRejectExecute,
  commitmentSnoozeExecute
} from "@jarv1s/commitments/tools";

describe("commitment tools", () => {
  it("exports all 5 execute functions", () => {
    expect(typeof commitmentListExecute).toBe("function");
    expect(typeof commitmentGetExecute).toBe("function");
    expect(typeof commitmentAcceptExecute).toBe("function");
    expect(typeof commitmentRejectExecute).toBe("function");
    expect(typeof commitmentSnoozeExecute).toBe("function");
  });
});
```

Add subpath export to package.json, vitest alias, tsconfig path (see pattern below).

```typescript
// packages/commitments/src/tools.ts
import type { ToolExecute, ToolResult, renderToolResult } from "@jarv1s/module-sdk";
import { CommitmentsRepository } from "./repository.js";

const repo = new CommitmentsRepository();

export const commitmentListExecute: ToolExecute = async (scopedDb, input, ctx) => {
  const candidates = await repo.listCandidates(scopedDb, ctx.actorUserId, "pending_review");
  const items = candidates.map((c) => ({
    id: c.id,
    kind: c.kind,
    title: c.title,
    dueLocalDate: c.dueLocalDate,
    counterpartyLabel: c.counterpartyLabel,
    confidence: c.confidence,
    sourceCount: c.sourceCount,
    lastSeenAt: c.lastSeenAt.toISOString()
  }));
  return renderToolResult({ type: "json", data: items });
};

export const commitmentGetExecute: ToolExecute = async (scopedDb, input, ctx) => {
  const { candidateId } = input as { candidateId: string };
  const candidate = await repo.getCandidate(scopedDb, ctx.actorUserId, candidateId);
  if (!candidate) return renderToolResult({ type: "error", message: "Commitment not found" });
  const evidence = await repo.getEvidenceForCandidate(scopedDb, candidateId);
  return renderToolResult({
    type: "json",
    data: {
      ...candidate,
      resolutionRef: undefined,
      hasResolutionRef: candidate.resolutionRef !== null,
      evidence
    }
  });
};

export const commitmentAcceptExecute: ToolExecute = async (scopedDb, input, ctx) => {
  const { candidateId } = input as { candidateId: string };
  const candidate = await repo.updateStatus(scopedDb, ctx.actorUserId, candidateId, "accepted");
  return renderToolResult({ type: "json", data: { id: candidate.id, status: candidate.status } });
};

export const commitmentRejectExecute: ToolExecute = async (scopedDb, input, ctx) => {
  const { candidateId } = input as { candidateId: string };
  const candidate = await repo.updateStatus(scopedDb, ctx.actorUserId, candidateId, "rejected");
  return renderToolResult({ type: "json", data: { id: candidate.id, status: candidate.status } });
};

export const commitmentSnoozeExecute: ToolExecute = async (scopedDb, input, ctx) => {
  const { candidateId, snoozedUntil } = input as { candidateId: string; snoozedUntil: string };
  const candidate = await repo.updateStatus(
    scopedDb,
    ctx.actorUserId,
    candidateId,
    "snoozed",
    new Date(snoozedUntil)
  );
  return renderToolResult({
    type: "json",
    data: {
      id: candidate.id,
      status: candidate.status,
      snoozedUntil: candidate.snoozedUntil?.toISOString()
    }
  });
};
```

**Check `renderToolResult` export** in `@jarv1s/module-sdk/src/index.ts` — it's already there at the bottom of the file. Also check `ToolExecute`, `ToolContext` types; the import may need adjustment.

**Commit:** `feat(commitments): Task 9 — 5 assistant tools (list, get, accept, reject, snooze)`

---

### Task 10: Update manifest + wire module-registry

The `manifest.ts` skeleton already exists at `packages/commitments/src/manifest.ts`. It needs to be UPDATED (not created) to include the 5 tools + register routes and workers closures in module-registry.

**Step 1: Read `packages/commitments/src/manifest.ts` first** — it was created in Task 3 as a minimal scaffold. It already has `commitmentsModuleManifest` and `commitmentsModuleSqlMigrationDirectory`. You need to expand `assistantTools` from `[]` to the full 5-tool list, and add `assistantActionFamilies`.

**Step 2: Read `packages/module-registry/src/index.ts`** — the commitments module is already registered in `BUILT_IN_MODULES` (added in Task 3) but with empty `registerRoutes` and `registerWorkers`. Update those closures.

The module-registry entry should look like:

```typescript
{
  manifest: commitmentsModuleManifest,
  sqlMigrationDirectories: [commitmentsModuleSqlMigrationDirectory],
  queueDefinitions: [{ name: COMMITMENT_EXTRACTION_QUEUE, options: {} }],
  registerRoutes: (server, deps) =>
    registerCommitmentsRoutes(server, {
      resolveAccessContext: deps.resolveAccessContext,
      dataContext: deps.dataContext,
      boss: deps.boss
    }),
  registerWorkers: (boss, deps) =>
    registerCommitmentExtractionWorker(boss, deps.dataContext, {
      aiRepository: new AiRepository(),
      cipher: createAiSecretCipher(),
      repository: new CommitmentsRepository(),
      providers: [] // wired in Task 11
    })
}
```

Import from `@jarv1s/commitments` for the exports. Add any missing imports to `module-registry/src/index.ts`.

Also add `"test:commitments"` to root `package.json` scripts:

```json
"test:commitments": "JARVIS_PGDATABASE=jarvis_build_537 vitest run tests/integration/commitments.test.ts"
```

**Commit:** `feat(commitments): Task 10 — full manifest with tools + module-registry wiring`

---

### Task 11: Source provider stubs

Create minimal `CommitmentExtractionProvider` stubs in chat and notes packages.

```typescript
// packages/chat/src/commitment-provider.ts
import type { CommitmentExtractionProvider, CommitmentTextBoundary } from "@jarv1s/module-sdk";

export const chatCommitmentProvider: CommitmentExtractionProvider = {
  sourceKind: "chat",
  async getTextBoundaries(scopedDb, actorUserId, since) {
    // TODO: query chat_messages for actorUserId where created_at > since
    return [];
  }
};
```

```typescript
// packages/notes/src/commitment-provider.ts
import type { CommitmentExtractionProvider, CommitmentTextBoundary } from "@jarv1s/module-sdk";

export const notesCommitmentProvider: CommitmentExtractionProvider = {
  sourceKind: "notes",
  async getTextBoundaries(scopedDb, actorUserId, since) {
    // TODO: query notes for actorUserId where updated_at > since
    return [];
  }
};
```

Export from `packages/chat/src/index.ts` and `packages/notes/src/index.ts`.

Wire providers into module-registry: update the `registerCommitmentExtractionWorker` call to include `[chatCommitmentProvider, notesCommitmentProvider]`.

Unit test: shape test that both providers export `sourceKind` correctly.

**Commit:** `feat(commitments): Task 11 — chat + notes CommitmentExtractionProvider stubs`

---

### Task 12: Integration tests

Create `tests/integration/commitments.test.ts`. Use lane DB `JARVIS_PGDATABASE=jarvis_build_537`.

The integration test should:

1. Create a `DataContextRunner` connected to `jarvis_build_537`
2. Call `withDataContext({ actorUserId: TEST_USER_ID, requestId: 'test' }, async (scopedDb) => {...})`
3. Test `CommitmentsRepository.upsertCandidate` → returns candidate with correct fields
4. Test `addEvidenceRow` → max 5 rows enforced
5. Test `listCandidates` → filters by status
6. Test `upsertExtractionState` + `getExtractionState` → cursor updated

Pattern from other integration tests (read `tests/integration/` for examples). The foundation test at `tests/integration/foundation.test.ts` is the reference for setup.

**Commit:** `test(commitments): Task 12 — integration tests for repository CRUD + evidence cap`

---

### Task 13: Pre-push gate + rebase

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
# Verify 0125 is still free (check latest migration number on origin/main)
JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/unit/
JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/integration/foundation.test.ts
JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/integration/commitments.test.ts
git push -u origin rfa-537-commitment-extraction
```

Report to Coordinator via `herdr-pane-message` skill: "Tasks 1-13 done. PR ready at [url]. Gate: pnpm verify:foundation green. Awaiting QA + merge."

---

## Key Patterns

### Subpath export wiring (add for EACH new subpath `./foo`):

1. `packages/commitments/package.json` exports: `"./foo": "./src/foo.ts"`
2. `vitest.config.ts` alias (BEFORE the main `@jarv1s/commitments` alias): `{ find: "@jarv1s/commitments/foo", replacement: fileURLToPath(new URL("./packages/commitments/src/foo.ts", ...)) }`
3. `tsconfig.json` paths: `"@jarv1s/commitments/foo": ["packages/commitments/src/foo.ts"]`
4. Test import: `import { ... } from "@jarv1s/commitments/foo"`

### assertDataContextDb pattern:

```typescript
assertDataContextDb(scopedDb); // narrows type, returns void
return scopedDb.db.selectFrom("app.commitment_candidates as c")...
```

### PgBoss import: `import type { PgBoss } from "pg-boss"` (named, not default)

### registerDataContextWorker handler signature: `async (job, scopedDb) => { const { actorUserId, ... } = job.data; }`

### ToolExecute + renderToolResult: check exact imports from `@jarv1s/module-sdk`

### Lane DB: always prefix integration test commands with `JARVIS_PGDATABASE=jarvis_build_537`

### Never commit to `docs/coordination/` — coordinator-only

### Pre-push trio before EVERY push: `pnpm format:check && pnpm lint && pnpm typecheck`

---

## Coordinator Info

- Coordinator label: `Coordinator`
- Session ID: `5e1a6b62-a480-4b5c-9706-e476cfe77044` (stable — verify fresh pane_id from `herdr pane list` before messaging)
- On completion: report PR URL + gate evidence to Coordinator via herdr-pane-message skill
