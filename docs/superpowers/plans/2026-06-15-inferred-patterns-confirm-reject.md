# Inferred Patterns Confirm Reject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build issue #243 so inferred `chat_memory_facts` can be confirmed or rejected, with rejected content suppressed from future extraction.

**Architecture:** Keep memory ownership in the memory module: add a shared suppression/corrections table and repository beside `ChatMemoryFactsRepository`. Chat routes expose owner-scoped confirm/reject actions, and the extraction worker skips inferred facts whose normalized category+content signature is suppressed for the actor. The settings memory pane lists inferred facts separately with confirm/reject actions while keeping remembered facts in the existing review/delete list.

**Tech Stack:** TypeScript, Fastify, Kysely raw SQL via `DataContextDb`, Postgres RLS migrations, React Query, Vitest integration/unit tests.

---

## File Structure

- Create `packages/memory/sql/0092_inferred_patterns_suppression.sql`: placeholder migration number required by handoff. Defines `app.chat_memory_suppressions`, owner-only RLS, app/worker grants, and a comment documenting reuse by #244 corrections-log.
- Create `packages/memory/src/fact-signature.ts`: stable `createMemoryFactSignature(category, content)` helper using trimmed/lowercased/collapsed whitespace `category::content` and SHA-256 hex.
- Create `packages/memory/src/suppressions-repository.ts`: repository for insert/list/check suppression records. Uses `DataContextDb`, `app.chat_memory_suppressions`, and exported types for reason/signature rows.
- Modify `packages/memory/src/facts-repository.ts`: add `confirmFact(scopedDb, id)` and `getActiveFact(scopedDb, id)` for route use under RLS.
- Modify `packages/memory/src/index.ts`: export signature helper and suppression repository.
- Modify `packages/chat/src/routes.ts`: instantiate suppression repo; add `POST /api/chat/memory/facts/:id/confirm` and `POST /api/chat/memory/facts/:id/reject`.
- Modify `packages/chat/src/jobs.ts`: use `createMemoryFactSignature` and suppression repo to skip suppressed inferred facts before insert.
- Modify `packages/chat/src/manifest.ts`: declare confirm/reject routes.
- Modify `apps/web/src/api/client.ts`: add `confirmMemoryFact(id)` and `rejectMemoryFact(id)`.
- Modify `apps/web/src/settings/settings-memory-pane.tsx`: separate remembered vs inferred facts, remove `coming` from inferred row, add yes/no actions for inferred facts, invalidate memory facts after confirm/reject.
- Modify `apps/web/src/styles/settings-panes-2.css`: add compact action styles only if existing button/list classes cannot support the inferred row layout.
- Modify `tests/integration/chat-recall.test.ts`: migration, repository/RLS, and REST confirm/reject coverage.
- Modify `tests/integration/chat-live.test.ts`: extraction suppression guard coverage.
- Modify `tests/unit/route-coverage.test.ts`: include confirm/reject manifest route declarations.

## Task 1: Suppression Store And Signature Helper

**Files:**
- Create: `packages/memory/sql/0092_inferred_patterns_suppression.sql`
- Create: `packages/memory/src/fact-signature.ts`
- Create: `packages/memory/src/suppressions-repository.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `tests/integration/chat-recall.test.ts`

- [ ] **Step 1: Write failing migration/schema tests**

Add tests in `tests/integration/chat-recall.test.ts` under `describe("Phase 3 Recall migrations", ...)`:

```ts
  it("0092: chat_memory_suppressions table exists with owner-scoped signature columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_memory_suppressions'
         ORDER BY column_name`
      );
      const cols = res.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "owner_user_id",
          "signature",
          "category",
          "content",
          "reason",
          "created_at"
        ])
      );
    } finally {
      await client.end();
    }
  });

  it("0092: chat_memory_suppressions grants app and worker runtime access", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT grantee, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'app'
           AND table_name = 'chat_memory_suppressions'
           AND grantee IN ('jarvis_app_runtime', 'jarvis_worker_runtime')`
      );
      expect(res.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ grantee: "jarvis_app_runtime", privilege_type: "SELECT" }),
          expect.objectContaining({ grantee: "jarvis_app_runtime", privilege_type: "INSERT" }),
          expect.objectContaining({ grantee: "jarvis_worker_runtime", privilege_type: "SELECT" }),
          expect.objectContaining({ grantee: "jarvis_worker_runtime", privilege_type: "INSERT" })
        ])
      );
    } finally {
      await client.end();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-recall.test.ts -t "0092"`

Expected: FAIL because `chat_memory_suppressions` does not exist.

- [ ] **Step 3: Add migration**

Create `packages/memory/sql/0092_inferred_patterns_suppression.sql`:

```sql
-- Shared memory corrections/suppressions store.
-- #243 writes reason='rejected' rows when an inferred chat_memory_fact is rejected.
-- #244 corrections-log will extend/reuse this table instead of creating a parallel store.

CREATE TABLE IF NOT EXISTS app.chat_memory_suppressions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  signature     TEXT        NOT NULL,
  category      TEXT        NOT NULL CHECK (category IN ('preference', 'fact', 'profile', 'goal')),
  content       TEXT        NOT NULL,
  reason        TEXT        NOT NULL CHECK (reason IN ('rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, signature)
);

CREATE INDEX IF NOT EXISTS chat_memory_suppressions_owner_idx
  ON app.chat_memory_suppressions (owner_user_id, created_at DESC);

ALTER TABLE app.chat_memory_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_memory_suppressions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_memory_suppressions_select ON app.chat_memory_suppressions;
CREATE POLICY chat_memory_suppressions_select ON app.chat_memory_suppressions
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_suppressions_insert ON app.chat_memory_suppressions;
CREATE POLICY chat_memory_suppressions_insert ON app.chat_memory_suppressions
  FOR INSERT TO jarvis_app_runtime, jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT ON app.chat_memory_suppressions TO jarvis_app_runtime;
GRANT SELECT, INSERT ON app.chat_memory_suppressions TO jarvis_worker_runtime;
```

- [ ] **Step 4: Add signature helper and repository tests**

Add imports in `tests/integration/chat-recall.test.ts`:

```ts
import {
  ChatMemoryFactsRepository,
  ChatMemorySuppressionsRepository,
  createMemoryFactSignature
} from "@jarv1s/memory";
```

Add repository tests under `describe("ChatMemoryFactsRepository", ...)` or a new adjacent `describe("ChatMemorySuppressionsRepository", ...)`:

```ts
  it("creates stable signatures from normalized category and content", () => {
    expect(createMemoryFactSignature("preference", "  Prefers   direct Answers ")).toBe(
      createMemoryFactSignature("preference", "prefers direct answers")
    );
    expect(createMemoryFactSignature("goal", "prefers direct answers")).not.toBe(
      createMemoryFactSignature("preference", "prefers direct answers")
    );
  });

  it("records rejected signatures and checks them owner-locally", async () => {
    const suppressions = new ChatMemorySuppressionsRepository();
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const signature = createMemoryFactSignature("preference", "Prefers direct answers");
      await suppressions.insertSuppression(scopedDb, userId, {
        signature,
        category: "preference",
        content: "Prefers direct answers",
        reason: "rejected"
      });
      await expect(suppressions.isSuppressed(scopedDb, userId, signature)).resolves.toBe(true);
    });
    await dataContext.withDataContext(ctx(ids.userB), async (scopedDb) => {
      const signature = createMemoryFactSignature("preference", "Prefers direct answers");
      await expect(suppressions.isSuppressed(scopedDb, ids.userB, signature)).resolves.toBe(false);
    });
  });
```

- [ ] **Step 5: Run tests to verify repository tests fail**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-recall.test.ts -t "signature|suppressed|0092"`

Expected: FAIL because exports/repository do not exist.

- [ ] **Step 6: Implement helper, repository, and exports**

Create `packages/memory/src/fact-signature.ts`:

```ts
import { createHash } from "node:crypto";

import type { FactCategory } from "./facts-repository.js";

export function normalizeMemoryFactContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createMemoryFactSignature(category: FactCategory, content: string): string {
  const normalized = `${category}::${normalizeMemoryFactContent(content)}`;
  return createHash("sha256").update(normalized).digest("hex");
}
```

Create `packages/memory/src/suppressions-repository.ts` with `insertSuppression` using `ON CONFLICT (owner_user_id, signature) DO NOTHING`, `isSuppressed`, and `listSuppressions`.

Export these from `packages/memory/src/index.ts`.

- [ ] **Step 7: Run focused tests green**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-recall.test.ts -t "signature|suppressed|0092"`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/memory/sql/0092_inferred_patterns_suppression.sql \
  packages/memory/src/fact-signature.ts \
  packages/memory/src/suppressions-repository.ts \
  packages/memory/src/index.ts \
  tests/integration/chat-recall.test.ts
git commit -m "feat(memory): add rejected fact suppression store" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 2: Confirm And Reject REST Routes

**Files:**
- Modify: `packages/memory/src/facts-repository.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/chat/src/manifest.ts`
- Test: `tests/integration/chat-recall.test.ts`
- Test: `tests/unit/route-coverage.test.ts`

- [ ] **Step 1: Write failing REST and manifest tests**

Add route coverage expectations for:

```ts
{ method: "POST", path: "/api/chat/memory/facts/:id/confirm" },
{ method: "POST", path: "/api/chat/memory/facts/:id/reject" },
```

Add integration tests:

```ts
  it("POST /api/chat/memory/facts/:id/confirm promotes an inferred fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Confirm route test",
        provenance: "inferred"
      })
    );
    const res = await server.inject({
      method: "POST",
      url: `/api/chat/memory/facts/${fact.id}/confirm`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(204);
    const facts = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.listActiveFacts(scopedDb, ids.userA)
    );
    expect(facts.find((f) => f.id === fact.id)?.provenance).toBe("confirmed");
  });

  it("POST /api/chat/memory/facts/:id/reject deletes inferred fact and writes suppression", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "goal",
        content: "Reject route test",
        provenance: "inferred"
      })
    );
    const res = await server.inject({
      method: "POST",
      url: `/api/chat/memory/facts/${fact.id}/reject`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(204);
    await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      const facts = await factsRepo.listActiveFacts(scopedDb, ids.userA);
      expect(facts.find((f) => f.id === fact.id)).toBeUndefined();
      const suppressions = new ChatMemorySuppressionsRepository();
      await expect(
        suppressions.isSuppressed(
          scopedDb,
          ids.userA,
          createMemoryFactSignature("goal", "Reject route test")
        )
      ).resolves.toBe(true);
    });
  });

  it("non-owner cannot confirm or reject another user's fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Non-owner route test",
        provenance: "inferred"
      })
    );
    for (const action of ["confirm", "reject"] as const) {
      const res = await server.inject({
        method: "POST",
        url: `/api/chat/memory/facts/${fact.id}/${action}`,
        headers: { authorization: `Bearer ${ids.sessionB}` }
      });
      expect(res.statusCode).toBe(404);
    }
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-recall.test.ts tests/unit/route-coverage.test.ts -t "confirm|reject|manifest"`

Expected: FAIL because routes and manifest entries do not exist.

- [ ] **Step 3: Implement repository methods**

In `ChatMemoryFactsRepository`, add:

```ts
  async getActiveFact(scopedDb: DataContextDb, id: string): Promise<MemoryFact | undefined> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      category: FactCategory;
      content: string;
      source_thread_id: string | null;
      importance: number;
      provenance: FactProvenance;
      status: FactStatus;
      superseded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>`
      SELECT * FROM app.chat_memory_facts
      WHERE id = ${id}::uuid AND status = 'active'
    `.execute(scopedDb.db);
    return result.rows[0] ? this.#mapRow(result.rows[0]) : undefined;
  }

  async confirmFact(scopedDb: DataContextDb, id: string): Promise<boolean> {
    const result = await sql<{ id: string }>`
      UPDATE app.chat_memory_facts
      SET provenance = 'confirmed'::app.provenance_kind, updated_at = now()
      WHERE id = ${id}::uuid AND status = 'active' AND provenance = 'inferred'
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }
```

Use the existing row shape type inline, matching `listActiveFacts`.

- [ ] **Step 4: Implement routes**

In `packages/chat/src/routes.ts`, instantiate `ChatMemorySuppressionsRepository`. Add confirm route that returns `404` when `confirmFact` returns false. Add reject route that reads `getActiveFact`, returns `404` unless active inferred fact is visible to the actor, inserts suppression with `createMemoryFactSignature(fact.category, fact.content)`, then deletes the fact.

- [ ] **Step 5: Update manifest**

Add confirm/reject `POST` routes with `chat.message` permission in `packages/chat/src/manifest.ts`.

- [ ] **Step 6: Run focused tests green**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-recall.test.ts tests/unit/route-coverage.test.ts -t "confirm|reject|manifest"`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/memory/src/facts-repository.ts packages/chat/src/routes.ts \
  packages/chat/src/manifest.ts tests/integration/chat-recall.test.ts tests/unit/route-coverage.test.ts
git commit -m "feat(chat): confirm or reject inferred memory facts" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 3: Extraction Suppression Guard

**Files:**
- Modify: `packages/chat/src/jobs.ts`
- Test: `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Write failing extraction guard tests**

In `tests/integration/chat-live.test.ts`, add:

```ts
  it("skips suppressed inferred facts by stable signature", async () => {
    await seedEconomyModel("suppressed-inferred");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-suppressed" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "I keep accepting 8am meetings.",
        "Noted.",
        { provider: "anthropic", model: "claude-economy" }
      );
      const suppressions = new ChatMemorySuppressionsRepository();
      await suppressions.insertSuppression(scopedDb, ids.userA, {
        signature: createMemoryFactSignature("preference", "Accepts 8am meetings"),
        category: "preference",
        content: "Accepts 8am meetings",
        reason: "rejected"
      });
      await handleExtractFactsJob(
        scopedDb,
        ids.userA,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([
            {
              category: "preference",
              content: "  accepts   8AM meetings ",
              importance: 0.6,
              provenance: "inferred"
            }
          ])
        }))
      );
      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(facts.some((f) => createMemoryFactSignature(f.category, f.content) === createMemoryFactSignature("preference", "Accepts 8am meetings"))).toBe(false);
    });
  });

  it("does not let one user's suppression block another user's extraction", async () => {
    await seedEconomyModel("suppressed-other-user");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const suppressions = new ChatMemorySuppressionsRepository();
      await suppressions.insertSuppression(scopedDb, ids.userA, {
        signature: createMemoryFactSignature("goal", "Run a 10k"),
        category: "goal",
        content: "Run a 10k",
        reason: "rejected"
      });
    });
    await dataContext.withDataContext(userBContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-other-user" });
      await repository.recordCompletedTurn(scopedDb, thread.id, "I want to run a 10k.", "Noted.", {
        provider: "anthropic",
        model: "claude-economy"
      });
      await handleExtractFactsJob(
        scopedDb,
        ids.userB,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([{ category: "goal", content: "Run a 10k", provenance: "inferred" }])
        }))
      );
      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userB);
      expect(facts.some((f) => f.category === "goal" && f.content === "Run a 10k")).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-live.test.ts -t "suppressed"`

Expected: first test FAILS because extraction inserts suppressed inferred fact.

- [ ] **Step 3: Implement guard**

In `packages/chat/src/jobs.ts`, import `ChatMemorySuppressionsRepository` and `createMemoryFactSignature`. Extend `ExtractFactsDeps` with optional `suppressionsRepository?: ChatMemorySuppressionsRepository`; default it in `handleExtractFactsJob`. Before inserting a parsed fact, compute signature. If `fact.provenance === "inferred"` and `isSuppressed(scopedDb, ownerUserId, signature)` is true, skip insert. Continue adding signature to `existingByContent` only after an insert.

- [ ] **Step 4: Run focused tests green**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run tests/integration/chat-live.test.ts -t "suppressed|extracts JSON facts"`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/chat/src/jobs.ts tests/integration/chat-live.test.ts
git commit -m "feat(chat): suppress rejected inferred fact extraction" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 4: Settings Pane Confirm/Reject UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/settings/settings-memory-pane.tsx`
- Modify: `apps/web/src/styles/settings-panes-2.css`
- Test: run typecheck and existing unit tests; no direct component test harness exists for this pane.

- [ ] **Step 1: Add API client tests if a local client test exists**

Search: `rg -n "deleteMemoryFact|requestJson|api/client" tests apps -S`

If no existing client unit pattern exists, document no client unit test and rely on TypeScript plus integration route tests.

- [ ] **Step 2: Add client functions**

Add to `apps/web/src/api/client.ts`:

```ts
export async function confirmMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}/confirm`, {
    method: "POST"
  });
}

export async function rejectMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}/reject`, {
    method: "POST"
  });
}
```

- [ ] **Step 3: Update UI**

In `settings-memory-pane.tsx`, import `Check` and `X` from `lucide-react`, import client functions, derive:

```ts
const inferredFacts = facts.filter((fact) => fact.provenance === "inferred");
const rememberedFacts = facts.filter((fact) => fact.provenance !== "inferred");
```

Use `rememberedFacts.length` for Remembered facts count and `inferredFacts.length` for Inferred patterns row. Replace `coming` on "Inferred patterns" with a Review button that toggles the existing expanded state or a dedicated `inferredExpanded` state. Render inferred facts with category/content plus icon buttons:

```tsx
<button aria-label={`Confirm inferred pattern: ${fact.content}`} ...><Check size={14} /></button>
<button aria-label={`Reject inferred pattern: ${fact.content}`} ...><X size={14} /></button>
```

Confirm mutation calls `confirmMemoryFact`, invalidates `queryKeys.chat.memoryFacts`, toasts "Pattern confirmed". Reject mutation uses the same confirmation modal style as delete, calls `rejectMemoryFact`, invalidates facts, and toasts "Pattern rejected".

- [ ] **Step 4: Keep remembered review behavior**

The "Review & delete memories" list should render `rememberedFacts`, not all facts. Its empty text should say "No remembered facts stored yet." The existing delete behavior remains for remembered facts.

- [ ] **Step 5: Run frontend checks**

Run: `pnpm vitest run tests/unit/settings-memory-pane-provenance.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/web/src/api/client.ts apps/web/src/settings/settings-memory-pane.tsx \
  apps/web/src/styles/settings-panes-2.css
git commit -m "feat(web): manage inferred patterns from memory settings" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 5: Focused Integration Sweep And Full Gates

**Files:**
- No new files expected; fixes only as required by red tests.

- [ ] **Step 1: Run focused suites**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm vitest run \
  tests/integration/chat-recall.test.ts \
  tests/integration/chat-live.test.ts \
  tests/unit/route-coverage.test.ts \
  tests/unit/settings-memory-pane-provenance.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required pre-push trio**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run full foundation verification**

Run: `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm verify:foundation`

Expected: PASS.

- [ ] **Step 4: Fresh rebase before push**

Run:

```bash
git fetch origin main
git rebase origin/main
```

Expected: clean rebase, with coordinator handling any merge-order collision if it appears.

- [ ] **Step 5: Coordinated wrap-up**

Invoke `/home/ben/Jarv1s/.claude/skills/coordinated-wrap-up/SKILL.md`, push branch, open PR, and report PR + verification evidence to Coordinator. Do not touch `docs/coordination/`, project board, issue closure, merge, or broad staging.

## Self-Review

- Spec coverage: suppression store, confirm route, reject route, extraction guard, owner-only isolation, non-owner denial, UI confirm/reject, no new pattern engine, and full verification are each covered by tasks.
- Placeholder scan: no task uses TBD/TODO/fill-later language.
- Type consistency: `FactCategory`, `FactProvenance`, `ChatMemoryFactsRepository`, `ChatMemorySuppressionsRepository`, and `createMemoryFactSignature` names are used consistently.
- Collision guard: migration keeps placeholder `0092_inferred_patterns_suppression.sql`; `apps/web/src/api/client.ts` and `packages/chat/src/routes.ts` are touched only for this issue; `apps/web/src/onboarding/**` and `docs/coordination/**` are untouched.
