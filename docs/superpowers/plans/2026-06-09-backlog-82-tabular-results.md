# Backlog #82 — Compact Tabular Tool Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `renderToolResult` utility to `@jarv1s/module-sdk` that detects uniform flat lists in tool results and renders them as Markdown pipe tables, then wire it into the gateway and migrate the Tasks module read tools to produce tabular output.

**Architecture:** `renderToolResult(result: ToolResult): string` lives in `packages/module-sdk/src/index.ts` (pure string manipulation, no `node:*` imports). The gateway's `runHandler` calls it on every successful result and returns `{ ok: true, data: { text: renderedString } }`. The MCP transport (`packages/chat/src/mcp-transport.ts`) reads `res.data.text` directly instead of `JSON.stringify`-ing the whole data blob. Tasks list tools are migrated to return `{ data: { items: [...] } }` with optional `columnOrder`.

**Tech Stack:** TypeScript, Vitest, Fastify, `@jarv1s/module-sdk`, `@jarv1s/ai` (gateway), `@jarv1s/chat` (MCP transport), `@jarv1s/tasks`

---

## File Map

| Action | File                                                                           | Purpose                                                                           |
| ------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| MODIFY | `packages/module-sdk/src/index.ts`                                             | Add `columnOrder?` to `ToolResult`; add `renderToolResult` + `isUniformFlatArray` |
| MODIFY | `packages/ai/src/gateway/gateway.ts`                                           | Import `renderToolResult`; change `runHandler` to render before returning         |
| MODIFY | `packages/chat/src/mcp-transport.ts`                                           | Change `gatewayResponseToMcp` to use `res.data.text` directly                     |
| MODIFY | `packages/tasks/src/tools.ts`                                                  | Rename array keys to `items`; add `columnOrder` to task list tools                |
| CREATE | `tests/integration/render-tool-result.test.ts`                                 | Unit tests for `renderToolResult` (no DB needed)                                  |
| MODIFY | `tests/integration/mcp-gateway.test.ts`                                        | Update `data` expectations; add tabular end-to-end test                           |
| MODIFY | `tests/integration/tasks-tools.test.ts`                                        | Update `data.tasks`/`data.lists`/`data.tags`/`data.activity` → `data.items`       |
| MODIFY | `tests/integration/fixtures/example-tool-module.ts`                            | Add `example.list` tool that returns a uniform flat list                          |
| CREATE | `docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md` | Copy approved spec into this branch                                               |

---

## Task 1: Add `renderToolResult` to module-sdk (TDD)

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Create: `tests/integration/render-tool-result.test.ts`

### Step 1a: Write the failing unit tests

Create `tests/integration/render-tool-result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderToolResult } from "../../packages/module-sdk/src/index.js";

describe("renderToolResult", () => {
  it("renders a uniform flat list as a Markdown pipe table with columns sorted alphabetically", () => {
    const result = renderToolResult({
      data: {
        items: [
          { id: "1", name: "alpha" },
          { id: "2", name: "beta" }
        ]
      }
    });
    expect(result).toBe("| id | name |\n| --- | --- |\n| 1 | alpha |\n| 2 | beta |");
  });

  it("respects columnOrder — preferred columns first, remaining sorted after", () => {
    const result = renderToolResult({
      data: {
        items: [
          { id: "1", name: "alpha", status: "active" },
          { id: "2", name: "beta", status: "done" }
        ]
      },
      columnOrder: ["name", "status"]
    });
    // name + status first (from columnOrder), then id (remaining, alphabetical)
    expect(result).toBe(
      "| name | status | id |\n| --- | --- | --- |\n| alpha | active | 1 |\n| beta | done | 2 |"
    );
  });

  it("renders null cell values as empty string", () => {
    const result = renderToolResult({
      data: { items: [{ id: "1", dueAt: null }] }
    });
    expect(result).toBe("| dueAt | id |\n| --- | --- |\n|  | 1 |");
  });

  it("falls back to formatted JSON for empty items array", () => {
    const result = renderToolResult({ data: { items: [] } });
    expect(result).toBe(JSON.stringify({ items: [] }, null, 2));
  });

  it("falls back to formatted JSON for non-uniform items (different key sets)", () => {
    const data = { items: [{ id: "1", name: "alpha" }, { id: "2" }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON for items with nested object values", () => {
    const data = { items: [{ id: "1", meta: { x: 1 } }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON for items containing arrays", () => {
    const data = { items: [{ id: "1", tags: ["a", "b"] }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON when data has no items key", () => {
    const data = { task: { id: "1", subtasks: [] } };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON when items is not an array", () => {
    const data = { items: "not-an-array" };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });
});
```

- [ ] **Step 1b: Run tests to verify they fail**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/backlog-82-tabular-results
pnpm vitest run tests/integration/render-tool-result.test.ts
```

Expected: `Error: renderToolResult is not a function` (or similar import error)

- [ ] **Step 1c: Implement `renderToolResult` in `packages/module-sdk/src/index.ts`**

Add `columnOrder?` to `ToolResult` and the two new functions at the end of the file. Insert BEFORE the closing of the file (after the last export):

```ts
export interface ToolResult {
  readonly data: Record<string, unknown>;
  readonly columnOrder?: readonly string[];
}
```

(This replaces the existing `ToolResult` interface at line 18–20.)

Add these two functions at the **end** of `packages/module-sdk/src/index.ts`:

```ts
/**
 * Renders a tool result as compact tabular Markdown when data.items is a
 * uniform flat array; falls back to formatted JSON otherwise.
 */
export function renderToolResult(result: ToolResult): string {
  const { data, columnOrder } = result;
  const items = data.items;

  if (!isUniformFlatArray(items)) {
    return JSON.stringify(data, null, 2);
  }

  const columns = columnOrder
    ? [...columnOrder, ...Object.keys(items[0]).filter((k) => !columnOrder.includes(k))]
    : Object.keys(items[0]).sort();

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = items.map(
    (row: Record<string, unknown>) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`
  );
  return [header, divider, ...rows].join("\n");
}

function isUniformFlatArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = Object.keys(value[0]).sort().join(",");
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      Object.keys(item).sort().join(",") === keys &&
      Object.values(item).every((v) => typeof v !== "object" || v === null)
  );
}
```

- [ ] **Step 1d: Run unit tests to verify they pass**

```bash
pnpm vitest run tests/integration/render-tool-result.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 1e: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 1f: Commit**

```bash
git add packages/module-sdk/src/index.ts tests/integration/render-tool-result.test.ts
git commit -m "feat(module-sdk): add renderToolResult — tabular Markdown for uniform flat lists

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Wire `renderToolResult` into gateway + MCP transport (TDD)

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts` (line 98)
- Modify: `packages/chat/src/mcp-transport.ts` (line 112)
- Modify: `tests/integration/mcp-gateway.test.ts` (lines 74–78, 95–98)
- Modify: `tests/integration/fixtures/example-tool-module.ts` (add `example.list` tool)

### Step 2a: Update `mcp-gateway.test.ts` to expect the new data shape

The gateway's `runHandler` will now return `{ ok: true, data: { text: "..." } }` instead of `{ ok: true, data: { ...rawPayload } }`. Update the two assertions that check `res.data` for the example tools (which return non-list data → JSON passthrough).

In `tests/integration/mcp-gateway.test.ts`, find the test `"runs a read tool immediately under the caller's RLS scope"` and replace the `expect(res).toEqual(...)` block:

**Before (lines 74–78):**

```ts
expect(res).toEqual({
  ok: true,
  data: { ok: true, name: "example.read", echo: "hi", actor: ids.userA }
});
```

**After:**

```ts
expect(res.ok).toBe(true);
if (!res.ok) throw new Error("expected ok");
const parsed = JSON.parse((res.data as { text: string }).text) as Record<string, unknown>;
expect(parsed).toMatchObject({ echo: "hi", actor: ids.userA });
```

Find the test `"blocks a write until approved, emits a card, then executes"` and replace its `expect(res).toEqual(...)` block:

**Before (lines 95–98):**

```ts
expect(res).toEqual({
  ok: true,
  data: { ok: true, name: "example.write", echo: "hello", actor: ids.userA }
});
```

**After:**

```ts
expect(res.ok).toBe(true);
if (!res.ok) throw new Error("expected ok");
const parsed = JSON.parse((res.data as { text: string }).text) as Record<string, unknown>;
expect(parsed).toMatchObject({ echo: "hello", actor: ids.userA });
```

### Step 2b: Add `example.list` fixture tool and tabular end-to-end test

In `tests/integration/fixtures/example-tool-module.ts`, add a new tool entry to `assistantTools` array (after `example.declaration-only`):

```ts
    {
      name: "example.list",
      description: "Returns a uniform flat list (tabular output fixture).",
      permissionId: "example.view",
      risk: "read" as const,
      inputSchema: { type: "object", properties: {} },
      execute: async (db, _input, ctx) => {
        assertDataContextDb(db as DataContextDb);
        exampleToolCalls.push({ name: "example.list", input: {}, actorUserId: ctx.actorUserId });
        return {
          data: {
            items: [
              { id: "a1", name: "Alpha", status: "active" },
              { id: "a2", name: "Beta", status: "inactive" }
            ]
          }
        };
      }
    },
```

In `tests/integration/mcp-gateway.test.ts`, add this test inside the `describe("AssistantToolGateway", ...)` block (after the existing tests):

```ts
it("renders a uniform-list tool result as a Markdown pipe table (end-to-end)", async () => {
  const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s-tabular" });
  const res = await gateway.callTool(token, "example.list", {});

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("expected ok");
  const text = (res.data as { text: string }).text;
  // columns alphabetical: id, name, status
  expect(text).toContain("| id | name | status |");
  expect(text).toContain("| --- | --- | --- |");
  expect(text).toContain("| a1 | Alpha | active |");
  expect(text).toContain("| a2 | Beta | inactive |");
  // must NOT be raw JSON
  expect(text).not.toContain('"items"');
});
```

- [ ] **Step 2c: Run gateway tests to verify they fail**

```bash
pnpm vitest run tests/integration/mcp-gateway.test.ts
```

Expected: existing tests fail (data shape mismatch); `example.list` test fails (function not yet wired).

### Step 2d: Implement gateway change

In `packages/ai/src/gateway/gateway.ts`:

1. Add `renderToolResult` to the `@jarv1s/module-sdk` import (line 6–9):

```ts
import type {
  JarvisModuleManifest,
  ModuleAssistantToolManifest,
  ToolContext,
  ToolExecute
} from "@jarv1s/module-sdk";
import { renderToolResult } from "@jarv1s/module-sdk";
```

2. In `runHandler` (around line 95–98), change:

```ts
return { ok: true, data: result.data };
```

to:

```ts
return { ok: true, data: { text: renderToolResult(result) } };
```

### Step 2e: Implement MCP transport change

In `packages/chat/src/mcp-transport.ts`, in `gatewayResponseToMcp` (line 110–127), change:

```ts
return {
  content: [{ type: "text", text: JSON.stringify(res.data) }],
  isError: false
};
```

to:

```ts
return {
  content: [{ type: "text", text: (res.data as { text: string }).text }],
  isError: false
};
```

- [ ] **Step 2f: Run gateway + transport tests to verify they pass**

```bash
pnpm vitest run tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts
```

Expected: All tests pass (the transport test uses `JSON.parse(text)` which still works since non-list data falls back to JSON).

- [ ] **Step 2g: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 2h: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts packages/chat/src/mcp-transport.ts \
        tests/integration/mcp-gateway.test.ts \
        tests/integration/fixtures/example-tool-module.ts
git commit -m "feat(gateway): wire renderToolResult — gateway renders tool results before MCP response

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Migrate Tasks read tools to the `items` convention (TDD)

**Files:**

- Modify: `packages/tasks/src/tools.ts`
- Modify: `tests/integration/tasks-tools.test.ts`

### Step 3a: Update `tasks-tools.test.ts` to use `items` key

All list-returning tools (`tasks.list`, `tasks.focus`, `tasks.atRisk`, `tasks.overdue`, `tasks.listLists`, `tasks.listTags`, `tasks.activity`) change their array key to `items`. The single-record tool `tasks.get` is NOT a list tool and stays untouched.

Make the following replacements in `tests/integration/tasks-tools.test.ts`:

**Line 69** — `result.data.tasks` → `result.data.items`:

```ts
const returned = result.data.items as TaskDto[];
```

**Line 79** — `doneResult.data.tasks` → `doneResult.data.items`:

```ts
expect((doneResult.data.items as TaskDto[]).every((t) => t.status === "done")).toBe(true);
```

**Line 93** — `result.data.tasks` → `result.data.items`:

```ts
const resultIds = (result.data.items as TaskDto[]).map((t) => t.id);
```

**Line 99** — `elimResult.data.tasks` → `elimResult.data.items`:

```ts
expect((elimResult.data.items as TaskDto[]).map((t) => t.id)).not.toContain(doTask.id);
```

**Line 185** — `focusResult.data.tasks` → `focusResult.data.items`:

```ts
const focusIds = (focusResult.data.items as TaskDto[]).map((t) => t.id);
```

**Line 186** — `atRiskResult.data.tasks` → `atRiskResult.data.items`:

```ts
const atRiskIds = (atRiskResult.data.items as TaskDto[]).map((t) => t.id);
```

**Line 187** — `overdueResult.data.tasks` → `overdueResult.data.items`:

```ts
const overdueIds = (overdueResult.data.items as TaskDto[]).map((t) => t.id);
```

**Line 207** — `result.data.lists` → `result.data.items`:

```ts
const taskLists = result.data.items as Array<{ name: string; ownerUserId: string }>;
```

**Line 229** — `result.data.tags` → `result.data.items`:

```ts
const tags = result.data.items as Array<{ name: string }>;
```

**Line 250** — `result.data.activity` → `result.data.items`:

```ts
const activity = result.data.items as Array<{ activityType: string; body: string | null }>;
```

Lines 124–126 (`result.data.task`, `result.data.subtasks`, `result.data.activity` inside `tasks.get` test) are **unchanged** — `tasks.get` returns a mixed/nested payload, not a list.

- [ ] **Step 3b: Run tasks-tools tests to verify they fail**

```bash
pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: All list-tool tests fail with `undefined` (key renamed in assertions but tools still return old keys).

### Step 3c: Migrate Tasks tools to `items` + add `columnOrder`

In `packages/tasks/src/tools.ts`, make the following changes:

**`taskListExecute` (line 63)** — change return + add `columnOrder`:

```ts
return {
  data: { items: tasks.map(serializeTask) },
  columnOrder: ["id", "title", "status", "dueAt", "priority"]
};
```

**`taskFocusExecute` (line 97)** — change return + add `columnOrder`:

```ts
return {
  data: { items: tasks.map(serializeTask) },
  columnOrder: ["id", "title", "status", "dueAt", "priority"]
};
```

**`taskAtRiskExecute` (line 107)** — change return + add `columnOrder`:

```ts
return {
  data: { items: tasks.map(serializeTask) },
  columnOrder: ["id", "title", "status", "dueAt", "priority"]
};
```

**`taskOverdueExecute` (line 117)** — change return + add `columnOrder`:

```ts
return {
  data: { items: tasks.map(serializeTask) },
  columnOrder: ["id", "title", "status", "dueAt", "priority"]
};
```

**`taskListListsExecute` (line 127)** — change return:

```ts
return { data: { items: taskLists.map(serializeTaskList) } };
```

**`taskListTagsExecute` (line 138)** — change return:

```ts
return { data: { items: tags.map(serializeTaskTag) } };
```

**`taskActivityExecute` (line 149)** — change return:

```ts
return { data: { items: activity.map(serializeTaskActivity) } };
```

`taskGetExecute` is **unchanged** (mixed nested payload).

- [ ] **Step 3d: Run tasks-tools tests to verify they pass**

```bash
pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: All tests pass.

- [ ] **Step 3e: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3f: Commit**

```bash
git add packages/tasks/src/tools.ts tests/integration/tasks-tools.test.ts
git commit -m "feat(tasks): migrate read tools to items convention for tabular output

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Copy spec + pre-push gate

**Files:**

- Create: `docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md`

- [ ] **Step 4a: Copy the approved spec into this branch**

The spec exists in the main worktree at `/home/ben/Jarv1s/docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md` but is not yet in this worktree's branch. Copy it:

```bash
cp /home/ben/Jarv1s/docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md \
   docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md
```

- [ ] **Step 4b: Commit spec**

```bash
git add docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md
git commit -m "docs: add approved spec for backlog #82 tabular tool results

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 4c: Run pre-push fast checks**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: All green. Fix anything red before proceeding.

- [ ] **Step 4d: Rebase onto latest origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: Clean rebase (this branch has no conflicts per collision notes).

---

## Self-Review Against Spec Exit Criteria

1. **`pnpm verify:foundation` green** — covered by Task 4c + the `coordinated-wrap-up` gate.
2. **`renderToolResult` in `@jarv1s/module-sdk`; unit tests cover uniform, non-uniform, nested, empty** — Task 1 (9 test cases).
3. **Gateway calls `renderToolResult` on every successful tool result before emitting MCP response** — Task 2 (`runHandler` change).
4. **At least one Tasks read tool produces tabular output end-to-end (verified by integration test)** — Task 2 (`example.list` tabular test through full gateway chain) + Task 3 (Tasks tools all use `items`).
5. **Non-list tool results unchanged** — `taskGetExecute` and `example.read`/`example.write` both fall through to JSON (covered by transport test still passing).

All five exit criteria are addressed. No gaps found.
