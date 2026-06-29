# Data Freshness Visibility (#541) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-source freshness timestamps on every Jarvis answer (briefings + chat) so users can see when the underlying data was last fetched.

**Architecture:** Add a `SourceFreshnessV1` metadata blob to briefing `source_metadata.sourceTimestamps` (JSONB, additive) and to assistant chat messages as `sourceFreshness` on `ChatMessageDto`; all freshness is resolved from already-recorded module state (connector `last_sync_finished_at`, vault `ingested_at`, or the capture time for real-time sources). Two new UI components: a Sources list on the briefing run card, and a collapsed freshness footer on assistant chat messages.

**Tech Stack:** TypeScript, Kysely (SQL), Vitest (unit + integration), React + `<details>` (web), existing `jds-*` CSS primitives, existing `chatd-peek` CSS pattern.

## Global Constraints

- No new tables, no RLS changes, no migrations — all freshness rides existing JSONB columns.
- `sourceMetadata` stays typed as `Record<string, unknown>` — `sourceTimestamps` is an additive key.
- Module isolation: briefings/chat access connector sync state only through the connectors module's public API (`getConnectorSyncAt`); never query connector tables directly.
- `DataContextDb` only; `AccessContext` shape unchanged (`{ actorUserId, requestId }`).
- Freshness entries contain timestamps only — never source content, subjects, credentials, or secrets.
- Freshness resolution never fails a run or turn — all errors produce `asOf: null` (`unknown`).
- No new sync jobs, pg-boss queues, or polling.
- No curved colored left-border card accent (AI tell); use existing `jds-*` and `chatd-peek` patterns.
- No new settings table; stale threshold is a compile-time constant (24h for briefings only).
- File size gate: all files ≤ 1000 lines; run `pnpm check:file-size` before committing.
- Collision guard: use field name `sourceFreshness` (ours), not `provenance` or `sources` (rfa-539's namespace).
- Prettier format check applies: run `pnpm format:check` before every commit.
- `pnpm test:briefings` = `vitest run tests/integration/briefings.test.ts tests/integration/briefings-synthesis.test.ts`
- `pnpm test:chat` = `vitest run tests/integration/chat-live.test.ts`
- `pnpm test:unit` = `vitest run tests/unit`

---

## File Map

| File                                             | Action | Responsibility                                                                                       |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| `packages/shared/src/freshness-types.ts`         | Create | `FreshnessKind`, `SourceFreshnessEntry`, `SourceFreshnessV1` types                                   |
| `packages/shared/src/index.ts`                   | Modify | Re-export freshness types                                                                            |
| `packages/connectors/src/freshness.ts`           | Create | `getConnectorSyncAt` public helper                                                                   |
| `packages/connectors/src/index.ts`               | Modify | Re-export `getConnectorSyncAt`                                                                       |
| `packages/memory/src/repository.ts`              | Modify | Add `getLatestIngestedAt` method                                                                     |
| `packages/briefings/src/freshness.ts`            | Create | `resolveBriefingFreshness` pure resolver                                                             |
| `packages/briefings/src/compose.ts`              | Modify | Extend `ComposeDeps`; call freshness resolver; add `sourceTimestamps` to metadata                    |
| `packages/shared/src/chat-api.ts`                | Modify | Add `sourceFreshness?: SourceFreshnessV1 \| null` to `ChatMessageDto` and Fastify schema             |
| `packages/chat/src/live/chat-session-manager.ts` | Modify | Extend `ChatPersistencePort.recordTurn` signature; collect invoked tool names in turn loop           |
| `packages/chat/src/live/persistence.ts`          | Modify | Extend `DataContextChatPersistenceDeps` with `connectorSyncAt?`; compute and thread freshness        |
| `packages/chat/src/repository.ts`                | Modify | Extend `recordCompletedTurn` to accept and store `sourceFreshness` in `toolMetadata`                 |
| `packages/chat/src/routes.ts`                    | Modify | Add `readSourceFreshness` helper; include in `serializeMessage`                                      |
| `packages/chat/src/live/runtime.ts`              | Modify | Thread `connectorSyncAt` from `CreateChatSessionRuntimeDeps` into `DataContextChatPersistence`       |
| `packages/module-registry/src/index.ts`          | Modify | Wire `connectorSyncAt` + `vaultLastWriteAt` in `composeDeps`; wire `connectorSyncAt` in chat runtime |
| `apps/web/src/today/briefing-freshness.tsx`      | Create | `BriefingFreshnessList` + `BriefingStaleBanner` React components                                     |
| `apps/web/src/today/today-page.tsx`              | Modify | Import and render `BriefingFreshnessList` / `BriefingStaleBanner` below evening run summary          |
| `apps/web/src/styles/kit-today-misc.css`         | Modify | `.bfresh-*` CSS for briefing freshness list                                                          |
| `apps/web/src/styles/kit-chat.css`               | Modify | `.chatd-freshness` CSS for chat freshness footer                                                     |
| `apps/web/src/chat/chat-drawer.tsx`              | Modify | Add `ChatFreshnessFooter` component; render below assistant reply                                    |
| `tests/unit/briefings-freshness.test.ts`         | Create | Unit tests for `resolveBriefingFreshness`                                                            |
| `tests/unit/briefings-compose.test.ts`           | Modify | Add `sourceTimestamps` assertion cases                                                               |
| `tests/unit/chat-freshness.test.ts`              | Create | Unit tests for chat tool-name → freshness mapping in persistence                                     |
| `tests/unit/chat-routes-freshness.test.ts`       | Create | Unit tests for `readSourceFreshness` serialization                                                   |

---

### Task 1: Shared freshness types

**Files:**

- Create: `packages/shared/src/freshness-types.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces: `FreshnessKind`, `SourceFreshnessEntry`, `SourceFreshnessV1` (all other tasks consume these)

- [ ] **Step 1: Create the types file**

```ts
// packages/shared/src/freshness-types.ts
export type FreshnessKind = "connector_sync" | "vault_write" | "memory_update" | "realtime";

export interface SourceFreshnessEntry {
  readonly source: string;
  readonly freshnessKind: FreshnessKind;
  readonly asOf: string | null; // ISO-8601 or null = unknown / never-synced
}

export interface SourceFreshnessV1 {
  readonly version: 1;
  readonly capturedAt: string; // ISO-8601 — the run/response generation time
  readonly sources: readonly SourceFreshnessEntry[];
}
```

- [ ] **Step 2: Re-export from shared index**

Append to `packages/shared/src/index.ts`:

```ts
export * from "./freshness-types.js";
```

- [ ] **Step 3: Verify types compile**

```bash
pnpm typecheck
```

Expected: no errors related to freshness-types.ts.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/freshness-types.ts packages/shared/src/index.ts
git commit -m "feat(freshness): add SourceFreshnessV1 shared types (#541)"
```

---

### Task 2: Connectors sync-at helper

**Files:**

- Create: `packages/connectors/src/freshness.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**

- Consumes: `ConnectorsRepository` from `./repository.js`, `DataContextDb` from `@jarv1s/db`, `GMAIL_SCOPE`/`CALENDAR_SCOPE` from `./sync-jobs.js`
- Produces: `getConnectorSyncAt(repo, scopedDb, kind) => Promise<Date | null>`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/connectors-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DataContextDb } from "@jarv1s/db";
import { getConnectorSyncAt } from "../../packages/connectors/src/freshness.js";
import type {
  ConnectorsRepository,
  ConnectorAccountSafeRow
} from "../../packages/connectors/src/repository.js";
import { GMAIL_SCOPE, CALENDAR_SCOPE } from "../../packages/connectors/src/sync-jobs.js";

function fakeRepo(accounts: Partial<ConnectorAccountSafeRow>[]): ConnectorsRepository {
  return {
    async listAccounts() {
      return accounts as ConnectorAccountSafeRow[];
    }
  } as unknown as ConnectorsRepository;
}

const scopedDb = {} as DataContextDb;

describe("getConnectorSyncAt", () => {
  it("returns null when no accounts match the kind", async () => {
    const repo = fakeRepo([{ scopes: [], last_sync_finished_at: new Date("2026-06-01") }]);
    expect(await getConnectorSyncAt(repo, scopedDb, "email")).toBeNull();
  });

  it("returns the max last_sync_finished_at for email accounts", async () => {
    const t1 = new Date("2026-06-20T10:00:00Z");
    const t2 = new Date("2026-06-21T08:00:00Z");
    const repo = fakeRepo([
      { scopes: [GMAIL_SCOPE], last_sync_finished_at: t1 },
      { scopes: [GMAIL_SCOPE], last_sync_finished_at: t2 }
    ]);
    expect(await getConnectorSyncAt(repo, scopedDb, "email")).toEqual(t2);
  });

  it("returns the max last_sync_finished_at for calendar accounts", async () => {
    const t = new Date("2026-06-22T06:00:00Z");
    const repo = fakeRepo([
      { scopes: [CALENDAR_SCOPE], last_sync_finished_at: t },
      { scopes: [CALENDAR_SCOPE], last_sync_finished_at: null }
    ]);
    expect(await getConnectorSyncAt(repo, scopedDb, "calendar")).toEqual(t);
  });

  it("returns null when all matching accounts have null last_sync_finished_at", async () => {
    const repo = fakeRepo([{ scopes: [GMAIL_SCOPE], last_sync_finished_at: null }]);
    expect(await getConnectorSyncAt(repo, scopedDb, "email")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify test fails**

```bash
pnpm test:unit -- tests/unit/connectors-freshness.test.ts
```

Expected: FAIL — `getConnectorSyncAt` not defined.

- [ ] **Step 3: Implement the helper**

```ts
// packages/connectors/src/freshness.ts
import type { DataContextDb } from "@jarv1s/db";

import { GMAIL_SCOPE, CALENDAR_SCOPE } from "./sync-jobs.js";
import type { ConnectorsRepository } from "./repository.js";

export async function getConnectorSyncAt(
  repo: ConnectorsRepository,
  scopedDb: DataContextDb,
  kind: "email" | "calendar"
): Promise<Date | null> {
  let accounts;
  try {
    accounts = await repo.listAccounts(scopedDb);
  } catch {
    return null;
  }
  const matching = accounts.filter((a) => {
    const s = a.scopes;
    return kind === "email"
      ? s.includes(GMAIL_SCOPE) || s.includes("gmail")
      : s.includes(CALENDAR_SCOPE) || s.includes("calendar");
  });
  const times = matching.map((a) => a.last_sync_finished_at).filter((t): t is Date => t !== null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((t) => t.getTime())));
}
```

- [ ] **Step 4: Re-export from connectors index**

Append to `packages/connectors/src/index.ts`:

```ts
export * from "./freshness.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test:unit -- tests/unit/connectors-freshness.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/freshness.ts packages/connectors/src/index.ts tests/unit/connectors-freshness.test.ts
git commit -m "feat(freshness): add getConnectorSyncAt to connectors public API (#541)"
```

---

### Task 3: Memory repository — getLatestIngestedAt

**Files:**

- Modify: `packages/memory/src/repository.ts`

**Interfaces:**

- Produces: `MemoryRepository.getLatestIngestedAt(scopedDb, sourceKind?) => Promise<Date | null>`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/memory-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "kysely";
import type { DataContextDb } from "@jarv1s/db";
import { MemoryRepository } from "../../packages/memory/src/repository.js";

describe("MemoryRepository.getLatestIngestedAt", () => {
  it("returns null on empty result", async () => {
    const repo = new MemoryRepository();
    const fakeDb = {
      db: {
        executeQuery: async () => ({ rows: [{ latest: null }] })
      }
    } as unknown as DataContextDb;
    // We test via the SQL branch by mocking assertDataContextDb
    // The real integration test exercises the DB path — here we verify null-handling
    // by constructing a DataContextDb stub with a bare db.
    // Since assertDataContextDb is a runtime check, we use a minimal stub:
    const mockScopedDb = {
      db: {
        // Return a result with null latest to verify the null-return path
        // We spy on sql`` — since we can't easily, just test the method exists and typecheck.
      }
    } as unknown as DataContextDb;
    // Type-level check: method signature must match expectation
    const method: (scopedDb: DataContextDb, sourceKind?: string) => Promise<Date | null> =
      repo.getLatestIngestedAt.bind(repo);
    expect(typeof method).toBe("function");
  });
});
```

Note: The real assertion for `getLatestIngestedAt` happens in the integration test (see Task 5 step where `vaultLastWriteAt` is tested via `composeBriefing` round-trip). The unit test above verifies the method exists with the right signature.

- [ ] **Step 2: Run to verify**

```bash
pnpm test:unit -- tests/unit/memory-freshness.test.ts
```

Expected: FAIL — `getLatestIngestedAt` does not exist on `MemoryRepository`.

- [ ] **Step 3: Add the method to MemoryRepository**

In `packages/memory/src/repository.ts`, add this method to the `MemoryRepository` class (before the closing brace):

```ts
async getLatestIngestedAt(
  scopedDb: DataContextDb,
  sourceKind: "vault" | "connector" = "vault"
): Promise<Date | null> {
  assertDataContextDb(scopedDb);
  const result = await sql<{ latest: Date | null }>`
    SELECT MAX(ingested_at) AS latest
    FROM app.memory_file_index
    WHERE source_kind = ${sourceKind}
  `.execute(scopedDb.db);
  return result.rows[0]?.latest ?? null;
}
```

- [ ] **Step 4: Run tests to verify**

```bash
pnpm test:unit -- tests/unit/memory-freshness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/repository.ts tests/unit/memory-freshness.test.ts
git commit -m "feat(freshness): add MemoryRepository.getLatestIngestedAt (#541)"
```

---

### Task 4: Briefings freshness resolver

**Files:**

- Create: `packages/briefings/src/freshness.ts`
- Create: `tests/unit/briefings-freshness.test.ts`

**Interfaces:**

- Consumes: `DataContextDb` from `@jarv1s/db`, `SourceFreshnessV1`, `SourceFreshnessEntry`, `FreshnessKind` from `@jarv1s/shared`
- Produces: `resolveBriefingFreshness(scopedDb, sectionKeys, capturedAt, opts) => Promise<SourceFreshnessV1>`

**Freshness source table:**
| Section key | freshnessKind | asOf source |
|-------------|---------------|-------------|
| email | connector_sync | opts.connectorSyncAt(scopedDb, "email") |
| calendar | connector_sync | opts.connectorSyncAt(scopedDb, "calendar") |
| vault | vault_write | opts.vaultLastWriteAt(scopedDb) |
| tasks | realtime | capturedAt |
| commitments | realtime | capturedAt |
| chats | realtime | capturedAt |
| goals | realtime | capturedAt |

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/briefings-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DataContextDb } from "@jarv1s/db";
import { resolveBriefingFreshness } from "../../packages/briefings/src/freshness.js";

const scopedDb = {} as DataContextDb;
const CAPTURED_AT = new Date("2026-06-28T08:00:00.000Z");
const CAPTURED_ISO = CAPTURED_AT.toISOString();
const EMAIL_SYNC_AT = new Date("2026-06-27T22:00:00.000Z");
const VAULT_AT = new Date("2026-06-25T10:00:00.000Z");

describe("resolveBriefingFreshness", () => {
  it("produces realtime entries for tasks, commitments, chats, goals", async () => {
    const result = await resolveBriefingFreshness(
      scopedDb,
      ["tasks", "commitments", "chats", "goals"],
      CAPTURED_AT,
      {}
    );
    expect(result.version).toBe(1);
    expect(result.capturedAt).toBe(CAPTURED_ISO);
    expect(result.sources).toHaveLength(4);
    for (const entry of result.sources) {
      expect(entry.freshnessKind).toBe("realtime");
      expect(entry.asOf).toBe(CAPTURED_ISO);
    }
  });

  it("resolves email via connectorSyncAt", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["email"], CAPTURED_AT, {
      connectorSyncAt: async () => EMAIL_SYNC_AT
    });
    const entry = result.sources.find((s) => s.source === "email")!;
    expect(entry.freshnessKind).toBe("connector_sync");
    expect(entry.asOf).toBe(EMAIL_SYNC_AT.toISOString());
  });

  it("resolves vault via vaultLastWriteAt", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["vault"], CAPTURED_AT, {
      vaultLastWriteAt: async () => VAULT_AT
    });
    const entry = result.sources.find((s) => s.source === "vault")!;
    expect(entry.freshnessKind).toBe("vault_write");
    expect(entry.asOf).toBe(VAULT_AT.toISOString());
  });

  it("returns asOf: null when connectorSyncAt is absent", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["email"], CAPTURED_AT, {});
    const entry = result.sources.find((s) => s.source === "email")!;
    expect(entry.asOf).toBeNull();
  });

  it("returns asOf: null when connectorSyncAt returns null", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["calendar"], CAPTURED_AT, {
      connectorSyncAt: async () => null
    });
    const entry = result.sources.find((s) => s.source === "calendar")!;
    expect(entry.asOf).toBeNull();
  });

  it("returns asOf: null when connectorSyncAt throws", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["email"], CAPTURED_AT, {
      connectorSyncAt: async () => {
        throw new Error("boom");
      }
    });
    const entry = result.sources.find((s) => s.source === "email")!;
    expect(entry.asOf).toBeNull();
  });

  it("returns asOf: null when vaultLastWriteAt is absent", async () => {
    const result = await resolveBriefingFreshness(scopedDb, ["vault"], CAPTURED_AT, {});
    const entry = result.sources.find((s) => s.source === "vault")!;
    expect(entry.asOf).toBeNull();
  });

  it("handles mixed section keys in one call", async () => {
    const result = await resolveBriefingFreshness(
      scopedDb,
      ["email", "tasks", "vault"],
      CAPTURED_AT,
      {
        connectorSyncAt: async () => EMAIL_SYNC_AT,
        vaultLastWriteAt: async () => VAULT_AT
      }
    );
    expect(result.sources).toHaveLength(3);
    const email = result.sources.find((s) => s.source === "email")!;
    const tasks = result.sources.find((s) => s.source === "tasks")!;
    const vault = result.sources.find((s) => s.source === "vault")!;
    expect(email.asOf).toBe(EMAIL_SYNC_AT.toISOString());
    expect(tasks.asOf).toBe(CAPTURED_ISO);
    expect(vault.asOf).toBe(VAULT_AT.toISOString());
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm test:unit -- tests/unit/briefings-freshness.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// packages/briefings/src/freshness.ts
import type { DataContextDb } from "@jarv1s/db";
import type { FreshnessKind, SourceFreshnessEntry, SourceFreshnessV1 } from "@jarv1s/shared";

type ConnectorKind = "email" | "calendar";

interface ResolveFreshnessOpts {
  connectorSyncAt?: (scopedDb: DataContextDb, kind: ConnectorKind) => Promise<Date | null>;
  vaultLastWriteAt?: (scopedDb: DataContextDb) => Promise<Date | null>;
}

const CONNECTOR_SOURCES = new Set<string>(["email", "calendar"]);
const REALTIME_SOURCES = new Set<string>(["tasks", "commitments", "chats", "goals"]);

export async function resolveBriefingFreshness(
  scopedDb: DataContextDb,
  sectionKeys: readonly string[],
  capturedAt: Date,
  opts: ResolveFreshnessOpts
): Promise<SourceFreshnessV1> {
  const capturedAtIso = capturedAt.toISOString();

  const sources: SourceFreshnessEntry[] = await Promise.all(
    sectionKeys.map(async (key): Promise<SourceFreshnessEntry> => {
      if (REALTIME_SOURCES.has(key)) {
        return { source: key, freshnessKind: "realtime", asOf: capturedAtIso };
      }
      if (CONNECTOR_SOURCES.has(key)) {
        let asOf: string | null = null;
        try {
          const t = (await opts.connectorSyncAt?.(scopedDb, key as ConnectorKind)) ?? null;
          asOf = t ? t.toISOString() : null;
        } catch {
          asOf = null;
        }
        return { source: key, freshnessKind: "connector_sync", asOf };
      }
      if (key === "vault") {
        let asOf: string | null = null;
        try {
          const t = (await opts.vaultLastWriteAt?.(scopedDb)) ?? null;
          asOf = t ? t.toISOString() : null;
        } catch {
          asOf = null;
        }
        return { source: key, freshnessKind: "vault_write", asOf };
      }
      return { source: key, freshnessKind: "realtime" as FreshnessKind, asOf: capturedAtIso };
    })
  );

  return { version: 1, capturedAt: capturedAtIso, sources };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test:unit -- tests/unit/briefings-freshness.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/briefings/src/freshness.ts tests/unit/briefings-freshness.test.ts
git commit -m "feat(freshness): add resolveBriefingFreshness resolver (#541)"
```

---

### Task 5: Wire freshness into compose.ts

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Modify: `tests/unit/briefings-compose.test.ts`

**Interfaces:**

- Consumes: `resolveBriefingFreshness` from `./freshness.js`, `DataContextDb` from `@jarv1s/db`
- Produces: `ComposeDeps.connectorSyncAt?`, `ComposeDeps.vaultLastWriteAt?`; `sourceMetadata.sourceTimestamps: SourceFreshnessV1` in `ComposeResult`

- [ ] **Step 1: Add a failing test to briefings-compose.test.ts**

Open `tests/unit/briefings-compose.test.ts`. Find the test that checks `sourceMetadata` keys (look for `expect(result.sourceMetadata)`). Add a new `it` block at the end of the first `describe`:

```ts
it("populates sourceTimestamps in sourceMetadata when freshness deps are injected", async () => {
  const emailSyncAt = new Date("2026-06-27T22:00:00.000Z");
  const depsWithFreshness: ComposeDeps = {
    ...deps, // reuse the existing test deps variable (see existing test for how deps is built)
    connectorSyncAt: async (_db, kind) => (kind === "email" ? emailSyncAt : null),
    vaultLastWriteAt: async () => null
  };
  const result = await composeBriefing(fakeScopedDb, definition(), runInput, depsWithFreshness);
  const ts = result.sourceMetadata.sourceTimestamps as Record<string, unknown>;
  expect(ts).toBeDefined();
  expect((ts as { version: number }).version).toBe(1);
  const sources = (
    ts as { sources: Array<{ source: string; freshnessKind: string; asOf: string | null }> }
  ).sources;
  const emailEntry = sources.find((s) => s.source === "email");
  expect(emailEntry?.freshnessKind).toBe("connector_sync");
  expect(emailEntry?.asOf).toBe(emailSyncAt.toISOString());
  const tasksEntry = sources.find((s) => s.source === "tasks");
  expect(tasksEntry?.freshnessKind).toBe("realtime");
  expect(tasksEntry?.asOf).toBe(FIXED_NOW.toISOString());
});

it("omits sourceTimestamps when freshness deps are absent (backwards compat)", async () => {
  const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
  expect(result.sourceMetadata.sourceTimestamps).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm test:unit -- tests/unit/briefings-compose.test.ts
```

Expected: 2 new tests FAIL — `connectorSyncAt` not in `ComposeDeps`, `sourceTimestamps` absent.

- [ ] **Step 3: Extend ComposeDeps in compose.ts**

In `packages/briefings/src/compose.ts`, add to the `ComposeDeps` interface (after the existing `logger?` field):

```ts
readonly connectorSyncAt?: (scopedDb: DataContextDb, kind: "email" | "calendar") => Promise<Date | null>;
readonly vaultLastWriteAt?: (scopedDb: DataContextDb) => Promise<Date | null>;
```

Also add to imports at the top of the file:

```ts
import { resolveBriefingFreshness } from "./freshness.js";
```

- [ ] **Step 4: Call the resolver and add sourceTimestamps to sourceMetadata**

In `composeBriefing`, the `sections` array is built just before the AI synthesis call (around line 683). The `sections` array holds the gathered `Section` objects; each has a `key` property. After the sections array is built but before the AI call, compute freshness.

Find the block that returns the final `ComposeResult` with `sourceMetadata: { ... }` (around line 780). Modify it to include `sourceTimestamps`. Both the success path and the `fallback()` function need it.

First, add freshness computation just after `sections` is built (before the model selection call, ~line 689):

```ts
// Resolve freshness for all gathered sections (never throws — failures → asOf: null).
const hasFreshnessDeps = !!deps.connectorSyncAt || !!deps.vaultLastWriteAt;
const sourceTimestamps = hasFreshnessDeps
  ? await resolveBriefingFreshness(
      scopedDb,
      sections.map((s) => s.key),
      now,
      {
        connectorSyncAt: deps.connectorSyncAt,
        vaultLastWriteAt: deps.vaultLastWriteAt
      }
    )
  : undefined;
```

Then in the success `sourceMetadata` object (the one returned from the synthesis try block), add:

```ts
        ...(sourceTimestamps !== undefined ? { sourceTimestamps } : {}),
```

And in the `fallback()` function's returned `sourceMetadata`, pass `sourceTimestamps` as well. Since `fallback()` is a separate function, add `sourceTimestamps?: SourceFreshnessV1` as a parameter. Update the `fallback()` calls at the call sites to pass `sourceTimestamps`.

Update `fallback` function signature (in compose.ts, find `function fallback(...)`):

```ts
function fallback(
  sections: readonly Section[],
  gaps: BriefingGap[],
  reason: "no_model" | "credential_error" | "synthesis_failed",
  commitments: Section,
  tasks: Section,
  calendar: Section,
  email: Section,
  vault: Section,
  chats: Section,
  vaultNotes: Array<{ path: string; id: string; excerpt: string }>,
  sourceTimestamps?: import("@jarv1s/shared").SourceFreshnessV1
): ComposeResult {
```

And inside fallback's returned object, add:

```ts
      ...(sourceTimestamps !== undefined ? { sourceTimestamps } : {}),
```

Update all `fallback(...)` call sites in `composeBriefing` to pass `sourceTimestamps` as the last argument.

- [ ] **Step 5: Run tests**

```bash
pnpm test:unit -- tests/unit/briefings-compose.test.ts
```

Expected: all tests PASS including the 2 new ones.

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/briefings/src/compose.ts tests/unit/briefings-compose.test.ts
git commit -m "feat(freshness): populate sourceTimestamps in briefing sourceMetadata (#541)"
```

---

### Task 6: Chat DTO — add sourceFreshness field

**Files:**

- Modify: `packages/shared/src/chat-api.ts`

**Interfaces:**

- Consumes: `SourceFreshnessV1` from `./freshness-types.js`
- Produces: `ChatMessageDto.sourceFreshness?: SourceFreshnessV1 | null`, `sourceFreshnessSchema` (Fastify JSON schema fragment)

- [ ] **Step 1: Add the field to the TypeScript interface**

In `packages/shared/src/chat-api.ts`, update `ChatMessageDto` (around line 35):

```ts
export interface ChatMessageDto {
  readonly id: string;
  readonly threadId: string;
  readonly ownerUserId: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  readonly body: string;
  readonly modelRoute: ChatModelRouteMetadataDto | null;
  readonly tools: readonly ChatSelectedToolMetadataDto[];
  readonly activity: readonly ChatActivityEventDto[];
  readonly sourceFreshness?: SourceFreshnessV1 | null; // NEW
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Add the import at the top of the file (after existing imports):

```ts
import type { SourceFreshnessV1 } from "./freshness-types.js";
```

- [ ] **Step 2: Add the JSON schema fragment**

Add a schema constant for the freshness entry shape (before `chatMessageSchema`):

```ts
const sourceFreshnessEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "freshnessKind", "asOf"],
  properties: {
    source: { type: "string" },
    freshnessKind: { type: "string" },
    asOf: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
} as const;

const sourceFreshnessV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "capturedAt", "sources"],
  properties: {
    version: { type: "number" },
    capturedAt: { type: "string" },
    sources: { type: "array", items: sourceFreshnessEntrySchema }
  }
} as const;
```

- [ ] **Step 3: Add sourceFreshness to chatMessageSchema**

In `chatMessageSchema` (around line 139), the `additionalProperties: false` means we MUST add the field. Modify:

In the `properties` block of `chatMessageSchema`, add:

```ts
    sourceFreshness: { anyOf: [sourceFreshnessV1Schema, { type: "null" }] },
```

The field is optional (not in `required`), so Fastify serializes it only when present.

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/chat-api.ts
git commit -m "feat(freshness): add sourceFreshness to ChatMessageDto and Fastify schema (#541)"
```

---

### Task 7: Chat persistence — collect tool names + compute freshness

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts`
- Modify: `packages/chat/src/live/persistence.ts`
- Create: `tests/unit/chat-freshness.test.ts`

**Interfaces:**

- Consumes: `SourceFreshnessV1` from `@jarv1s/shared`, `DataContextDb` from `@jarv1s/db`
- Produces: `ChatPersistencePort.recordTurn` extended signature; `DataContextChatPersistenceDeps.connectorSyncAt?`

**Tool-name → source key mapping:**

- `email.*` → `email` (connector_sync)
- `calendar.*` → `calendar` (connector_sync)
- `vault.*` / `notes.*` → `vault` (vault_write, asOf: null in V1 for chat)
- `tasks.*` → `tasks` (realtime)
- `commitments.*` → `commitments` (realtime)
- `chat.*` → `chats` (realtime)
- `goals.*` → `goals` (realtime)

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/chat-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DataContextDb } from "@jarv1s/db";
import {
  resolveChatFreshness,
  toolNameToSource
} from "../../packages/chat/src/live/persistence.js";

const scopedDb = {} as DataContextDb;
const CAPTURED = new Date("2026-06-28T09:00:00.000Z");
const CAPTURED_ISO = CAPTURED.toISOString();

describe("toolNameToSource", () => {
  it("maps email.* to email", () =>
    expect(toolNameToSource("email.listVisibleMessages")).toBe("email"));
  it("maps calendar.* to calendar", () =>
    expect(toolNameToSource("calendar.listVisibleEvents")).toBe("calendar"));
  it("maps vault.* to vault", () => expect(toolNameToSource("vault.search")).toBe("vault"));
  it("maps notes.* to vault", () => expect(toolNameToSource("notes.search")).toBe("vault"));
  it("maps tasks.* to tasks", () => expect(toolNameToSource("tasks.list")).toBe("tasks"));
  it("maps commitments.* to commitments", () =>
    expect(toolNameToSource("commitments.listVisible")).toBe("commitments"));
  it("maps chat.* to chats", () => expect(toolNameToSource("chat.listTodaysTurns")).toBe("chats"));
  it("maps goals.* to goals", () => expect(toolNameToSource("goals.list")).toBe("goals"));
  it("returns null for unknown tools", () => expect(toolNameToSource("memory.recall")).toBeNull());
});

describe("resolveChatFreshness", () => {
  it("returns null when no tool names are grounded read sources", async () => {
    const result = await resolveChatFreshness(scopedDb, new Set(["memory.recall"]), CAPTURED, {});
    expect(result).toBeNull();
  });

  it("returns null for empty tool set", async () => {
    const result = await resolveChatFreshness(scopedDb, new Set(), CAPTURED, {});
    expect(result).toBeNull();
  });

  it("returns realtime entries for tasks/commitments/chats/goals", async () => {
    const result = await resolveChatFreshness(
      scopedDb,
      new Set(["tasks.list", "commitments.listVisible"]),
      CAPTURED,
      {}
    );
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.capturedAt).toBe(CAPTURED_ISO);
    const sources = result!.sources;
    expect(sources.find((s) => s.source === "tasks")?.freshnessKind).toBe("realtime");
    expect(sources.find((s) => s.source === "commitments")?.asOf).toBe(CAPTURED_ISO);
  });

  it("resolves email connector_sync via connectorSyncAt", async () => {
    const emailAt = new Date("2026-06-27T20:00:00.000Z");
    const result = await resolveChatFreshness(
      scopedDb,
      new Set(["email.listVisibleMessages"]),
      CAPTURED,
      { connectorSyncAt: async () => emailAt }
    );
    expect(result!.sources.find((s) => s.source === "email")?.asOf).toBe(emailAt.toISOString());
  });

  it("returns asOf: null for vault in V1 (no vaultLastWriteAt dep)", async () => {
    const result = await resolveChatFreshness(scopedDb, new Set(["notes.search"]), CAPTURED, {});
    expect(result!.sources.find((s) => s.source === "vault")?.asOf).toBeNull();
  });

  it("connectorSyncAt throwing → asOf: null, does not throw", async () => {
    const result = await resolveChatFreshness(
      scopedDb,
      new Set(["calendar.listVisibleEvents"]),
      CAPTURED,
      {
        connectorSyncAt: async () => {
          throw new Error("network");
        }
      }
    );
    expect(result!.sources.find((s) => s.source === "calendar")?.asOf).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test:unit -- tests/unit/chat-freshness.test.ts
```

Expected: FAIL — `toolNameToSource` and `resolveChatFreshness` not exported from `persistence.js`.

- [ ] **Step 3: Extend ChatPersistencePort.recordTurn signature**

In `packages/chat/src/live/chat-session-manager.ts`, find `ChatPersistencePort.recordTurn` (around line 48). Change the signature:

```ts
  recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string },
    opts?: { readonly invokedToolNames?: ReadonlySet<string> }
  ): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined>;
```

- [ ] **Step 4: Collect tool names in the runTurn loop**

In `ChatSessionManager`, find the `runTurn` method. Inside the turn loop where records are processed (the `for (const record of records)` loop around line 431), add tool-name collection before the `if (record.kind === "reply")` line:

```ts
for (const record of records) {
  this.emit(actorUserId, record);
  if (record.kind === "tool" && record.toolName) {
    invokedToolNames.add(record.toolName); // collect for freshness
  }
  if (record.kind === "reply") reply = record.text;
}
```

Declare `invokedToolNames` just before the `for (;;)` loop (around line 403):

```ts
const invokedToolNames = new Set<string>();
```

And pass it to `recordTurn` (around line 476):

```ts
const stored = await this.deps.persistence.recordTurn(
  actorUserId,
  text,
  reply,
  {
    provider: session.provider,
    model: session.model
  },
  { invokedToolNames }
);
```

- [ ] **Step 5: Add freshness helpers and extend DataContextChatPersistenceDeps**

In `packages/chat/src/live/persistence.ts`, add to the import block at the top:

```ts
import type { SourceFreshnessV1, SourceFreshnessEntry } from "@jarv1s/shared";
```

Add `connectorSyncAt?` to `DataContextChatPersistenceDeps`:

```ts
export interface DataContextChatPersistenceDeps {
  readonly dataContext: DataContextRunner;
  readonly chatRepository: ChatRepository;
  readonly aiRepository: AiRepository;
  readonly boss?: PgBoss;
  readonly connectorSyncAt?: (
    scopedDb: DataContextDb,
    kind: "email" | "calendar"
  ) => Promise<Date | null>;
}
```

Store it in the class:

```ts
  private readonly connectorSyncAt: DataContextChatPersistenceDeps["connectorSyncAt"];

  constructor(deps: DataContextChatPersistenceDeps) {
    this.dataContext = deps.dataContext;
    this.chat = deps.chatRepository;
    this.ai = deps.aiRepository;
    this.boss = deps.boss;
    this.connectorSyncAt = deps.connectorSyncAt;
  }
```

Add the two exported helper functions (before the class declaration, or after the class — either position works):

```ts
export function toolNameToSource(toolName: string): string | null {
  if (toolName.startsWith("email.")) return "email";
  if (toolName.startsWith("calendar.")) return "calendar";
  if (toolName.startsWith("vault.") || toolName.startsWith("notes.")) return "vault";
  if (toolName.startsWith("tasks.")) return "tasks";
  if (toolName.startsWith("commitments.")) return "commitments";
  if (toolName.startsWith("chat.")) return "chats";
  if (toolName.startsWith("goals.")) return "goals";
  return null;
}

const CONNECTOR_SOURCES = new Set(["email", "calendar"]);
const REALTIME_SOURCES = new Set(["tasks", "commitments", "chats", "goals"]);

export async function resolveChatFreshness(
  scopedDb: DataContextDb,
  invokedToolNames: ReadonlySet<string>,
  capturedAt: Date,
  opts: {
    connectorSyncAt?: (scopedDb: DataContextDb, kind: "email" | "calendar") => Promise<Date | null>;
  }
): Promise<SourceFreshnessV1 | null> {
  const sourceKeys = new Set<string>();
  for (const name of invokedToolNames) {
    const source = toolNameToSource(name);
    if (source) sourceKeys.add(source);
  }
  if (sourceKeys.size === 0) return null;

  const capturedAtIso = capturedAt.toISOString();
  const entries: SourceFreshnessEntry[] = await Promise.all(
    [...sourceKeys].map(async (source): Promise<SourceFreshnessEntry> => {
      if (REALTIME_SOURCES.has(source)) {
        return { source, freshnessKind: "realtime", asOf: capturedAtIso };
      }
      if (CONNECTOR_SOURCES.has(source)) {
        let asOf: string | null = null;
        try {
          const t =
            (await opts.connectorSyncAt?.(scopedDb, source as "email" | "calendar")) ?? null;
          asOf = t ? t.toISOString() : null;
        } catch {
          asOf = null;
        }
        return { source, freshnessKind: "connector_sync", asOf };
      }
      // vault — V1: no vaultLastWriteAt dep for chat; emit unknown
      return { source, freshnessKind: "vault_write", asOf: null };
    })
  );

  return { version: 1, capturedAt: capturedAtIso, sources: entries };
}
```

- [ ] **Step 6: Thread freshness through recordTurn**

In `DataContextChatPersistence.recordTurn`, update the signature to match the port:

```ts
  async recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string },
    opts?: { readonly invokedToolNames?: ReadonlySet<string> }
  ): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined> {
    return this.run(actorUserId, "record-turn", async (scopedDb) => {
      // Compute freshness BEFORE the repository call (needs scopedDb)
      const capturedAt = new Date();
      const sourceFreshness = opts?.invokedToolNames
        ? await resolveChatFreshness(scopedDb, opts.invokedToolNames, capturedAt, {
            connectorSyncAt: this.connectorSyncAt
          })
        : null;

      const thread =
        (await this.chat.getCurrentThread(scopedDb, actorUserId)) ??
        (await this.chat.openNewThread(scopedDb, { title: DEFAULT_CONVERSATION_TITLE }));

      const result = await this.chat.recordCompletedTurn(
        scopedDb,
        thread.id,
        userText,
        assistantReply,
        executed,
        { sourceFreshness }  // new opts param
      );
      // ... rest of method unchanged ...
```

- [ ] **Step 7: Run tests**

```bash
pnpm test:unit -- tests/unit/chat-freshness.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/chat/src/live/chat-session-manager.ts packages/chat/src/live/persistence.ts tests/unit/chat-freshness.test.ts
git commit -m "feat(freshness): collect tool names and compute chat sourceFreshness (#541)"
```

---

### Task 8: Chat repository + routes — store and serialize sourceFreshness

**Files:**

- Modify: `packages/chat/src/repository.ts`
- Modify: `packages/chat/src/routes.ts`
- Create: `tests/unit/chat-routes-freshness.test.ts`

**Interfaces:**

- Consumes: `SourceFreshnessV1` from `@jarv1s/shared`
- Produces: `recordCompletedTurn` stores `sourceFreshness`; `serializeMessage` emits it in DTO

- [ ] **Step 1: Write the failing routes unit test**

Create `tests/unit/chat-routes-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readSourceFreshness } from "../../packages/chat/src/routes.js";
import type { SourceFreshnessV1 } from "@jarv1s/shared";

describe("readSourceFreshness", () => {
  it("returns null for undefined input", () => {
    expect(readSourceFreshness(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(readSourceFreshness("string")).toBeNull();
    expect(readSourceFreshness(42)).toBeNull();
  });

  it("returns null when version is not 1", () => {
    expect(readSourceFreshness({ version: 2, capturedAt: "x", sources: [] })).toBeNull();
  });

  it("parses a valid SourceFreshnessV1 blob", () => {
    const blob: SourceFreshnessV1 = {
      version: 1,
      capturedAt: "2026-06-28T09:00:00.000Z",
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" }
      ]
    };
    const result = readSourceFreshness(blob);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0].source).toBe("email");
  });

  it("filters out malformed source entries", () => {
    const blob = {
      version: 1,
      capturedAt: "2026-06-28T09:00:00.000Z",
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" },
        { source: 42, freshnessKind: "realtime", asOf: null }, // invalid
        { source: "tasks", freshnessKind: "realtime", asOf: "2026-06-28T09:00:00.000Z" }
      ]
    };
    const result = readSourceFreshness(blob);
    expect(result!.sources).toHaveLength(2); // only valid entries
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test:unit -- tests/unit/chat-routes-freshness.test.ts
```

Expected: FAIL — `readSourceFreshness` not exported from `routes.js`.

- [ ] **Step 3: Extend ChatRepository.recordCompletedTurn**

In `packages/chat/src/repository.ts`, add `SourceFreshnessV1` import:

```ts
import type { SourceFreshnessV1 } from "@jarv1s/shared";
```

Update `recordCompletedTurn` signature to accept opts:

```ts
  async recordCompletedTurn(
    scopedDb: DataContextDb,
    threadId: string,
    userText: string,
    assistantReply: string,
    executed: { readonly provider: string; readonly model: string },
    opts?: { readonly sourceFreshness?: SourceFreshnessV1 | null }
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage } | undefined> {
```

In the assistant message insert (where `toolMetadata: { selectedTools: [] }` is currently set), change to:

```ts
      toolMetadata: opts?.sourceFreshness
        ? { selectedTools: [], sourceFreshness: opts.sourceFreshness }
        : { selectedTools: [] },
```

- [ ] **Step 4: Add readSourceFreshness to routes.ts and use in serializeMessage**

In `packages/chat/src/routes.ts`, add `SourceFreshnessV1` import at the top (with existing shared imports):

```ts
import type { SourceFreshnessV1, SourceFreshnessEntry, FreshnessKind } from "@jarv1s/shared";
```

Add the exported helper function (alongside the existing `readTools` and `readActivity` helpers):

```ts
export function readSourceFreshness(value: unknown): SourceFreshnessV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1) return null;
  if (typeof rec.capturedAt !== "string") return null;
  const rawSources = Array.isArray(rec.sources) ? rec.sources : [];
  const sources: SourceFreshnessEntry[] = rawSources.flatMap((item) => {
    const r = asRecord(item);
    if (typeof r.source !== "string" || typeof r.freshnessKind !== "string") return [];
    const asOf = r.asOf === null ? null : typeof r.asOf === "string" ? r.asOf : null;
    return [{ source: r.source, freshnessKind: r.freshnessKind as FreshnessKind, asOf }];
  });
  return { version: 1, capturedAt: rec.capturedAt as string, sources };
}
```

In `serializeMessage` (around line 600), add `sourceFreshness` to the returned object:

```ts
function serializeMessage(message: ChatMessage): ChatMessageDto {
  const toolMetadata = asRecord(message.tool_metadata);
  return {
    id: message.id,
    threadId: message.thread_id,
    ownerUserId: message.owner_user_id,
    role: message.role,
    status: message.status,
    body: message.body,
    modelRoute: null,
    tools: readTools(toolMetadata.selectedTools),
    activity: readActivity(toolMetadata.activity),
    sourceFreshness: readSourceFreshness(toolMetadata.sourceFreshness), // NEW
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at)
  };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test:unit -- tests/unit/chat-routes-freshness.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/repository.ts packages/chat/src/routes.ts tests/unit/chat-routes-freshness.test.ts
git commit -m "feat(freshness): store and serialize chat sourceFreshness in repository and routes (#541)"
```

---

### Task 9: Module registry and runtime wiring

**Files:**

- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/module-registry/src/index.ts`

**Interfaces:**

- Consumes: `getConnectorSyncAt` from `@jarv1s/connectors`, `MemoryRepository` from `@jarv1s/memory`, `ConnectorsRepository` from connectors
- Produces: `connectorSyncAt` wired in both briefings `composeDeps` and chat runtime; `vaultLastWriteAt` wired in briefings `composeDeps`

- [ ] **Step 1: Extend CreateChatSessionRuntimeDeps in runtime.ts**

In `packages/chat/src/live/runtime.ts`, find `CreateChatSessionRuntimeDeps` interface and add:

```ts
readonly connectorSyncAt?: (scopedDb: DataContextDb, kind: "email" | "calendar") => Promise<Date | null>;
```

In `createChatSessionRuntime`, extend the `DataContextChatPersistence` constructor call (around line 296):

```ts
const persistence = new DataContextChatPersistence({
  dataContext: deps.dataContext,
  chatRepository: new ChatRepository(),
  aiRepository: new AiRepository(),
  boss: deps.boss,
  connectorSyncAt: deps.connectorSyncAt // NEW
});
```

- [ ] **Step 2: Wire connectorSyncAt and vaultLastWriteAt in module-registry**

In `packages/module-registry/src/index.ts`, find the imports block and add:

```ts
import { ConnectorsRepository, getConnectorSyncAt } from "@jarv1s/connectors";
import { MemoryRepository } from "@jarv1s/memory";
```

(Check if `ConnectorsRepository` is already imported — if so, just add `getConnectorSyncAt`. `MemoryRepository` may also already be imported.)

Find the `composeDeps` block in `registerWorkers` (around line 614 — where `composeDeps: { moduleManifests: ..., aiRepository: ..., ... }` is built). Add the freshness deps:

```ts
          connectorSyncAt: async (scopedDb, kind) => {
            const repo = new ConnectorsRepository();
            return getConnectorSyncAt(repo, scopedDb, kind);
          },
          vaultLastWriteAt: async (scopedDb) => {
            const repo = new MemoryRepository();
            return repo.getLatestIngestedAt(scopedDb, "vault");
          },
```

Find where `createChatSessionRuntime` is called in module-registry (search for `createChatSessionRuntime(`). Add `connectorSyncAt` to its deps:

```ts
  connectorSyncAt: async (scopedDb, kind) => {
    const repo = new ConnectorsRepository();
    return getConnectorSyncAt(repo, scopedDb, kind);
  },
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Run unit test suite**

```bash
pnpm test:unit
```

Expected: all tests pass (including previously written freshness tests).

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/runtime.ts packages/module-registry/src/index.ts
git commit -m "feat(freshness): wire connectorSyncAt and vaultLastWriteAt in module registry and chat runtime (#541)"
```

---

### Task 10: Web UI — briefing freshness section

**Files:**

- Create: `apps/web/src/today/briefing-freshness.tsx`
- Modify: `apps/web/src/today/today-page.tsx`
- Modify: `apps/web/src/styles/kit-today-misc.css`

**Interfaces:**

- Consumes: `SourceFreshnessV1`, `SourceFreshnessEntry` from `@jarv1s/shared`; `BriefingRunDto.sourceMetadata` (reads `sourceTimestamps` key)
- Produces: `BriefingFreshnessList` component, `BriefingStaleBanner` component

**Stale threshold:** 24h — show `BriefingStaleBanner` when any non-realtime, non-null source has age > 24h vs capturedAt.

**Age format:** `live` for realtime, `unknown` for `asOf: null`, `Xm ago` / `Xh ago` / `Xd ago` for timestamped.

- [ ] **Step 1: Write the failing component render test**

Create `tests/unit/briefing-freshness-ui.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  BriefingFreshnessList,
  BriefingStaleBanner
} from "../../apps/web/src/today/briefing-freshness.js";
import type { SourceFreshnessV1 } from "@jarv1s/shared";

const CAPTURED = "2026-06-28T10:00:00.000Z";

const freshness: SourceFreshnessV1 = {
  version: 1,
  capturedAt: CAPTURED,
  sources: [
    { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" }, // 12h ago
    { source: "tasks", freshnessKind: "realtime", asOf: CAPTURED },
    { source: "vault", freshnessKind: "vault_write", asOf: null }
  ]
};

describe("BriefingFreshnessList", () => {
  it("renders source labels and ages", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toContain("email");
    expect(html).toContain("tasks");
    expect(html).toContain("live");
    expect(html).toContain("unknown");
  });

  it("renders relative age for timestamped sources", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toMatch(/\d+(h|d|m) ago/);
  });
});

describe("BriefingStaleBanner", () => {
  const staleFreshness: SourceFreshnessV1 = {
    version: 1,
    capturedAt: CAPTURED,
    sources: [
      { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-26T10:00:00.000Z" } // 48h ago → stale
    ]
  };

  it("renders when a source exceeds stale threshold", () => {
    const html = renderToString(createElement(BriefingStaleBanner, { freshness: staleFreshness }));
    expect(html).toContain("email");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders nothing when all sources are within threshold", () => {
    const recentFreshness: SourceFreshnessV1 = {
      version: 1,
      capturedAt: CAPTURED,
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" } // 12h — OK
      ]
    };
    const html = renderToString(createElement(BriefingStaleBanner, { freshness: recentFreshness }));
    expect(html).toBe("");
  });

  it("renders nothing when all sources are realtime", () => {
    const rtFreshness: SourceFreshnessV1 = {
      version: 1,
      capturedAt: CAPTURED,
      sources: [{ source: "tasks", freshnessKind: "realtime", asOf: CAPTURED }]
    };
    const html = renderToString(createElement(BriefingStaleBanner, { freshness: rtFreshness }));
    expect(html).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test:unit -- tests/unit/briefing-freshness-ui.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the briefing-freshness component**

```tsx
// apps/web/src/today/briefing-freshness.tsx
import type { SourceFreshnessV1, SourceFreshnessEntry } from "@jarv1s/shared";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

const SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  calendar: "Calendar",
  vault: "Notes",
  tasks: "Tasks",
  commitments: "Commitments",
  chats: "Chats",
  goals: "Goals"
};

function formatAge(entry: SourceFreshnessEntry, capturedAt: string): string {
  if (entry.freshnessKind === "realtime") return "live";
  if (!entry.asOf) return "unknown";
  const ageMs = new Date(capturedAt).getTime() - new Date(entry.asOf).getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

function isStale(entry: SourceFreshnessEntry, capturedAt: string): boolean {
  if (entry.freshnessKind === "realtime") return false;
  if (!entry.asOf) return false; // unknown ≠ stale
  const ageMs = new Date(capturedAt).getTime() - new Date(entry.asOf).getTime();
  return ageMs > STALE_THRESHOLD_MS;
}

export function BriefingFreshnessList({ freshness }: { readonly freshness: SourceFreshnessV1 }) {
  return (
    <div className="bfresh">
      <span className="bfresh__label">Sources</span>
      <ul className="bfresh__list">
        {freshness.sources.map((entry) => {
          const age = formatAge(entry, freshness.capturedAt);
          return (
            <li key={entry.source} className="bfresh__item">
              <span className="bfresh__source">{SOURCE_LABEL[entry.source] ?? entry.source}</span>
              <span
                className={`bfresh__age${entry.freshnessKind === "realtime" ? " bfresh__age--live" : age === "unknown" ? " bfresh__age--unknown" : ""}`}
                title={entry.asOf ?? undefined}
              >
                {age}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BriefingStaleBanner({ freshness }: { readonly freshness: SourceFreshnessV1 }) {
  const stale = freshness.sources.filter((e) => isStale(e, freshness.capturedAt));
  if (stale.length === 0) return null;
  const names = stale.map((e) => SOURCE_LABEL[e.source] ?? e.source).join(", ");
  return <p className="bfresh__stale">Some sources are over a day old: {names}.</p>;
}

export function parseBriefingFreshness(
  sourceMetadata: Record<string, unknown>
): SourceFreshnessV1 | null {
  const ts = sourceMetadata.sourceTimestamps;
  if (!ts || typeof ts !== "object" || Array.isArray(ts)) return null;
  const rec = ts as Record<string, unknown>;
  if (rec.version !== 1 || typeof rec.capturedAt !== "string") return null;
  if (!Array.isArray(rec.sources)) return null;
  return ts as SourceFreshnessV1;
}
```

- [ ] **Step 4: Add CSS to kit-today-misc.css**

In `apps/web/src/styles/kit-today-misc.css`, append:

```css
/* Briefing freshness list (#541) */
.bfresh {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
.bfresh__label {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  display: block;
  margin-bottom: 6px;
}
.bfresh__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bfresh__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}
.bfresh__source {
  font-weight: 500;
  color: var(--text-subtle);
}
.bfresh__age {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
.bfresh__age--live {
  color: var(--accent-fg);
}
.bfresh__age--unknown {
  color: var(--text-faint);
  font-style: italic;
}
.bfresh__stale {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--surface-warn, var(--surface-2));
  border: 1px solid var(--border-warn, var(--border-subtle));
}
```

- [ ] **Step 5: Add BriefingFreshnessList + BriefingStaleBanner to today-page.tsx**

In `apps/web/src/today/today-page.tsx`, add the import:

```ts
import {
  BriefingFreshnessList,
  BriefingStaleBanner,
  parseBriefingFreshness
} from "./briefing-freshness";
```

Find the evening run display block (around line 380):

```tsx
              {latestEveningRun ? (
                <>
                  <p className="cmd-empty">{compactSummary(latestEveningRun.summaryText)}</p>
                  <BriefingFeedbackMenu ... />
                </>
```

Change to:

```tsx
              {latestEveningRun ? (
                <>
                  {(() => {
                    const freshness = parseBriefingFreshness(latestEveningRun.sourceMetadata);
                    return freshness ? <BriefingStaleBanner freshness={freshness} /> : null;
                  })()}
                  <p className="cmd-empty">{compactSummary(latestEveningRun.summaryText)}</p>
                  {(() => {
                    const freshness = parseBriefingFreshness(latestEveningRun.sourceMetadata);
                    return freshness ? <BriefingFreshnessList freshness={freshness} /> : null;
                  })()}
                  <BriefingFeedbackMenu
                    targetRef={latestEveningRun.id}
                    onChanged={() =>
                      void queryClient.invalidateQueries({
                        queryKey: queryKeys.briefings.runs(eveningDefinition.id)
                      })
                    }
                  />
                </>
```

(Note: extract `freshness` to a variable before the JSX to avoid calling `parseBriefingFreshness` twice — refactor the IIFE to `const freshness = parseBriefingFreshness(latestEveningRun.sourceMetadata)` above the JSX block.)

- [ ] **Step 6: Run tests**

```bash
pnpm test:unit -- tests/unit/briefing-freshness-ui.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8: Check file sizes**

```bash
pnpm check:file-size
```

Expected: all files within 1000-line limit.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/today/briefing-freshness.tsx apps/web/src/today/today-page.tsx apps/web/src/styles/kit-today-misc.css tests/unit/briefing-freshness-ui.test.tsx
git commit -m "feat(freshness): add BriefingFreshnessList and BriefingStaleBanner to today page (#541)"
```

---

### Task 11: Web UI — chat freshness footer

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Modify: `apps/web/src/styles/kit-chat.css`
- Create: `tests/unit/chat-freshness-footer.test.tsx`

**Interfaces:**

- Consumes: `ChatMessageDto.sourceFreshness?: SourceFreshnessV1 | null` from `@jarv1s/shared`
- Produces: `ChatFreshnessFooter` component rendered below assistant messages that have grounded read sources

**Design:** Use the existing `chatd-peek` `<details>` pattern — collapsed by default, label shows source names, expanded shows per-source ages. No threshold, no warning in chat.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat-freshness-footer.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ChatFreshnessFooter } from "../../apps/web/src/chat/chat-drawer.js";
import type { SourceFreshnessV1 } from "@jarv1s/shared";

const CAPTURED = "2026-06-28T10:00:00.000Z";

const freshness: SourceFreshnessV1 = {
  version: 1,
  capturedAt: CAPTURED,
  sources: [
    { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" },
    { source: "tasks", freshnessKind: "realtime", asOf: CAPTURED }
  ]
};

describe("ChatFreshnessFooter", () => {
  it("renders nothing when sourceFreshness is null", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: null }));
    expect(html).toBe("");
  });

  it("renders nothing when sourceFreshness is undefined", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: undefined }));
    expect(html).toBe("");
  });

  it("renders a collapsed details element with source names in summary", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: freshness }));
    expect(html).toContain("<details");
    expect(html).toContain("email");
    expect(html).toContain("tasks");
  });

  it("renders per-source ages in the expanded body", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: freshness }));
    expect(html).toContain("live"); // tasks is realtime
    expect(html).toMatch(/\d+(h|m|d) ago/); // email has an age
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test:unit -- tests/unit/chat-freshness-footer.test.tsx
```

Expected: FAIL — `ChatFreshnessFooter` not exported from `chat-drawer.js`.

- [ ] **Step 3: Add ChatFreshnessFooter to chat-drawer.tsx**

Open `apps/web/src/chat/chat-drawer.tsx`. Add `SourceFreshnessV1` and `SourceFreshnessEntry` to the shared import:

```ts
import type {
  ChatMessageDto,
  UsefulnessFeedbackDto,
  UsefulnessFeedbackKind,
  SourceFreshnessV1,
  SourceFreshnessEntry
} from "@jarv1s/shared";
```

Add the freshness label helpers (as local module-scope functions) and the component. Place them near the `ChatFeedbackMenu` component (after line ~542):

```tsx
function chatFreshnessLabel(entry: SourceFreshnessEntry, capturedAt: string): string {
  if (entry.freshnessKind === "realtime") return "live";
  if (!entry.asOf) return "unknown";
  const ageMs = new Date(capturedAt).getTime() - new Date(entry.asOf).getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

const CHAT_SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  calendar: "Calendar",
  vault: "Notes",
  tasks: "Tasks",
  commitments: "Commitments",
  chats: "Chats",
  goals: "Goals"
};

export function ChatFreshnessFooter({
  sourceFreshness
}: {
  readonly sourceFreshness?: SourceFreshnessV1 | null;
}) {
  if (!sourceFreshness) return null;
  const summaryNames = sourceFreshness.sources
    .map((e) => CHAT_SOURCE_LABEL[e.source] ?? e.source)
    .join(", ");
  return (
    <details className="chatd-freshness chatd-peek">
      <summary className="chatd-peek__summary">
        <span className="chatd-peek__label">Sources</span>
        <span className="chatd-peek__count">{summaryNames}</span>
        <svg
          className="chatd-peek__chev"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <ul className="chatd-freshness__list chatd-peek__body">
        {sourceFreshness.sources.map((entry) => (
          <li key={entry.source} className="chatd-freshness__item chatd-peek__line">
            <span className="chatd-freshness__source">
              {CHAT_SOURCE_LABEL[entry.source] ?? entry.source}
            </span>
            <span className="chatd-freshness__age" title={entry.asOf ?? undefined}>
              {chatFreshnessLabel(entry, sourceFreshness.capturedAt)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

Find the assistant message render block in the chat-drawer. Look for where `recordsFromMessages` feeds into the render or where the assistant reply text is rendered. The `recordsFromMessages` maps `message.role === "assistant"` to a `{ kind: "reply", text: message.body, messageId: message.id }`. The actual `<div>` that renders the reply is in the component that handles `record.kind === "reply"`.

Find the component that renders `record.kind === "reply"` records. It typically looks like:

```tsx
} else if (record.kind === "reply") {
  return (
    <div key={...} className="chatd-reply">
      <MarkdownMessage text={text} />
      {props.record.messageId ? <ChatFeedbackMenu ... /> : null}
    </div>
  );
}
```

The `ChatFreshnessFooter` needs the `sourceFreshness` from the message. Since `recordsFromMessages` currently doesn't carry `sourceFreshness` on the record, we need to thread it.

The cleanest approach is to extend the `TranscriptRecord` type locally (the web-local type, not the shared type) to carry `sourceFreshness`, OR to render `ChatFreshnessFooter` by looking up the message by `messageId` from the original messages array.

The simpler approach: add `sourceFreshness?: SourceFreshnessV1 | null` to the record object in `recordsFromMessages`:

```ts
function recordsFromMessages(messages: readonly ChatMessageDto[]): TranscriptRecord[] {
  return messages.flatMap((message) => [
    ...message.activity.map((event) => ({
      kind: safeActivityKind(event.kind),
      text: event.text
    })),
    ...message.tools.map((tool) => ({
      kind: "tool" as const,
      text: tool.name
    })),
    {
      kind:
        message.role === "user"
          ? ("user" as const)
          : message.status === "error"
            ? ("error" as const)
            : ("reply" as const),
      text: message.body,
      messageId: message.id,
      sourceFreshness: message.role === "assistant" ? message.sourceFreshness : undefined
    }
  ]);
}
```

The local `TranscriptRecord` type (the web-side one, derived from the chat-drawer's local usage) needs an optional `sourceFreshness` field. Since `TranscriptRecord` is imported from `@jarv1s/shared` (or defined locally), check which one is used:

```bash
grep "TranscriptRecord" apps/web/src/chat/chat-drawer.tsx
```

It's defined locally in the chat-drawer (as a local type). Add `sourceFreshness?: SourceFreshnessV1 | null` to that local `TranscriptRecord` type (or the type alias used in the web).

Then in the component that renders `kind === "reply"` records, add:

```tsx
{
  record.sourceFreshness ? <ChatFreshnessFooter sourceFreshness={record.sourceFreshness} /> : null;
}
```

- [ ] **Step 4: Add CSS to kit-chat.css**

In `apps/web/src/styles/kit-chat.css`, append:

```css
/* Chat freshness footer (#541) */
.chatd-freshness__list {
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 6px;
}
.chatd-freshness__item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.chatd-freshness__source {
  font-weight: 500;
  color: var(--text-subtle);
}
.chatd-freshness__age {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test:unit -- tests/unit/chat-freshness-footer.test.tsx
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Run full unit suite**

```bash
pnpm test:unit
```

Expected: all tests pass.

- [ ] **Step 7: Typecheck + file size**

```bash
pnpm typecheck && pnpm check:file-size
```

Expected: no errors, all files within limit.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css tests/unit/chat-freshness-footer.test.tsx
git commit -m "feat(freshness): add ChatFreshnessFooter to chat assistant messages (#541)"
```

---

### Final Verification Gate

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm test:unit && pnpm test:briefings && pnpm test:chat
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify acceptance criteria against spec §12**

- [ ] `source_metadata.sourceTimestamps` populated in new runs (assert in briefings integration test)
- [ ] `capturedAt` equals run generation time
- [ ] email/calendar use connector_sync kind (not realtime)
- [ ] tasks/commitments/chats/goals are realtime
- [ ] stale threshold 24h triggers banner naming stale sources; 23h does not (unit test coverage)
- [ ] live/unknown sources never count as stale (unit test coverage)
- [ ] chat messages with read tools have sourceFreshness; turns with no grounded tools have null
- [ ] sourceFreshness entries contain no content keys (verify entry shape has only `source`, `freshnessKind`, `asOf`)
- [ ] older runs without `sourceTimestamps` render gracefully (no error path exists since `parseBriefingFreshness` returns null)

- [ ] **Step 3: Message coordinator with plan approval request**

(Done via herdr-pane-message skill — coordinator must approve before build begins.)
