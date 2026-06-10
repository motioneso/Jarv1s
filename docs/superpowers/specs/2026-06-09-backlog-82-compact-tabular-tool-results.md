# Gateway Tool Results: Compact Tabular Serialization for List-Shaped Payloads — Design (Backlog #82)

**Status:** Draft — awaiting Ben approval
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #82

---

## Context

When module tools return lists of uniform records (tasks, calendar events, search hits), the
gateway today returns `GatewayToolResponse = { ok: true; data: Record<string, unknown> }` and the
MCP transport serializes `data` as pretty-printed JSON. For a list of 20 tasks with 8 fields each,
that's 8 repeated field names per record — 40–60% of tokens are structural overhead that adds no
fidelity for the model.

Compact tabular rendering (header row once, one line per record) is the right shape for flat,
uniform lists. Deep or non-uniform structures (nested objects, variable schemas) should stay JSON —
compact formats lose information there.

The convention belongs in the gateway/module-SDK layer, not per-module ad hoc. No module should
re-implement its own serialization.

Current types:

```ts
// packages/module-sdk/src/index.ts
export interface ToolResult {
  readonly data: Record<string, unknown>;
}

// packages/ai/src/gateway/types.ts
export type GatewayToolResponse =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly denied: true; readonly reason: string }
  | { readonly ok: false; readonly error: string };
```

The MCP transport (`packages/ai/src/gateway/gateway.ts` + `mcp-transport.ts`) serializes
`GatewayToolResponse.data` for the model.

## Goals

1. Define a **list-result convention** in `ToolResult`: modules signal "this is a uniform list" by
   returning `{ data: { items: T[] } }` where every `T` has the same key set and scalar values.
2. A shared `renderToolResult` utility (in `@jarv1s/module-sdk` or the gateway) detects the
   uniform-list shape and renders it as compact tabular text (Markdown table); non-uniform or
   nested payloads pass through as JSON.
3. The gateway calls `renderToolResult` before writing the tool content into the MCP response.
4. The Tasks module read tools (`packages/tasks/src/`) are migrated to use the list-result
   convention and produce tabular output.
5. An integration test asserts tabular output for uniform lists and JSON passthrough for nested
   payloads.

## Non-Goals

- Per-module opt-in via a flag per tool (the shape of the data is the signal — no per-tool config).
- Supporting TOON-style columnar alignment or custom column widths.
- Rendering lists within nested objects (one level of uniform-list detection only).
- Changing the gateway's `GatewayToolResponse` wire type (serialization is an internal concern).
- Streaming/chunked tool results.
- Changing the `ToolResult.data` contract for non-list results.

## Resolved Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Detection signal | Shape-based: `data.items` is an array AND every element has the same flat key set (no nested objects, no arrays) | No per-module annotation needed; most list tools already return `{ items: [...] }`. |
| 2 | Renderer location | Utility function `renderToolResult(data)` in `@jarv1s/module-sdk` | Module-SDK has no problematic deps; gateway imports it without creating a new dep direction. No `node:*` imports needed (pure string manipulation). |
| 3 | Tabular format | Markdown pipe-table (header + divider + one row per item) | Human-readable in logs; models parse it accurately; standard format. |
| 4 | Fallback | `JSON.stringify(data, null, 2)` for non-uniform / nested payloads | Unchanged behavior for everything that doesn't fit the uniform-list shape. |
| 5 | Migration scope | Tasks read tools only (issue #82 acceptance); other modules in follow-on | Proves the convention without a big-bang change. |
| 6 | Column order | Alphabetical (deterministic); modules may specify a preferred order via `ToolResult.columnOrder?: string[]` | Deterministic is better than insertion-order surprises; power users may want control. |

## Approach

### `renderToolResult` in `packages/module-sdk/src/`

```ts
export interface ToolResult {
  readonly data: Record<string, unknown>;
  readonly columnOrder?: readonly string[];  // optional preferred column order
}

/**
 * Renders a tool result as compact tabular Markdown when data.items is a uniform
 * flat array; falls back to formatted JSON otherwise.
 */
export function renderToolResult(result: ToolResult): string {
  const { data, columnOrder } = result;
  const items = data.items;

  if (!isUniformFlatArray(items)) {
    return JSON.stringify(data, null, 2);
  }

  const columns = columnOrder
    ? [...columnOrder, ...Object.keys(items[0]).filter(k => !columnOrder.includes(k))]
    : Object.keys(items[0]).sort();

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = items.map(
    (row: Record<string, unknown>) =>
      `| ${columns.map(c => String(row[c] ?? "")).join(" | ")} |`
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

### Gateway integration (`packages/ai/src/gateway/gateway.ts`)

In `runHandler` / after `found.execute(…)` resolves, replace the raw `data` pass-through with:

```ts
import { renderToolResult } from "@jarv1s/module-sdk";

// ...
const text = renderToolResult(toolResult);
return { ok: true, data: { text } };
```

The gateway's `GatewayToolResponse` `data` becomes `{ text: string }` — the MCP transport writes
the `text` field as the tool content string. (The MCP transport already serializes to a string for
the model; this just makes the rendering consistent and explicit.)

### Tasks module migration (`packages/tasks/src/`)

Find every tool handler that returns `{ data: { items: task[] } }` and verify the item shape is
flat (all scalar values). Add `columnOrder: ["id", "title", "status", "dueDate"]` (or similar) to
the `ToolResult` return where a specific column order is preferred. No logic changes required —
the convention is satisfied by the existing `{ items: [...] }` shape.

### MCP transport

Confirm `packages/ai/src/gateway/mcp-transport.ts` (or equivalent) writes
`GatewayToolResponse.data.text` as the tool result content. If it currently uses `JSON.stringify`
on the full `data` blob, switch to using `data.text` directly (the rendered string).

## Testing

- **Uniform list → tabular:** `renderToolResult({ data: { items: [{id:1, name:"a"}, {id:2, name:"b"}] } })` produces a Markdown table with header `| id | name |` and two data rows.
- **Nested payload → JSON passthrough:** `renderToolResult({ data: { task: { id: 1, subtasks: [] } } })` returns `JSON.stringify(…)`.
- **Empty list → JSON passthrough:** `renderToolResult({ data: { items: [] } })` returns JSON (not a broken table).
- **Non-uniform list → JSON passthrough:** items with different key sets → JSON.
- **Integration (Tasks read tool):** call a Tasks list tool end-to-end; assert the MCP tool response content is a pipe-table string, not raw JSON.

## Exit Criteria

1. `pnpm verify:foundation` green.
2. `renderToolResult` in `@jarv1s/module-sdk`; unit tests cover uniform, non-uniform, nested, and empty cases.
3. Gateway calls `renderToolResult` on every successful tool result before emitting the MCP response.
4. At least one Tasks read tool produces tabular output end-to-end (verified by integration test).
5. Non-list tool results (write confirmations, single-record fetches) are unchanged.

## Hard Invariants Honored

- **Module isolation** — `renderToolResult` lives in `module-sdk` (no cross-module dep); tasks tools use only `module-sdk` as before.
- **DataContextDb only** — no DB access in the renderer; purely a serialization transform.
- **Secrets never escape** — the renderer is a pure text transform; it does not inspect or log field values beyond string conversion.
- **Plain Fastify REST + shared TS contracts** — this is a serialization detail; the REST contract is unchanged.
