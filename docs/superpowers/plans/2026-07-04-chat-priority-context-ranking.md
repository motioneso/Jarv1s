# Chat Priority Context Ranking (#721) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> (In this repo the execution skills are disabled by design — the coordinated-build agent drives tasks itself, one at a time, TDD per task.)

**Goal:** Wire the user's `priority.model.v1` into live chat so cross-tool context evidence (tasks/calendar/email/notes) is reordered by the user's priority settings before it reaches the model prompt and answer provenance, and fix muted-source UI copy for sources with no active consumer.

**Architecture:** Mirror the briefings consumer pattern: chat's `priority-consumer.ts` gains `readPriorityModel` (same shape as `packages/briefings/src/priority-consumer.ts:76-84`), a new `ChatPriorityModelAdapter` reads the model inside a data context (same DI shape as `PassiveContextRetriever`), and `ChatSessionManager.engineText()` reorders `crossToolResult.items` via the existing `rankChatContext` scorer and re-renders the prompt block via the existing `renderCrossToolContextBlock` (the block is derived purely from items, so re-rendering is loss-free). The dep is threaded optionally through `runtime.ts` → `routes.ts` → `module-registry`, defaulting off everywhere except the composition root.

**Tech Stack:** TypeScript, vitest (unit tests live in top-level `tests/unit/`, NOT colocated), `@jarv1s/priority` scorer (pure, unchanged), `@jarv1s/structured-state` `PreferencesRepository` at the composition root.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-chat-priority-context-ranking.md`, tier `sensitive`.
- **No new source reads** — rank only already-loaded candidates. `@jarv1s/priority` stays pure (no scorer changes; muting is already generic at `packages/priority/src/scoring.ts:184-186`).
- **No second ranking system** — reuse `rankChatContext` / `rankPriorityCandidates` only.
- Do not persist priority candidate snapshots, source bodies, raw tool payloads, secrets, or connector metadata. Never log source bodies.
- Do not touch `packages/email` or shared Email behavior.
- `chat-session-manager.ts` has NO logger anywhere (verified) — priority-reorder failures are silently swallowed via try/catch to match the file's convention (deliberate deviation from briefings' logged `*_priority_failed` event).
- `AccessContext` is `{ actorUserId, requestId }` only. Repositories accept `DataContextDb` only.
- Stage exact files per commit — never `git add -A`. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, plus `git fetch origin main && git rebase origin/main`. Rebase after PR #729 lands (soft overlap in `packages/chat/src/routes.ts`) before wrap-up/QA.
- Unit test command: `pnpm vitest run tests/unit/<file> --root .` (or `pnpm test:unit` for the full unit suite).

---

### Task 1: `readPriorityModel` in chat's priority consumer

**Files:**

- Modify: `packages/chat/src/priority-consumer.ts` (55 lines today)
- Test: `tests/unit/chat-priority-consumer.test.ts` (append to existing file, 2 tests today)

**Interfaces:**

- Consumes: `PriorityPreferencesRepository` from `@jarv1s/priority` (`.get(raw): PriorityModelPreferenceV1` normalizes/validates, `.defaults()` — pure, no DB), `DataContextDb` from `@jarv1s/db`.
- Produces: `readPriorityModel(scopedDb: DataContextDb, preferencesRepository?: PriorityPreferenceReader): Promise<PriorityModelPreferenceV1>` and `export interface PriorityPreferenceReader { get(scopedDb: DataContextDb, key: string): Promise<unknown> }` — Task 3's adapter calls both.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/chat-priority-consumer.test.ts` (existing imports stay; add `readPriorityModel` to the `@jarv1s/chat/priority-consumer` import and add `import type { DataContextDb } from "@jarv1s/db";` plus `vi` to the vitest import):

```ts
describe("readPriorityModel", () => {
  const scopedDb = {} as unknown as DataContextDb;

  it("returns defaults when no preferences repository is provided", async () => {
    const model = await readPriorityModel(scopedDb);
    expect(model).toMatchObject({
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: []
    });
  });

  it("reads priority.model.v1 through the injected reader and normalizes it", async () => {
    const stored = {
      version: 1,
      mode: "deadline_first",
      anchors: [],
      mutedSources: ["email"],
      updatedAt: "2026-07-01T00:00:00Z"
    };
    const reader = { get: vi.fn().mockResolvedValue(stored) };
    const model = await readPriorityModel(scopedDb, reader);
    expect(reader.get).toHaveBeenCalledWith(scopedDb, "priority.model.v1");
    expect(model.mode).toBe("deadline_first");
    expect(model.mutedSources).toEqual(["email"]);
  });

  it("falls back to defaults when the stored value is invalid", async () => {
    const reader = { get: vi.fn().mockResolvedValue({ garbage: true }) };
    const model = await readPriorityModel(scopedDb, reader);
    expect(model.mode).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/chat-priority-consumer.test.ts`
Expected: FAIL — `readPriorityModel` is not exported.

- [ ] **Step 3: Implement `readPriorityModel`**

In `packages/chat/src/priority-consumer.ts`, mirror `packages/briefings/src/priority-consumer.ts` exactly. Change the imports at the top:

```ts
import { PriorityPreferencesRepository, rankPriorityCandidates } from "@jarv1s/priority";
import type {
  PriorityCandidate,
  PriorityModelPreferenceV1,
  PriorityResult
} from "@jarv1s/priority";
import type { DataContextDb } from "@jarv1s/db";
```

Add after the imports (before `CrossToolCandidate`):

```ts
const PRIORITY_MODEL_KEY = "priority.model.v1";
const priorityPreferences = new PriorityPreferencesRepository();

export interface PriorityPreferenceReader {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
}

export async function readPriorityModel(
  scopedDb: DataContextDb,
  preferencesRepository?: PriorityPreferenceReader
): Promise<PriorityModelPreferenceV1> {
  if (!preferencesRepository) {
    return priorityPreferences.defaults();
  }
  return priorityPreferences.get(await preferencesRepository.get(scopedDb, PRIORITY_MODEL_KEY));
}
```

(`PriorityPreferenceReader` is deliberately redeclared locally rather than importing `PreferencesPort` — same isolation choice briefings made.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/chat-priority-consumer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/priority-consumer.ts tests/unit/chat-priority-consumer.test.ts
git commit -m "feat(chat): add readPriorityModel to chat priority consumer (#721)"
```

---

### Task 2: `reorderByPriority` helper (mixed-source reorder)

**Files:**

- Modify: `packages/chat/src/priority-consumer.ts`
- Test: `tests/unit/chat-priority-consumer.test.ts` (append)

**Interfaces:**

- Consumes: `PriorityResult` (`{ source, title, score, band, reasons }` from `@jarv1s/priority`, already ranked best-first by `rankChatContext`).
- Produces: `reorderByPriority<T extends { readonly source: string; readonly title: string }>(items: readonly T[], ranked: readonly PriorityResult[]): T[]` — Task 4 calls it with `CrossToolEvidenceItem[]`.

Why a new helper: briefings' `orderByPriority` (`packages/briefings/src/compose.ts:40-58`) is parameterized on a SINGLE `source` and keys by title only. Chat's `crossToolResult.items` is one MIXED-source array, so this helper keys by composite `${source}::${title}`. Same spirit, adapted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/chat-priority-consumer.test.ts` (add `reorderByPriority` to the import):

```ts
describe("reorderByPriority", () => {
  const items = [
    { source: "calendar", title: "Standup", summary: "Standup" },
    { source: "tasks", title: "Fix bug", summary: "Fix bug" },
    { source: "notes", title: "Ideas", summary: "Ideas" }
  ];

  it("reorders mixed-source items to match the ranked results", () => {
    const ranked = [
      { source: "tasks", title: "Fix bug", score: 90, band: "high", reasons: [] },
      { source: "notes", title: "Ideas", score: 50, band: "normal", reasons: [] },
      { source: "calendar", title: "Standup", score: 10, band: "low", reasons: [] }
    ] as const;
    const result = reorderByPriority(items, ranked);
    expect(result.map((i) => i.source)).toEqual(["tasks", "notes", "calendar"]);
  });

  it("returns items unchanged when ranked results are empty", () => {
    expect(reorderByPriority(items, [])).toEqual(items);
  });

  it("keeps unmatched items at the end in their original relative order", () => {
    const ranked = [
      { source: "notes", title: "Ideas", score: 90, band: "high", reasons: [] }
    ] as const;
    const result = reorderByPriority(items, ranked);
    expect(result.map((i) => i.title)).toEqual(["Ideas", "Standup", "Fix bug"]);
  });

  it("does not confuse same title across different sources", () => {
    const dupes = [
      { source: "tasks", title: "Review", summary: "t" },
      { source: "email", title: "Review", summary: "e" }
    ];
    const ranked = [
      { source: "email", title: "Review", score: 90, band: "high", reasons: [] },
      { source: "tasks", title: "Review", score: 10, band: "low", reasons: [] }
    ] as const;
    const result = reorderByPriority(dupes, ranked);
    expect(result.map((i) => i.summary)).toEqual(["e", "t"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/chat-priority-consumer.test.ts`
Expected: FAIL — `reorderByPriority` is not exported.

- [ ] **Step 3: Implement `reorderByPriority`**

Append to `packages/chat/src/priority-consumer.ts`:

```ts
export function reorderByPriority<T extends { readonly source: string; readonly title: string }>(
  items: readonly T[],
  ranked: readonly PriorityResult[]
): T[] {
  if (ranked.length === 0) return [...items];
  const order = new Map<string, number>();
  for (const [index, result] of ranked.entries()) {
    const key = `${result.source}::${result.title}`;
    if (!order.has(key)) order.set(key, index);
  }
  return [...items].sort(
    (a, b) =>
      (order.get(`${a.source}::${a.title}`) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(`${b.source}::${b.title}`) ?? Number.MAX_SAFE_INTEGER)
  );
}
```

(`Array.prototype.sort` is stable, so unmatched items keep their relative order after matched ones.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/chat-priority-consumer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/priority-consumer.ts tests/unit/chat-priority-consumer.test.ts
git commit -m "feat(chat): add mixed-source reorderByPriority helper (#721)"
```

---

### Task 3: `ChatPriorityModelAdapter`

**Files:**

- Create: `packages/chat/src/live/priority-model-adapter.ts`
- Test: `tests/unit/chat-priority-model-adapter.test.ts` (new)

**Interfaces:**

- Consumes: `readPriorityModel` + `PriorityPreferenceReader` from Task 1; `DataContextRunner` from `@jarv1s/db`.
- Produces: `class ChatPriorityModelAdapter { constructor(deps: ChatPriorityModelAdapterDeps); getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> }` — Task 4's manager dep and Task 5's runtime construction use it.

DI pattern mirrors `PassiveContextRetriever` (`packages/chat/src/live/passive-retrieval.ts:56-70,110-112`): `deps.dataContext: Pick<DataContextRunner, "withDataContext">`, request id string literal.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat-priority-model-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ChatPriorityModelAdapter } from "../../packages/chat/src/live/priority-model-adapter.js";

describe("ChatPriorityModelAdapter", () => {
  it("reads the priority model inside a data context scoped to the actor", async () => {
    const scopedDb = { __brand: "scoped" };
    const withDataContext = vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
      fn(scopedDb)
    );
    const stored = {
      version: 1,
      mode: "deadline_first",
      anchors: [],
      mutedSources: ["notes"],
      updatedAt: "2026-07-01T00:00:00Z"
    };
    const preferencesRepository = { get: vi.fn().mockResolvedValue(stored) };

    const adapter = new ChatPriorityModelAdapter({
      dataContext: { withDataContext } as never,
      preferencesRepository: preferencesRepository as never
    });

    const model = await adapter.getModel("user1");

    expect(withDataContext).toHaveBeenCalledWith(
      { actorUserId: "user1", requestId: "chat:priority-model" },
      expect.any(Function)
    );
    expect(preferencesRepository.get).toHaveBeenCalledWith(scopedDb, "priority.model.v1");
    expect(model.mode).toBe("deadline_first");
    expect(model.mutedSources).toEqual(["notes"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/chat-priority-model-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `packages/chat/src/live/priority-model-adapter.ts`:

```ts
import type { DataContextRunner } from "@jarv1s/db";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

import { readPriorityModel, type PriorityPreferenceReader } from "../priority-consumer.js";

export interface ChatPriorityModelAdapterDeps {
  readonly dataContext: Pick<DataContextRunner, "withDataContext">;
  readonly preferencesRepository: PriorityPreferenceReader;
}

/**
 * Reads the user's priority model (`priority.model.v1`) inside a data context so
 * ChatSessionManager can reorder already-loaded cross-tool evidence. Read-only;
 * never triggers source reads.
 */
export class ChatPriorityModelAdapter {
  constructor(private readonly deps: ChatPriorityModelAdapterDeps) {}

  async getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> {
    return this.deps.dataContext.withDataContext(
      { actorUserId, requestId: "chat:priority-model" },
      async (scopedDb) => readPriorityModel(scopedDb, this.deps.preferencesRepository)
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/chat-priority-model-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/priority-model-adapter.ts tests/unit/chat-priority-model-adapter.test.ts
git commit -m "feat(chat): add ChatPriorityModelAdapter for priority model reads (#721)"
```

---

### Task 4: Wire priority reorder into `ChatSessionManager.engineText()`

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts` (deps interface at lines 105-185; `engineText()` at lines 571-642; cross-tool import at lines 30-34)
- Test: `tests/unit/chat-session-manager-priority.test.ts` (new)

**Interfaces:**

- Consumes: `rankChatContext`, `reorderByPriority` (Tasks 1-2), `renderCrossToolContextBlock` + `CrossToolEvidenceItem` (already exported from `packages/chat/src/live/cross-tool-reasoning.ts`), `PriorityModelPreferenceV1`.
- Produces: new optional dep on `ChatSessionManagerDeps`: `readonly priorityModel?: { getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> }` — Task 5 supplies it. (Structural type, NOT the concrete adapter class, so tests inject fakes.)

Key facts (verified): `crossToolResult` is `{ block, items }` from `collectCrossToolContextAndItems`; `block` is derived purely from `items` via `renderCrossToolContextBlock(sorted)`, so reorder-then-re-render changes the prompt order the model sees AND the provenance (`pendingItems`) order, loss-free. `CrossToolEvidenceItem.source` is `"notes" | "email" | "calendar" | "tasks"` — a strict subset of `CrossToolCandidate.source`, so the map to candidates needs no cast. The file has zero logging; failures swallow silently.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chat-session-manager-priority.test.ts`. Harness copied from `tests/unit/chat-session-manager-provenance.test.ts` with a fake `crossToolRead`. The user text `"what should I work on today"` deterministically plans `focus-planning` with sources `["tasks", "calendar"]` (verified against `planCrossToolReasoning`). The calendar event title shares query words (`today`, `work`) and starts within 2 days → relevance `high`; the tasks item (priority 3, focus tool) → relevance `medium`; so the baseline (relevance-sorted) order is calendar first, tasks second. Muting `calendar` in the priority model caps its score to the low band (`packages/priority/src/scoring.ts:184-186`) and flips the order.

```ts
import { describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import type {
  ChatSessionManagerDeps,
  ChatPersistencePort
} from "../../packages/chat/src/live/chat-session-manager.js";

const soonIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function makeCrossToolRead() {
  return {
    runReadTool: vi.fn(async (_actor: string, toolName: string) => {
      if (toolName === "tasks.focus") {
        return { ok: true, data: { items: [{ title: "Write quarterly report", priority: 3 }] } };
      }
      if (toolName === "tasks.atRisk" || toolName === "tasks.overdue") {
        return { ok: true, data: { items: [] } };
      }
      if (toolName === "calendar.listVisibleEvents") {
        return {
          ok: true,
          data: {
            events: [{ title: "Today work sync", starts_at: soonIso(), summary: "Today work sync" }]
          }
        };
      }
      return { ok: false };
    })
  };
}

function makeDeps(overrides: Partial<ChatSessionManagerDeps> = {}): {
  deps: ChatSessionManagerDeps;
  engine: { submit: ReturnType<typeof vi.fn> };
} {
  const persistence: ChatPersistencePort = {
    resolveActiveProvider: vi
      .fn()
      .mockResolvedValue({ provider: "anthropic", model: "claude-3-opus" }),
    listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
    recordTurn: vi.fn().mockResolvedValue({ userMessageId: "u1", assistantMessageId: "a1" }),
    openNewConversation: vi.fn(),
    getThreadContext: vi.fn().mockResolvedValue({ threadTitle: null, localTimezone: "UTC" }),
    touchExistingThread: vi.fn().mockResolvedValue(true)
  };

  const engine = {
    launch: vi.fn().mockResolvedValue({ offset: 0 }),
    submit: vi.fn().mockResolvedValue(undefined),
    readNew: vi
      .fn()
      .mockResolvedValueOnce({
        records: [{ kind: "reply", text: "Here is your plan." }],
        offset: 1,
        complete: false
      })
      .mockResolvedValue({ records: [], offset: 1, complete: true }),
    kill: vi.fn()
  };

  const deps: ChatSessionManagerDeps = {
    engineFactory: vi.fn().mockReturnValue(engine),
    persistence,
    personaFs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined)
    },
    clock: { now: () => Date.now() },
    idleMs: 60_000,
    neutralBase: "/tmp",
    persona: "You are Jarvis.",
    pollMs: 0,
    idleWatchdogMs: 0,
    crossToolRead: makeCrossToolRead(),
    ...overrides
  };
  return { deps, engine };
}

function submittedTurnText(engine: { submit: ReturnType<typeof vi.fn> }): string {
  const call = engine.submit.mock.calls.find(
    (args: unknown[]) => typeof args[0] === "string" && args[0].includes("<cross_tool_context>")
  );
  expect(call).toBeDefined();
  return call![0] as string;
}

describe("ChatSessionManager priority reorder", () => {
  it("keeps relevance order when no priorityModel dep is configured", async () => {
    const { deps, engine } = makeDeps();
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what should I work on today");

    const text = submittedTurnText(engine);
    expect(text.indexOf("[calendar")).toBeGreaterThan(-1);
    expect(text.indexOf("[calendar")).toBeLessThan(text.indexOf("[tasks"));
  });

  it("reorders cross-tool context by the user's priority model (muted calendar sinks)", async () => {
    const priorityModel = {
      getModel: vi.fn().mockResolvedValue({
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: ["calendar"],
        updatedAt: "2026-07-01T00:00:00Z"
      })
    };
    const { deps, engine } = makeDeps({ priorityModel });
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what should I work on today");

    expect(priorityModel.getModel).toHaveBeenCalledWith("user1");
    const text = submittedTurnText(engine);
    expect(text.indexOf("[tasks")).toBeGreaterThan(-1);
    expect(text.indexOf("[tasks")).toBeLessThan(text.indexOf("[calendar"));
  });

  it("keeps the original order and completes the turn when getModel rejects", async () => {
    const priorityModel = { getModel: vi.fn().mockRejectedValue(new Error("boom")) };
    const { deps, engine } = makeDeps({ priorityModel });
    const manager = new ChatSessionManager(deps);

    const result = await manager.submitTurn("user1", "TestUser", "what should I work on today");

    expect(result.reply).toBe("Here is your plan.");
    const text = submittedTurnText(engine);
    expect(text.indexOf("[calendar")).toBeLessThan(text.indexOf("[tasks"));
  });

  it("does not read the priority model when there is no cross-tool evidence", async () => {
    const priorityModel = {
      getModel: vi.fn().mockResolvedValue({
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: [],
        updatedAt: "2026-07-01T00:00:00Z"
      })
    };
    const crossToolRead = { runReadTool: vi.fn(async () => ({ ok: false })) };
    const { deps } = makeDeps({ priorityModel, crossToolRead });
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what should I work on today");

    expect(priorityModel.getModel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/chat-session-manager-priority.test.ts`
Expected: test 1 and 3 may pass (baseline behavior exists); tests 2 and 4 FAIL — `priorityModel` is not a known dep and no reorder happens. (TypeScript may also reject the unknown `priorityModel` key at compile time — that IS the failing signal.)

- [ ] **Step 3: Implement the wiring**

In `packages/chat/src/live/chat-session-manager.ts`:

3a. Extend the cross-tool import (lines 30-34) and add priority imports:

```ts
import {
  collectCrossToolContextAndItems,
  planCrossToolReasoning,
  renderCrossToolContextBlock,
  type CrossToolReadRunner
} from "./cross-tool-reasoning.js";
import { rankChatContext, reorderByPriority } from "../priority-consumer.js";
```

and with the other type-only imports at the top:

```ts
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";
```

3b. Add to `ChatSessionManagerDeps`, directly after `readonly crossToolRead?: CrossToolReadRunner;`:

```ts
  /**
   * Optional priority-model reader (#721). When present and cross-tool evidence was
   * collected, engineText re-ranks that evidence with the user's priority model and
   * re-renders the context block — already-loaded items only, never new source reads.
   */
  readonly priorityModel?: {
    getModel(actorUserId: string): Promise<PriorityModelPreferenceV1>;
  };
```

3c. In `engineText()`, after the `Promise.all` destructure (`const [passiveResult, crossToolResult] = ...`, ends line 624) and BEFORE the `// Convert evidence to pending support items for provenance` comment (line 626), insert — and switch the three downstream reads (`crossToolResult.items` at line 629, `crossToolResult.block` at line 634) to the new `crossTool` variable:

```ts
let crossTool = crossToolResult;
if (this.deps.priorityModel && crossTool.items.length > 0) {
  try {
    const model = await this.deps.priorityModel.getModel(actorUserId);
    const ranked = rankChatContext(
      crossTool.items.map((item) => ({
        source: item.source,
        title: item.title,
        summary: item.summary,
        dueAt: item.dueAt,
        startsAt: item.startsAt,
        textForAnchorMatch: [item.title, item.summary]
      })),
      model,
      localNow,
      threadCtx.localTimezone ?? "UTC"
    );
    const reordered = reorderByPriority(crossTool.items, ranked);
    crossTool = { block: renderCrossToolContextBlock(reordered), items: reordered };
  } catch {
    // Priority reorder is best-effort: keep the relevance-sorted order.
  }
}
```

Downstream lines become:

```ts
const crossToolItems = crossTool.items.map((item) => crossToolItemToSupport(item, idx++));
const pendingItems: AnswerSourceSupport[] = [...memoryItems, ...crossToolItems];

const combined = combineHiddenContextBlocks(passiveResult.block, crossTool.block);
```

Do NOT change the early-return guard at line 575 (`if (!this.deps.passiveRetrieval && !this.deps.crossToolRead)`) — `priorityModel` only matters when `crossToolRead` already produced items.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/chat-session-manager-priority.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the neighboring manager suites (regression)**

Run: `pnpm vitest run tests/unit/chat-session-manager.test.ts tests/unit/chat-session-manager-provenance.test.ts tests/unit/chat-session-manager-resume.test.ts tests/unit/chat-cross-tool-reasoning.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/chat-session-manager.ts tests/unit/chat-session-manager-priority.test.ts
git commit -m "feat(chat): rank cross-tool context with the user's priority model (#721)"
```

---

### Task 5: Thread the dep — runtime → routes → module-registry

**Files:**

- Modify: `packages/chat/src/live/runtime.ts` (`CreateChatSessionRuntimeDeps` lines 203-270; `ChatSessionManager` construction lines ~365-396)
- Modify: `packages/chat/src/routes.ts` (`ChatRoutesDependencies` lines 89-130; `createChatSessionRuntime({...})` call lines ~192-208)
- Modify: `packages/module-registry/src/index.ts` (chat `registerRoutes` block, `personaPreferences`/`localePreferences`/`agencyPreferences` at lines 627-629)

**Interfaces:**

- Consumes: `ChatPriorityModelAdapter` (Task 3); `PreferencesPort` (already imported in both `runtime.ts` line 11 and `routes.ts` line 12 from `@jarv1s/db`); `PreferencesRepository` from `@jarv1s/structured-state` (already imported in `module-registry/src/index.ts` line 47 — the generic port implementation, distinct from `@jarv1s/priority`'s `PriorityPreferencesRepository` normalizer; briefings wires the same generic class for its priority reads at line ~680).
- Produces: end-to-end wiring — real deploys read the user's saved priority model in chat.

This task is pure optional-dep threading with no new behavior beyond what Tasks 3-4 already test; verification is typecheck + existing suites (no new unit test — there is no seam that observes manager-internal deps from the runtime tests).

- [ ] **Step 1: `runtime.ts` — accept and construct**

Add to `CreateChatSessionRuntimeDeps`, after `readonly localePreferences?: PreferencesPort;` (line ~217):

```ts
  /** Priority preferences port — reads `priority.model.v1` to rank cross-tool chat context (#721). */
  readonly priorityPreferences?: PreferencesPort;
```

Add the import near the other `./` live imports (next to the `PassiveContextRetriever` import, line ~20):

```ts
import { ChatPriorityModelAdapter } from "./priority-model-adapter.js";
```

In the `new ChatSessionManager({...})` construction, after the `crossToolRead:` entry (lines ~391-395), add:

```ts
priorityModel: deps.priorityPreferences
  ? new ChatPriorityModelAdapter({
      dataContext: deps.dataContext,
      preferencesRepository: deps.priorityPreferences
    })
  : undefined;
```

- [ ] **Step 2: `routes.ts` — accept and forward**

Add to `ChatRoutesDependencies`, after `readonly agencyPreferences?: PreferencesPort;` (line ~103):

```ts
  /** Priority preferences port — forwarded to the chat runtime for cross-tool context ranking (#721). */
  readonly priorityPreferences?: PreferencesPort;
```

In the `createChatSessionRuntime({...})` call, after `localePreferences: dependencies.localePreferences,` (line ~207):

```ts
    priorityPreferences: dependencies.priorityPreferences,
```

- [ ] **Step 3: `module-registry/src/index.ts` — supply the real repository**

In the chat `registerRoutes` block, after `agencyPreferences: new PreferencesRepository(),` (line 629):

```ts
        priorityPreferences: new PreferencesRepository(),
```

- [ ] **Step 4: Verify — typecheck plus chat suites**

Run: `pnpm typecheck`
Expected: exit 0.

Run: `pnpm vitest run tests/unit/chat-runtime-selection.test.ts tests/unit/chat-gateway-dependencies.test.ts tests/unit/chat-route-standards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/runtime.ts packages/chat/src/routes.ts packages/module-registry/src/index.ts
git commit -m "feat(chat): thread priority preferences into the chat runtime (#721)"
```

---

### Task 6: Muted-source UI copy for unwired sources

**Files:**

- Modify: `packages/settings-ui/src/priority/index.tsx` (`VALID_SOURCES` line 13; Muted sources `Group` lines 283-302)
- Test: `tests/unit/priority-settings-ui.test.tsx` (append)

**Interfaces:**

- Consumes: nothing from earlier tasks (independent UI task).
- Produces: accurate muted-source copy. `memory` and `wellness` have zero active priority-candidate producers even after this build (chat produces tasks/calendar/email/notes after Task 4-5; briefings produces tasks/calendar/email) — verified by exhaustive grep in the research session. Switches stay functional for all 6 sources (forward-compat; `packages/settings/src/priority-routes.ts` validation unchanged).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/priority-settings-ui.test.tsx`. Seed the query cache so SSR renders the loaded state:

```ts
it("labels unwired muted sources as having no effect yet", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["priority-model"], {
    version: 1,
    mode: "balanced",
    anchors: [],
    mutedSources: [],
    updatedAt: "2026-07-01T00:00:00Z"
  });

  const html = renderToString(
    <QueryClientProvider client={queryClient}>
      <PrioritySettings />
    </QueryClientProvider>
  );

  expect(html).toContain("Exclude this source from priority ranking.");
  expect(html).toContain("Nothing feeds this source into ranking yet, so muting has no effect.");
  // Wired sources keep the active copy; the two unwired ones get the explainer.
  const activeCopy = html.split("Exclude this source from priority ranking.").length - 1;
  const unwiredCopy =
    html.split("Nothing feeds this source into ranking yet, so muting has no effect.").length - 1;
  expect(activeCopy).toBe(4);
  expect(unwiredCopy).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/priority-settings-ui.test.tsx`
Expected: FAIL — unwired copy not found (all 6 rows show the active copy).

- [ ] **Step 3: Implement the conditional copy**

In `packages/settings-ui/src/priority/index.tsx`, after `VALID_SOURCES` (line 13):

```ts
/** Sources no active consumer feeds into priority ranking (chat: tasks/calendar/email/notes; briefings: tasks/calendar/email). Muting them is stored but has no effect yet. */
const UNWIRED_SOURCES: ReadonlySet<string> = new Set(["memory", "wellness"]);
```

In the Muted sources `Group`, change the `Row` `desc` (line 291):

```tsx
            desc={
              UNWIRED_SOURCES.has(source)
                ? "Nothing feeds this source into ranking yet, so muting has no effect."
                : "Exclude this source from priority ranking."
            }
```

Leave the `Switch` exactly as-is (functional for all 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/priority-settings-ui.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/settings-ui/src/priority/index.tsx tests/unit/priority-settings-ui.test.tsx
git commit -m "fix(settings-ui): label unwired muted sources accurately (#721)"
```

---

## Exit-criteria mapping (spec → tasks)

| Spec acceptance                                                              | Covered by                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Priority settings affect ordering for already-loaded chat context candidates | Tasks 1-5 (Task 4 test: muted calendar sinks below tasks in the submitted prompt block)                |
| Muted-source behavior is accurate for sources with active consumers          | Task 4 (muting works through the generic scorer cap, no scorer change) + Task 2 (mixed-source reorder) |
| UI copy/controls do not imply unwired source behavior                        | Task 6                                                                                                 |
| Tests cover chat ordering and muted-source behavior                          | Tasks 1, 2, 3, 4, 6 test steps                                                                         |
| Reuse `rankChatContext`/`rankPriorityCandidates`; no second ranking system   | Task 4 calls `rankChatContext` only; `reorderByPriority` is ordering plumbing, not scoring             |
| No new source reads; scorer stays pure                                       | Adapter reads ONE preference row; no `@jarv1s/priority` source changes anywhere                        |

## Wrap-up (after all tasks)

- Full local gate: `pnpm verify:foundation` (record exit code).
- Pre-push trio + `git fetch origin main && git rebase origin/main` (mandatory again after PR #729 merges — expected soft overlap in `packages/chat/src/routes.ts`).
- Close out with the `coordinated-wrap-up` skill: push, open PR against `main` referencing issue #721, report to the Coordinator pane. No merge, no board moves.
