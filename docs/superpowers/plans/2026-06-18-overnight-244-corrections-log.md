# Corrections Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build issue #244: a truthful owner-scoped corrections log that records rejected inferred patterns and chat-captured corrections, exposes it through REST, and renders it in Settings.

**Architecture:** Reuse `app.chat_memory_suppressions` as the shared suppression/corrections table. Add an additive memory migration for `corrected` metadata, keep suppression signature checks intact, and make chat extraction log a correction only after it supersedes an existing active fact and inserts the replacement. The API and UI consume a chronological, owner-scoped read model; job payloads stay metadata-only.

**Tech Stack:** PostgreSQL RLS migrations, Kysely SQL repositories, Fastify routes, shared TS DTOs, React Query, Vitest integration/unit tests.

---

## File Structure

- Create `packages/memory/sql/0096_chat_memory_corrections_log.sql`: additive migration extending `app.chat_memory_suppressions`; current repo head includes `0095`, and this branch rebased on `origin/main` before plan.
- Modify `packages/memory/src/suppressions-repository.ts`: widen types, add `insertCorrection`, chronological `listCorrections`, mapper, pagination.
- Modify `packages/memory/src/index.ts`: export correction DTO/repository types.
- Modify `packages/chat/src/jobs.ts`: extend extraction prompt/parser for corrections; log corrections only when a grounded supersession and replacement write happen.
- Modify `packages/chat/src/routes.ts`: add `GET /api/chat/memory/corrections`, serialize correction rows, keep owner-scoped `withDataContext`.
- Modify `packages/chat/src/manifest.ts` and `tests/unit/route-coverage.test.ts`: declare/test the new route.
- Modify `packages/shared/src/chat-api.ts`: add DTO/response schemas for memory corrections.
- Create `apps/web/src/api/memory-client.ts`: move memory settings/facts functions from bloated `client.ts` and add corrections call.
- Modify `apps/web/src/api/client.ts`: export `requestJson` and re-export memory API from `memory-client.ts`; remove old memory block so file stays below 1000 lines.
- Modify `apps/web/src/api/query-keys.ts`: add `queryKeys.chat.memoryCorrections`.
- Modify `apps/web/src/settings/settings-memory-pane.tsx`: fetch corrections and render chronological section instead of `coming`.
- Modify `apps/web/src/styles/settings-panes-2.css`: add compact correction row styling if existing `memory-fact` styles are insufficient.
- Modify `tests/integration/chat-recall.test.ts`: schema assertions, reject route writes a `rejected` correction row, corrections route owner-scoped/paginated.
- Modify `tests/integration/chat-live.test.ts`: correction extraction updates/suppresses old fact, writes `corrected` row, ignores noise/hallucinated corrections, preserves metadata-only payload behavior via existing queue assertions.
- Add focused web unit coverage only if existing test harness can render React Query components cheaply; otherwise add pure model/helper tests if a helper is extracted.

## Task 1: Schema + Repository Read Model

**Files:**

- Create: `packages/memory/sql/0096_chat_memory_corrections_log.sql`
- Modify: `packages/memory/src/suppressions-repository.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `tests/integration/chat-recall.test.ts`

- [ ] **Step 1: Write failing migration assertions**

Add a `0096` assertion near the existing `0092` suppression tests:

```ts
it("0096: chat_memory_suppressions supports corrections log metadata", async () => {
  const client = new Client({ connectionString: connectionStrings.migration });
  await client.connect();
  try {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'chat_memory_suppressions'
       ORDER BY column_name`
    );
    expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual(
      expect.arrayContaining(["source", "fact_id", "before_content", "after_content"])
    );
    const checks = await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'app'
         AND t.relname = 'chat_memory_suppressions'
         AND c.contype = 'c'`
    );
    const defs = checks.rows.map((r: { def: string }) => r.def).join("\n");
    expect(defs).toContain("corrected");
    expect(defs).toContain("pattern-reject");
    expect(defs).toContain("chat");
  } finally {
    await client.end();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm db:migrate
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-recall.test.ts -t "0096"
```

Expected: FAIL because columns/checks do not exist.

- [ ] **Step 3: Add additive migration**

Create `packages/memory/sql/0096_chat_memory_corrections_log.sql`:

```sql
ALTER TABLE app.chat_memory_suppressions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pattern-reject',
  ADD COLUMN IF NOT EXISTS fact_id UUID NULL REFERENCES app.chat_memory_facts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS before_content TEXT NULL,
  ADD COLUMN IF NOT EXISTS after_content TEXT NULL;

ALTER TABLE app.chat_memory_suppressions
  DROP CONSTRAINT IF EXISTS chat_memory_suppressions_reason_check;
ALTER TABLE app.chat_memory_suppressions
  ADD CONSTRAINT chat_memory_suppressions_reason_check
  CHECK (reason IN ('rejected', 'corrected'));

ALTER TABLE app.chat_memory_suppressions
  DROP CONSTRAINT IF EXISTS chat_memory_suppressions_source_check;
ALTER TABLE app.chat_memory_suppressions
  ADD CONSTRAINT chat_memory_suppressions_source_check
  CHECK (source IN ('chat', 'pattern-reject'));

CREATE INDEX IF NOT EXISTS chat_memory_suppressions_fact_idx
  ON app.chat_memory_suppressions (owner_user_id, fact_id, created_at DESC);
```

No RLS policy rewrite is needed: existing owner-only SELECT/INSERT policies remain scoped by `owner_user_id = app.current_actor_user_id()`.

- [ ] **Step 4: Extend repository types and inserts**

In `suppressions-repository.ts`, change types:

```ts
export type MemorySuppressionReason = "rejected" | "corrected";
export type MemoryCorrectionSource = "chat" | "pattern-reject";

export interface MemoryCorrection {
  readonly id: string;
  readonly ownerUserId: string;
  readonly signature: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly reason: MemorySuppressionReason;
  readonly source: MemoryCorrectionSource;
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: Date;
}
```

Keep `insertSuppression` but insert `source = "pattern-reject"` and `before_content = data.content`:

```ts
INSERT INTO app.chat_memory_suppressions
  (owner_user_id, signature, category, content, reason, source, before_content)
VALUES
  (${ownerUserId}::uuid, ${data.signature}, ${data.category}, ${data.content},
   ${data.reason}, 'pattern-reject', ${data.content})
ON CONFLICT (owner_user_id, signature) DO NOTHING
```

Add `insertCorrection`:

```ts
async insertCorrection(
  scopedDb: DataContextDb,
  ownerUserId: string,
  data: {
    readonly signature: string;
    readonly category: FactCategory;
    readonly content: string;
    readonly factId: string;
    readonly beforeContent: string;
    readonly afterContent: string;
  }
): Promise<void> {
  await sql`
    INSERT INTO app.chat_memory_suppressions
      (owner_user_id, signature, category, content, reason, source, fact_id, before_content, after_content)
    VALUES
      (${ownerUserId}::uuid, ${data.signature}, ${data.category}, ${data.content},
       'corrected', 'chat', ${data.factId}::uuid, ${data.beforeContent}, ${data.afterContent})
    ON CONFLICT (owner_user_id, signature) DO UPDATE SET
      reason = EXCLUDED.reason,
      source = EXCLUDED.source,
      fact_id = EXCLUDED.fact_id,
      before_content = EXCLUDED.before_content,
      after_content = EXCLUDED.after_content,
      created_at = now()
  `.execute(scopedDb.db);
}
```

Add `listCorrections(scopedDb, ownerUserId, { limit, offset })` ordering by `created_at DESC, id DESC`, returning `MemoryCorrection[]`.

- [ ] **Step 5: Export repository types**

In `packages/memory/src/index.ts`, export `MemoryCorrection` and `MemoryCorrectionSource`.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm db:migrate
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-recall.test.ts -t "0096|records rejected signatures"
pnpm typecheck
```

Commit:

```bash
git add packages/memory/sql/0096_chat_memory_corrections_log.sql packages/memory/src/suppressions-repository.ts packages/memory/src/index.ts tests/integration/chat-recall.test.ts
git commit -m "feat(memory): extend suppressions as corrections log

Co-Authored-By: Claude Sonnet 4.6"
```

## Task 2: Corrections REST Contract + Owner-Scoped Route

**Files:**

- Modify: `packages/shared/src/chat-api.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/chat/src/manifest.ts`
- Modify: `tests/unit/route-coverage.test.ts`
- Test: `tests/integration/chat-recall.test.ts`

- [ ] **Step 1: Add failing route tests**

In `tests/integration/chat-recall.test.ts`, add:

```ts
it("GET /api/chat/memory/corrections returns only the actor's chronological corrections", async () => {
  const suppressions = new ChatMemorySuppressionsRepository();
  await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
    await suppressions.insertSuppression(scopedDb, ids.userA, {
      signature: createMemoryFactSignature("goal", "Owner correction route A"),
      category: "goal",
      content: "Owner correction route A",
      reason: "rejected"
    });
  });
  await dataContext.withDataContext(ctx(ids.userB), async (scopedDb) => {
    await suppressions.insertSuppression(scopedDb, ids.userB, {
      signature: createMemoryFactSignature("goal", "Foreign correction route B"),
      category: "goal",
      content: "Foreign correction route B",
      reason: "rejected"
    });
  });

  const res = await server.inject({
    method: "GET",
    url: "/api/chat/memory/corrections?limit=10",
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ corrections: { content: string; reason: string; source: string }[] }>();
  expect(body.corrections).toContainEqual(
    expect.objectContaining({
      content: "Owner correction route A",
      reason: "rejected",
      source: "pattern-reject"
    })
  );
  expect(body.corrections.some((row) => row.content === "Foreign correction route B")).toBe(false);
});
```

Update `route-coverage.test.ts` expected routes with:

```ts
{ method: "GET", path: "/api/chat/memory/corrections" }
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-recall.test.ts -t "corrections"
pnpm vitest run tests/unit/route-coverage.test.ts -t "chat manifest"
```

Expected: FAIL because route/manifest are missing.

- [ ] **Step 3: Add shared DTO/schema**

In `packages/shared/src/chat-api.ts`, add:

```ts
export type MemoryCorrectionReasonDto = "rejected" | "corrected";
export type MemoryCorrectionSourceDto = "chat" | "pattern-reject";

export interface MemoryCorrectionDto {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly reason: MemoryCorrectionReasonDto;
  readonly source: MemoryCorrectionSourceDto;
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: string;
}

export interface ListMemoryCorrectionsResponse {
  readonly corrections: readonly MemoryCorrectionDto[];
}
```

Add JSON schemas and `listMemoryCorrectionsRouteSchema` with 200/401 responses.

- [ ] **Step 4: Add Fastify route**

In `routes.ts`, import `type MemoryCorrection` and `listMemoryCorrectionsRouteSchema`, then add after memory facts GET:

```ts
server.get(
  "/api/chat/memory/corrections",
  { schema: listMemoryCorrectionsRouteSchema },
  async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const { limit, offset } = parsePagination(request.query);
      const corrections = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        suppressionsRepo.listCorrections(scopedDb, access.actorUserId, { limit, offset })
      );
      return { corrections: corrections.map(serializeCorrection) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Add helpers:

```ts
function parsePagination(query: unknown): { limit: number; offset: number } {
  const q = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const limit = Number(q.limit ?? 25);
  const offset = Number(q.offset ?? 0);
  return {
    limit: Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 25,
    offset: Number.isInteger(offset) ? Math.max(0, offset) : 0
  };
}

function serializeCorrection(c: MemoryCorrection) {
  return {
    id: c.id,
    category: c.category,
    content: c.content,
    reason: c.reason,
    source: c.source,
    factId: c.factId,
    beforeContent: c.beforeContent,
    afterContent: c.afterContent,
    createdAt: toIsoString(c.createdAt)
  };
}
```

- [ ] **Step 5: Update manifest**

In `packages/chat/src/manifest.ts`, import/use `listMemoryCorrectionsResponseSchema` and add:

```ts
{
  method: "GET",
  path: "/api/chat/memory/corrections",
  responseSchema: listMemoryCorrectionsResponseSchema,
  permissionId: "chat.view"
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-recall.test.ts -t "corrections|reject deletes"
pnpm vitest run tests/unit/route-coverage.test.ts
pnpm typecheck
```

Commit:

```bash
git add packages/shared/src/chat-api.ts packages/chat/src/routes.ts packages/chat/src/manifest.ts tests/unit/route-coverage.test.ts tests/integration/chat-recall.test.ts
git commit -m "feat(chat): expose memory corrections route

Co-Authored-By: Claude Sonnet 4.6"
```

## Task 3: Chat Extraction Corrections

**Files:**

- Modify: `packages/chat/src/jobs.ts`
- Test: `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Add failing extraction tests**

In the `handleExtractFactsJob` describe, add `resetFoundationDatabase()` to its own `beforeAll` if absent, per known focused-test trap.

Add test:

```ts
it("logs a corrected row only when a grounded active fact is superseded and replaced", async () => {
  await seedEconomyModel("corrected");
  await dataContext.withDataContext(userAContext(), async (scopedDb) => {
    const thread = await repository.openNewThread(scopedDb, { title: "Facts-corrected" });
    const old = await factsRepository.insertFact(scopedDb, ids.userA, {
      category: "preference",
      content: "Prefers tea",
      sourceThreadId: thread.id,
      provenance: "volunteered"
    });
    await repository.recordCompletedTurn(
      scopedDb,
      thread.id,
      "No, I prefer coffee, not tea.",
      "Got it.",
      { provider: "anthropic", model: "claude-economy" }
    );

    await handleExtractFactsJob(
      scopedDb,
      ids.userA,
      thread.id,
      makeDeps(async () => ({
        text: JSON.stringify([
          {
            category: "preference",
            content: "Prefers coffee",
            importance: 0.8,
            provenance: "volunteered",
            correction: {
              supersedes: old.id,
              before: "Prefers tea",
              after: "Prefers coffee"
            }
          }
        ])
      }))
    );

    const active = await factsRepository.listActiveFacts(scopedDb, ids.userA);
    expect(active.some((fact) => fact.id === old.id)).toBe(false);
    expect(active.some((fact) => fact.content === "Prefers coffee")).toBe(true);
    const corrections = await new ChatMemorySuppressionsRepository().listCorrections(
      scopedDb,
      ids.userA,
      { limit: 10, offset: 0 }
    );
    expect(corrections).toContainEqual(
      expect.objectContaining({
        reason: "corrected",
        source: "chat",
        factId: old.id,
        beforeContent: "Prefers tea",
        afterContent: "Prefers coffee"
      })
    );
  });
});
```

Add a false-positive guard:

```ts
it("does not log a correction for hallucinated correction ids", async () => {
  await seedEconomyModel("correction-hallucinated");
  await dataContext.withDataContext(userAContext(), async (scopedDb) => {
    const thread = await repository.openNewThread(scopedDb, { title: "Facts-correction-fake" });
    await repository.recordCompletedTurn(scopedDb, thread.id, "Maybe I like coffee.", "Noted.", {
      provider: "anthropic",
      model: "claude-economy"
    });
    await handleExtractFactsJob(
      scopedDb,
      ids.userA,
      thread.id,
      makeDeps(async () => ({
        text: JSON.stringify([
          {
            category: "preference",
            content: "May like coffee",
            correction: {
              supersedes: "11111111-1111-4111-8111-111111111111",
              before: "Prefers tea",
              after: "May like coffee"
            }
          }
        ])
      }))
    );
    const corrections = await new ChatMemorySuppressionsRepository().listCorrections(
      scopedDb,
      ids.userA,
      { limit: 10, offset: 0 }
    );
    expect(corrections.some((row) => row.factId === "11111111-1111-4111-8111-111111111111")).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-live.test.ts -t "corrected|hallucinated"
```

Expected: FAIL because parser ignores `correction` and handler does not write corrected rows.

- [ ] **Step 3: Extend parser types**

In `jobs.ts`, add:

```ts
interface ParsedCorrection {
  readonly supersedes: string;
  readonly before: string;
  readonly after: string;
}

interface ParsedFact {
  readonly category: FactCategory;
  readonly content: string;
  readonly importance: number;
  readonly provenance: FactProvenance;
  readonly supersedes?: string;
  readonly correction?: ParsedCorrection;
}
```

Parse `r.correction` only when it is an object with string `supersedes`, `before`, and `after`. Keep existing `supersedes` parsing for backward compatibility.

- [ ] **Step 4: Tune prompt**

Change prompt contract from only facts to facts plus optional correction:

```ts
'each item: {"category": "preference|fact|profile|goal", "content": string, ' +
  '"importance": number 0..1, "provenance": "volunteered|inferred", "supersedes": optional id, ' +
  '"correction": optional {"supersedes": id, "before": string, "after": string}}. ' +
  "Use correction ONLY when the user explicitly corrects an existing listed belief and the replacement content should become the new durable fact. ";
```

Also keep: ids must be from listed active facts; never invent ids.

- [ ] **Step 5: Log correction only after real change**

Inside the fact loop:

1. Resolve `supersedesId = fact.correction?.supersedes ?? fact.supersedes`.
2. If `supersedesId` is in `activeIds`, capture `oldFact = activeFacts.find((f) => f.id === supersedesId)`.
3. Skip suppressed duplicate replacement as today.
4. Supersede old fact.
5. Insert replacement fact.
6. If `fact.correction` exists, call `insertCorrection` with old signature/content and replacement content.

Implementation shape:

```ts
const supersedesId = fact.correction?.supersedes ?? fact.supersedes;
const oldFact =
  typeof supersedesId === "string" && activeIds.has(supersedesId)
    ? activeFacts.find((candidate) => candidate.id === supersedesId)
    : undefined;

if (oldFact) {
  await deps.factsRepository.supersedeFact(scopedDb, oldFact.id);
}

const inserted = await deps.factsRepository.insertFact(scopedDb, ownerUserId, {
  category: fact.category,
  content: fact.content,
  sourceThreadId: threadId,
  importance: fact.importance,
  provenance: fact.provenance
});

if (oldFact && fact.correction) {
  await suppressionsRepository.insertCorrection(scopedDb, ownerUserId, {
    signature: createMemoryFactSignature(oldFact.category, oldFact.content),
    category: oldFact.category,
    content: oldFact.content,
    factId: oldFact.id,
    beforeContent: fact.correction.before || oldFact.content,
    afterContent: fact.correction.after || inserted.content
  });
}
```

If the replacement is a deduped existing active fact, do not log `corrected`; spec requires a real fact update/supersession plus replacement.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-live.test.ts -t "handleExtractFactsJob"
pnpm typecheck
```

Commit:

```bash
git add packages/chat/src/jobs.ts tests/integration/chat-live.test.ts
git commit -m "feat(chat): log grounded memory corrections

Co-Authored-By: Claude Sonnet 4.6"
```

## Task 4: Web API Client + Settings Corrections UI

**Files:**

- Create: `apps/web/src/api/memory-client.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-memory-pane.tsx`
- Modify: `apps/web/src/styles/settings-panes-2.css`
- Test: focused web/unit tests if existing harness supports component render

- [ ] **Step 1: Split memory client without behavior change**

Create `apps/web/src/api/memory-client.ts`:

```ts
import { requestJson } from "./client";

export interface MemorySettings {
  readonly recallEnabled: boolean;
  readonly factsEnabled: boolean;
}

export interface MemoryFact {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly importance: number;
  readonly provenance: "volunteered" | "inferred" | "confirmed";
  readonly sourceThreadId: string | null;
  readonly createdAt: string;
}

export interface MemoryCorrection {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly reason: "rejected" | "corrected";
  readonly source: "chat" | "pattern-reject";
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: string;
}
```

Move existing memory functions to this file and add:

```ts
export async function getMemoryCorrections(): Promise<{ corrections: MemoryCorrection[] }> {
  return requestJson<{ corrections: MemoryCorrection[] }>("/api/chat/memory/corrections");
}
```

In `client.ts`, change `async function requestJson` to `export async function requestJson`, delete old memory interfaces/functions, and add:

```ts
export type { MemoryCorrection, MemoryFact, MemorySettings } from "./memory-client";
export {
  confirmMemoryFact,
  deleteMemoryFact,
  getMemoryCorrections,
  getMemoryFacts,
  getMemorySettings,
  patchMemorySettings,
  rejectMemoryFact
} from "./memory-client";
```

- [ ] **Step 2: Add query key and UI query**

In `query-keys.ts`:

```ts
memoryCorrections: ["chat", "memory-corrections"] as const;
```

In `settings-memory-pane.tsx`, import `getMemoryCorrections` and `type MemoryCorrection`, add query:

```ts
const correctionsQuery = useQuery({
  queryKey: queryKeys.chat.memoryCorrections,
  queryFn: getMemoryCorrections,
  retry: false
});
const corrections: MemoryCorrection[] = correctionsQuery.data?.corrections ?? [];
```

Invalidate corrections after reject success:

```ts
void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memoryCorrections });
```

- [ ] **Step 3: Replace coming-soon row with real section**

Replace corrections `Row coming` with:

```tsx
<Row
  name="Corrections"
  desc="Times you've put Jarvis right. It learns from every one."
  control={<span className="memory-count">{corrections.length}</span>}
/>
<div className="memory-corrections-list">
  {corrections.length === 0 ? (
    <p className="memory-facts-empty">No corrections logged yet.</p>
  ) : (
    corrections.map((correction) => (
      <div key={correction.id} className="memory-correction">
        <span className="memory-fact__category">
          {correction.reason === "corrected" ? "corrected" : "rejected"}
        </span>
        <span className="memory-fact__content">
          {correction.reason === "corrected" && correction.afterContent
            ? `${correction.beforeContent ?? correction.content} -> ${correction.afterContent}`
            : correction.content}
        </span>
      </div>
    ))
  )}
</div>
```

Use ASCII `->`, not Unicode arrows.

- [ ] **Step 4: Add/adjust styles**

In `settings-panes-2.css`, add:

```css
.memory-corrections-list {
  display: grid;
  gap: 0;
  border-top: 1px solid var(--jds-border-subtle);
}

.memory-correction {
  display: grid;
  grid-template-columns: minmax(5rem, auto) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
  padding: 0.75rem 0;
  border-top: 1px solid var(--jds-border-subtle);
}

.memory-correction:first-child {
  border-top: 0;
}
```

- [ ] **Step 5: Add focused UI coverage if practical**

If a React component render helper already exists, test `MemoryPane` with mocked fetch responses:

```ts
expect(screen.getByText("Prefers tea -> Prefers coffee")).toBeInTheDocument();
expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
```

If no render harness exists, skip adding a brittle new renderer and rely on `pnpm build:web` plus the integration route tests.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
pnpm vitest run tests/unit/settings-memory-pane-facts-view.test.ts tests/unit/settings-memory-pane-provenance.test.ts
pnpm typecheck
pnpm build:web
```

Commit:

```bash
git add apps/web/src/api/memory-client.ts apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-memory-pane.tsx apps/web/src/styles/settings-panes-2.css
git commit -m "feat(web): render memory corrections in settings

Co-Authored-By: Claude Sonnet 4.6"
```

## Task 5: Full Spec Verification + Wrap-Up Prep

**Files:**

- Any fixes from focused failures.

- [ ] **Step 1: Run lane DB migration and targeted suites**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm db:migrate
JARVIS_PGDATABASE=jarvis_build_corr244 pnpm vitest run tests/integration/chat-recall.test.ts tests/integration/chat-live.test.ts
pnpm vitest run tests/unit/route-coverage.test.ts
pnpm build:web
```

Expected: all green.

- [ ] **Step 2: Run cheap repo checks before final gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm check:file-size
pnpm typecheck
```

Expected: all green; if `client.ts` exceeds 1000 lines, move more chat helpers into a focused client module instead of weakening the gate.

- [ ] **Step 3: Commit any verification fixes**

Commit with explicit paths:

```bash
git add <exact changed files>
git commit -m "test(chat): verify memory corrections log

Co-Authored-By: Claude Sonnet 4.6"
```

- [ ] **Step 4: Use coordinated-wrap-up**

After spec exit criteria are met and focused checks pass, invoke `coordinated-wrap-up`: run full `pnpm verify:foundation` and `pnpm audit:release-hardening` to lane-specific logs where applicable, pre-push trio, fresh rebase, push, PR, and report to `Coordinator`.

## Self-Review

- Spec coverage: shared store extension, owner-only RLS, metadata-only payloads, LLM captured corrections, truthful log semantics, route, settings UI, rejected/corrected tests, owner-scope tests, route manifest coverage.
- Placeholder scan: no TBD/TODO/fill-later steps.
- Type consistency: repository type names (`MemoryCorrection`, `MemoryCorrectionSource`, `insertCorrection`, `listCorrections`) match route/UI plan. Correction JSON shape uses `correction.supersedes` while preserving existing top-level `supersedes`.
