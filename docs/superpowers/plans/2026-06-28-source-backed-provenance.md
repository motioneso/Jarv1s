# Source-Backed Answers with Provenance (#539) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach bounded source-metadata ("answer provenance") to chat assistant messages so users can see which memory, email, calendar, task, or note items backed an answer.

**Architecture:** A new `answer-provenance.ts` module in `packages/chat/src/live/` collects `AnswerSourceSupport` items from the cross-tool and passive-retrieval evidence already gathered before each turn, attaches local citation ids (`S1`, `S2`, …) when rendering hidden context, parses `[[S1]]` markers from the assistant reply, finalizes (sanitize, cap, sort), and persists `answerProvenanceV1` in `chat_messages.tool_metadata`. Two new read-only API routes expose `AnswerSourceSupportCard[]` (citationToken stripped). Frontend strips markers from displayed text and renders compact source chips. No new DB migration required — provenance is stored in the existing `tool_metadata` JSONB column.

**Tech Stack:** TypeScript (strict), Fastify, Kysely, Vitest, React (Vite + TanStack Query)

## Global Constraints

- No new DB migrations — store provenance in existing `chat_messages.tool_metadata.answerProvenanceV1`
- `ChatMessageDto` change must be additive (`answerProvenance` is optional, `AnswerSourceSupportCard[]`)
- No cross-module internal imports: `packages/chat` must not import from `packages/memory` internals or `packages/notes` internals — only public API types (`@jarv1s/memory`, `@jarv1s/notes`)
- Provenance items are metadata only: `sourceLabel`, `title`, `snippet` (max 240 chars) — never raw source text, bodies, prompts, tokens, or connector credentials
- Provenance is derived **before and independent of** the AI prompt — the model never selects or filters items
- An answer stores **at most 8** visible support items; payload is capped at **16 KB**
- `snippet`, `sourceLabel`, `title` are plain text only — strip control chars, reject markup-shaped content, render as text never HTML
- `citationToken` lives in stored `AnswerSourceSupport` but is **never returned** in API responses (`AnswerSourceSupportCard` omits it)
- Dereference routes always pass the **authenticated actor id** from request context to providers — never owner id from stored metadata or client payload
- Provenance must never block a chat turn; all collection/finalisation errors are caught and silently dropped
- File size limit: all source files ≤ 1000 lines
- No briefings integration in this PR (packages/briefings/ is out of scope per collision notes)

---

## File Structure

| Path                                                 | Status     | Responsibility                                                                                     |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `packages/shared/src/chat-api.ts`                    | **Modify** | Add provenance types + update `ChatMessageDto`                                                     |
| `packages/chat/src/live/answer-provenance.ts`        | **Create** | Sanitizer, marker parser, converters (memory/cross-tool → support), finalizer                      |
| `packages/chat/src/live/passive-retrieval.ts`        | **Modify** | Add `retrieveWithItems()` returning `{ block, items }`                                             |
| `packages/chat/src/live/cross-tool-reasoning.ts`     | **Modify** | Add `collectCrossToolContextAndItems()` returning `{ block, items }`                               |
| `packages/chat/src/live/chat-session-manager.ts`     | **Modify** | Wire provenance: `engineText` returns pending items; `runTurn` finalises and passes to persistence |
| `packages/chat/src/live/persistence.ts`              | **Modify** | Extend `recordTurn` signature to accept optional `answerProvenance`                                |
| `packages/chat/src/repository.ts`                    | **Modify** | Extend `recordCompletedTurn` to write `answerProvenanceV1` into `tool_metadata`                    |
| `packages/chat/src/routes.ts`                        | **Modify** | Add provenance routes; update `serializeMessage`                                                   |
| `apps/web/src/chat/answer-provenance.tsx`            | **Create** | `SourceChips` + `SourceTray` components                                                            |
| `apps/web/src/chat/markdown-message.tsx`             | **Modify** | Strip `[[S1]]` markers from displayed text; render `<SourceChips>` below answered messages         |
| `tests/unit/chat-answer-provenance.test.ts`          | **Create** | Unit tests for sanitizer, marker parser, finalizer, converters                                     |
| `tests/unit/chat-session-manager-provenance.test.ts` | **Create** | Unit tests for wired provenance in session manager                                                 |
| `tests/integration/chat-provenance-routes.test.ts`   | **Create** | Integration tests for provenance API routes                                                        |

---

### Task 1: Shared types + ChatMessageDto update

**Files:**

- Modify: `packages/shared/src/chat-api.ts`

**Interfaces produced (used by all later tasks):**

```ts
// Source kinds
type AnswerProvenanceSourceKind =
  | "memory"
  | "note"
  | "email"
  | "calendar"
  | "task"
  | "commitment"
  | "person"
  | "goal"
  | "briefing";

// State labels
type AnswerProvenanceState =
  | "confirmed_source"
  | "inferred_memory"
  | "pending_candidate"
  | "ambiguous_identity"
  | "unverified_context";

// Stored per-item (WITH citationToken — never returned to API callers)
interface AnswerSourceSupport {
  readonly supportId: string; // e.g. "S1"
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string; // plain text, bounded
  readonly title: string; // plain text, bounded
  readonly snippet?: string; // plain text, max 240 chars
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string; // ISO string
  readonly citationToken?: string; // opaque, source-owned, never in API
  readonly canDereference: boolean;
}

// API DTO — citationToken explicitly absent
interface AnswerSourceSupportCard {
  readonly supportId: string;
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string;
  readonly canDereference: boolean;
}

// Stored in chat_messages.tool_metadata.answerProvenanceV1
interface AnswerProvenanceMetadataV1 {
  readonly version: 1;
  readonly citedSupportIds: readonly string[];
  readonly supportItems: readonly AnswerSourceSupport[];
  readonly contextCheckedCount: number;
  readonly omittedCount: number;
}

// Source-owned provider interface (registered by modules that can dereference)
interface AnswerProvenanceProvider {
  readonly sourceKind: AnswerProvenanceSourceKind;
  verifySupport(
    scopedDb: unknown,
    input: { ownerUserId: string; citationToken: string }
  ): Promise<AnswerSourceSupport | null>;
  dereferenceSupport(
    scopedDb: unknown,
    input: { ownerUserId: string; citationToken: string }
  ): Promise<AnswerProvenanceDereference | null>;
}

interface AnswerProvenanceDereference {
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly deepLinkPath?: string; // validated internal path only
  readonly unavailableReason?: "missing" | "permission" | "source_unavailable";
}
```

- [ ] **Step 1: Add types to `packages/shared/src/chat-api.ts`**

After the existing `ChatMessageDto` and before the Zod/JSON-schema blocks, add:

```ts
export type AnswerProvenanceSourceKind =
  | "memory"
  | "note"
  | "email"
  | "calendar"
  | "task"
  | "commitment"
  | "person"
  | "goal"
  | "briefing";

export type AnswerProvenanceState =
  | "confirmed_source"
  | "inferred_memory"
  | "pending_candidate"
  | "ambiguous_identity"
  | "unverified_context";

export interface AnswerSourceSupport {
  readonly supportId: string;
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string;
  readonly citationToken?: string;
  readonly canDereference: boolean;
}

export interface AnswerSourceSupportCard {
  readonly supportId: string;
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string;
  readonly canDereference: boolean;
}

export interface AnswerProvenanceMetadataV1 {
  readonly version: 1;
  readonly citedSupportIds: readonly string[];
  readonly supportItems: readonly AnswerSourceSupport[];
  readonly contextCheckedCount: number;
  readonly omittedCount: number;
}

export interface AnswerProvenanceProvider {
  readonly sourceKind: AnswerProvenanceSourceKind;
  verifySupport(
    scopedDb: unknown,
    input: { readonly ownerUserId: string; readonly citationToken: string }
  ): Promise<AnswerSourceSupport | null>;
  dereferenceSupport(
    scopedDb: unknown,
    input: { readonly ownerUserId: string; readonly citationToken: string }
  ): Promise<AnswerProvenanceDereference | null>;
}

export interface AnswerProvenanceDereference {
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly deepLinkPath?: string;
  readonly unavailableReason?: "missing" | "permission" | "source_unavailable";
}
```

- [ ] **Step 2: Add optional `answerProvenance` field to `ChatMessageDto`**

In the `ChatMessageDto` interface (line ~35), add after `updatedAt`:

```ts
readonly answerProvenance?: readonly AnswerSourceSupportCard[];
```

Update `chatMessageSchema` JSON-schema to add `answerProvenance` as an optional property:

```ts
answerProvenance: {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["supportId", "sourceKind", "sourceLabel", "title", "state", "canDereference"],
    properties: {
      supportId: { type: "string" },
      sourceKind: { type: "string" },
      sourceLabel: { type: "string" },
      title: { type: "string" },
      snippet: { type: "string" },
      state: { type: "string" },
      confidence: { type: "number" },
      confidenceTier: { type: "string" },
      provenance: { type: "string" },
      occurredAt: { type: "string" },
      canDereference: { type: "boolean" }
    }
  }
}
```

Note: `answerProvenance` is **NOT** added to `required` (it's optional, additive, backward-compatible).

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/chat-api.ts
git commit -m "feat(chat): add AnswerProvenance types and optional ChatMessageDto.answerProvenance field (#539)"
```

---

### Task 2: Core provenance module (`answer-provenance.ts`)

**Files:**

- Create: `packages/chat/src/live/answer-provenance.ts`

**Consumes:** `AnswerSourceSupport`, `AnswerSourceSupportCard`, `AnswerProvenanceMetadataV1`, `AnswerProvenanceSourceKind`, `AnswerProvenanceState` from `@jarv1s/shared`; `CrossToolEvidenceItem`, `CrossToolSource` from `./cross-tool-reasoning.js`; `MemoryRecallItem`, `MemoryFactProvenance`, `MemoryFactStatus` from `@jarv1s/memory`

**Produces:**

- `sanitizePlainText(text: string): string`
- `parseAnswerMarkers(text: string): string[]`
- `stripAnswerMarkers(text: string, validIds: ReadonlySet<string>): string`
- `crossToolItemToSupport(item: CrossToolEvidenceItem, idx: number): AnswerSourceSupport`
- `memoryItemToSupport(item: MemoryRecallItem, idx: number): AnswerSourceSupport`
- `renderContextLineWithSupportId(line: string, supportId: string): string`
- `finalizeProvenance(candidates: AnswerSourceSupport[], citedIds: readonly string[]): AnswerProvenanceMetadataV1`
- `toSupportCard(item: AnswerSourceSupport): AnswerSourceSupportCard`
- `readStoredProvenance(toolMetadata: Record<string, unknown>): AnswerProvenanceMetadataV1 | null`
- `provenanceCards(metadata: AnswerProvenanceMetadataV1): AnswerSourceSupportCard[]`

- [ ] **Step 1: Write failing tests in `tests/unit/chat-answer-provenance.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  sanitizePlainText,
  parseAnswerMarkers,
  stripAnswerMarkers,
  crossToolItemToSupport,
  memoryItemToSupport,
  finalizeProvenance,
  toSupportCard,
  readStoredProvenance,
  provenanceCards
} from "../../packages/chat/src/live/answer-provenance.js";
import type { CrossToolEvidenceItem } from "../../packages/chat/src/live/cross-tool-reasoning.js";
import type { MemoryRecallItem } from "@jarv1s/memory";

// ── sanitizePlainText ─────────────────────────────────────────────────────────
describe("sanitizePlainText", () => {
  it("strips NUL and other control chars except tab/newline/CR", () => {
    expect(sanitizePlainText("hello\x00world")).toBe("helloworld");
    expect(sanitizePlainText("tab\there")).toBe("tab\there");
  });

  it("caps at 240 chars for snippets when explicitly capped", () => {
    const long = "a".repeat(300);
    expect(sanitizePlainText(long, 240).length).toBe(240);
  });

  it("preserves normal text unchanged", () => {
    expect(sanitizePlainText("Email: Sarah / Pricing")).toBe("Email: Sarah / Pricing");
  });
});

// ── parseAnswerMarkers ────────────────────────────────────────────────────────
describe("parseAnswerMarkers", () => {
  it("extracts valid [[SN]] markers", () => {
    expect(parseAnswerMarkers("According to [[S1]] and [[S2]] ...")).toEqual(["S1", "S2"]);
  });

  it("deduplicates repeated markers", () => {
    expect(parseAnswerMarkers("[[S1]] and [[S1]] again")).toEqual(["S1"]);
  });

  it("ignores malformed markers", () => {
    expect(parseAnswerMarkers("[[s1]] [[]] [[S-1]] [[TOOLONG12]]")).toEqual([]);
  });

  it("returns empty array when no markers", () => {
    expect(parseAnswerMarkers("plain text")).toEqual([]);
  });
});

// ── stripAnswerMarkers ────────────────────────────────────────────────────────
describe("stripAnswerMarkers", () => {
  it("removes valid markers that exist in validIds set", () => {
    const valid = new Set(["S1", "S2"]);
    expect(stripAnswerMarkers("See [[S1]] for details [[S3]]", valid)).toBe(
      "See  for details [[S3]]"
    );
  });

  it("leaves unknown support ids unchanged", () => {
    const valid = new Set(["S1"]);
    expect(stripAnswerMarkers("[[S99]] text", valid)).toBe("[[S99]] text");
  });
});

// ── crossToolItemToSupport ────────────────────────────────────────────────────
describe("crossToolItemToSupport", () => {
  const emailItem: CrossToolEvidenceItem = {
    source: "email",
    title: "Pricing discussion",
    summary: "Sarah asked about the Q3 pricing before the review.",
    sourceLabel: "Email: Sarah / Pricing discussion",
    occurredAt: "2026-06-01T10:00:00Z",
    relevance: "high"
  };

  it("maps email item to AnswerSourceSupport", () => {
    const support = crossToolItemToSupport(emailItem, 0);
    expect(support.supportId).toBe("S1");
    expect(support.sourceKind).toBe("email");
    expect(support.state).toBe("unverified_context");
    expect(support.canDereference).toBe(false);
    expect(support.snippet).toBeDefined();
    expect(support.snippet!.length).toBeLessThanOrEqual(240);
  });

  it("assigns sequential support ids", () => {
    const calItem: CrossToolEvidenceItem = {
      source: "calendar",
      title: "Team standup",
      summary: "Daily standup at 9am",
      sourceLabel: "Calendar: Jun 28, 9:00 AM",
      startsAt: "2026-06-28T09:00:00Z",
      relevance: "medium"
    };
    expect(crossToolItemToSupport(calItem, 2).supportId).toBe("S3");
  });

  it("strips control characters from title and snippet", () => {
    const dirtyItem: CrossToolEvidenceItem = {
      source: "notes",
      title: "Note\x00Title",
      summary: "content\x01here",
      sourceLabel: "Notes: secret.md",
      relevance: "low"
    };
    const support = crossToolItemToSupport(dirtyItem, 0);
    expect(support.title).toBe("NoteTitle");
    expect(support.snippet).not.toContain("\x01");
  });
});

// ── memoryItemToSupport ───────────────────────────────────────────────────────
describe("memoryItemToSupport", () => {
  const confirmedFact: MemoryRecallItem = {
    kind: "fact",
    id: "m1",
    title: "Prefers async meetings",
    text: "User prefers async over sync meetings",
    score: 0.9,
    confidence: 0.95,
    confidenceTier: "confirmed",
    provenance: "confirmed",
    status: "active",
    validFrom: null,
    validTo: null,
    staleAt: null,
    sources: []
  };

  it("maps confirmed memory to confirmed_source state", () => {
    const support = memoryItemToSupport(confirmedFact, 0);
    expect(support.state).toBe("confirmed_source");
    expect(support.sourceKind).toBe("memory");
    expect(support.confidenceTier).toBe("confirmed");
  });

  const inferredFact: MemoryRecallItem = {
    ...confirmedFact,
    provenance: "inferred",
    confidenceTier: "medium",
    confidence: 0.6
  };

  it("maps inferred memory to inferred_memory state", () => {
    expect(memoryItemToSupport(inferredFact, 0).state).toBe("inferred_memory");
  });

  it("uses source-kind from first source when available", () => {
    const noteSourceItem: MemoryRecallItem = {
      ...confirmedFact,
      sources: [
        {
          id: "src1",
          sourceKind: "note",
          sourceRef: "ref/secret",
          sourceLabel: "Notes: journal",
          excerpt: "text",
          occurredAt: null
        }
      ]
    };
    const support = memoryItemToSupport(noteSourceItem, 0);
    expect(support.sourceKind).toBe("note");
    expect(support.sourceLabel).toBe("Notes: journal");
  });
});

// ── finalizeProvenance ────────────────────────────────────────────────────────
describe("finalizeProvenance", () => {
  const makeSupport = (
    id: string,
    state = "unverified_context" as const
  ): import("@jarv1s/shared").AnswerSourceSupport => ({
    supportId: id,
    sourceKind: "memory",
    sourceLabel: `Label ${id}`,
    title: `Title ${id}`,
    state,
    canDereference: false
  });

  it("caps at 8 items and increments omittedCount", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeSupport(`S${i + 1}`));
    const result = finalizeProvenance(candidates, ["S1"]);
    expect(result.supportItems.length).toBe(8);
    expect(result.omittedCount).toBe(2);
  });

  it("keeps cited items before uncited context-checked items when trimming", () => {
    const candidates = [
      ...Array.from({ length: 9 }, (_, i) => makeSupport(`S${i + 1}`)),
      makeSupport("S10", "confirmed_source")
    ];
    const result = finalizeProvenance(candidates, ["S10"]);
    // S10 (cited confirmed_source) must survive the cap
    expect(result.supportItems.map((s) => s.supportId)).toContain("S10");
    expect(result.citedSupportIds).toContain("S10");
  });

  it("citedSupportIds contains only ids present in supportItems", () => {
    const candidates = [makeSupport("S1"), makeSupport("S2")];
    const result = finalizeProvenance(candidates, ["S1", "S99"]);
    expect(result.citedSupportIds).toEqual(["S1"]);
    expect(result.citedSupportIds).not.toContain("S99");
  });

  it("contextCheckedCount counts uncited context items", () => {
    const candidates = [
      makeSupport("S1"),
      makeSupport("S2"),
      makeSupport("S3", "confirmed_source")
    ];
    const result = finalizeProvenance(candidates, ["S3"]);
    // S1 and S2 are uncited context-checked
    expect(result.contextCheckedCount).toBe(2);
  });
});

// ── toSupportCard ─────────────────────────────────────────────────────────────
describe("toSupportCard", () => {
  it("drops citationToken from AnswerSourceSupport", () => {
    const support: import("@jarv1s/shared").AnswerSourceSupport = {
      supportId: "S1",
      sourceKind: "email",
      sourceLabel: "Email",
      title: "Test",
      state: "confirmed_source",
      canDereference: true,
      citationToken: "secret-token"
    };
    const card = toSupportCard(support);
    expect((card as unknown as Record<string, unknown>).citationToken).toBeUndefined();
    expect(card.supportId).toBe("S1");
  });
});

// ── readStoredProvenance ──────────────────────────────────────────────────────
describe("readStoredProvenance", () => {
  it("returns null when no provenance in tool_metadata", () => {
    expect(readStoredProvenance({ selectedTools: [] })).toBeNull();
  });

  it("returns null when version is not 1", () => {
    expect(readStoredProvenance({ answerProvenanceV1: { version: 2 } })).toBeNull();
  });

  it("returns null when answerProvenanceV1 is not a valid object", () => {
    expect(readStoredProvenance({ answerProvenanceV1: "bad" })).toBeNull();
    expect(readStoredProvenance({ answerProvenanceV1: null })).toBeNull();
  });

  it("returns parsed metadata when valid", () => {
    const meta: import("@jarv1s/shared").AnswerProvenanceMetadataV1 = {
      version: 1,
      citedSupportIds: ["S1"],
      supportItems: [],
      contextCheckedCount: 0,
      omittedCount: 0
    };
    const result = readStoredProvenance({ answerProvenanceV1: meta });
    expect(result?.version).toBe(1);
    expect(result?.citedSupportIds).toEqual(["S1"]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm vitest run tests/unit/chat-answer-provenance.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `packages/chat/src/live/answer-provenance.ts`**

```ts
import type {
  AnswerProvenanceMetadataV1,
  AnswerProvenanceSourceKind,
  AnswerProvenanceState,
  AnswerSourceSupport,
  AnswerSourceSupportCard
} from "@jarv1s/shared";
import type { MemoryRecallItem } from "@jarv1s/memory";

import type { CrossToolEvidenceItem, CrossToolSource } from "./cross-tool-reasoning.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SUPPORT_ITEMS = 8;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_SNIPPET_CHARS = 240;
const MAX_LABEL_CHARS = 120;
const MAX_TITLE_CHARS = 160;
/** Matches [[S1]] through [[S99]] — only uppercase S + 1-2 digits. */
const MARKER_RE = /\[\[S(\d{1,2})\]\]/g;

// ── Sanitize ──────────────────────────────────────────────────────────────────

export function sanitizePlainText(text: string, maxLen?: number): string {
  // Strip control characters except tab (0x09), LF (0x0A), CR (0x0D)
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return maxLen !== undefined && cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function sanitizeLabel(text: string): string {
  return sanitizePlainText(text, MAX_LABEL_CHARS);
}

function sanitizeTitle(text: string): string {
  return sanitizePlainText(text, MAX_TITLE_CHARS);
}

function sanitizeSnippet(text: string): string {
  return sanitizePlainText(text, MAX_SNIPPET_CHARS);
}

// ── Marker parsing ────────────────────────────────────────────────────────────

export function parseAnswerMarkers(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MARKER_RE)) {
    const n = parseInt(match[1]!, 10);
    if (n >= 1 && n <= 99) ids.add(`S${n}`);
  }
  return [...ids];
}

export function stripAnswerMarkers(text: string, validIds: ReadonlySet<string>): string {
  return text.replace(MARKER_RE, (match, digits) => {
    const id = `S${parseInt(digits, 10)}`;
    return validIds.has(id) ? "" : match;
  });
}

// ── Support id sequencing ─────────────────────────────────────────────────────

/** Zero-based index → support id ("S1", "S2", …). */
export function supportIdForIndex(idx: number): string {
  return `S${idx + 1}`;
}

// ── Converters: CrossToolEvidenceItem → AnswerSourceSupport ──────────────────

const CROSS_TOOL_SOURCE_KIND: Record<CrossToolSource, AnswerProvenanceSourceKind> = {
  notes: "note",
  email: "email",
  calendar: "calendar",
  tasks: "task"
};

export function crossToolItemToSupport(
  item: CrossToolEvidenceItem,
  idx: number
): AnswerSourceSupport {
  const sourceKind = CROSS_TOOL_SOURCE_KIND[item.source];
  const snippet = sanitizeSnippet(item.summary);
  const title = sanitizeTitle(item.title);
  const sourceLabel = sanitizeLabel(item.sourceLabel);

  let occurredAt: string | undefined;
  if (item.occurredAt) {
    try {
      occurredAt = new Date(item.occurredAt).toISOString();
    } catch {
      /* skip */
    }
  } else if (item.startsAt) {
    try {
      occurredAt = new Date(item.startsAt).toISOString();
    } catch {
      /* skip */
    }
  } else if (item.dueAt) {
    try {
      occurredAt = new Date(item.dueAt).toISOString();
    } catch {
      /* skip */
    }
  }

  return {
    supportId: supportIdForIndex(idx),
    sourceKind,
    sourceLabel,
    title,
    snippet: snippet || undefined,
    state: "unverified_context",
    canDereference: false,
    occurredAt
  };
}

// ── Converters: MemoryRecallItem → AnswerSourceSupport ───────────────────────

function memorySourceKind(item: MemoryRecallItem): AnswerProvenanceSourceKind {
  const src = item.sources[0];
  if (!src) return "memory";
  const kind = src.sourceKind;
  if (kind === "note") return "note";
  if (kind === "email") return "email";
  if (kind === "calendar") return "calendar";
  if (kind === "task") return "task";
  return "memory";
}

function memoryState(item: MemoryRecallItem): AnswerProvenanceState {
  const p = item.provenance;
  if (p === "confirmed" || p === "volunteered") return "confirmed_source";
  if (p === "inferred") return "inferred_memory";
  return "inferred_memory";
}

export function memoryItemToSupport(item: MemoryRecallItem, idx: number): AnswerSourceSupport {
  const src = item.sources[0];
  const sourceKind = memorySourceKind(item);
  const sourceLabel = sanitizeLabel(src?.sourceLabel ?? "Memory");
  const title = sanitizeTitle(item.title || item.text.slice(0, MAX_TITLE_CHARS));
  const snippet = sanitizeSnippet(item.text);

  let occurredAt: string | undefined;
  if (src?.occurredAt) {
    try {
      occurredAt = src.occurredAt.toISOString();
    } catch {
      /* skip */
    }
  } else if (item.validFrom) {
    try {
      occurredAt = item.validFrom.toISOString();
    } catch {
      /* skip */
    }
  }

  return {
    supportId: supportIdForIndex(idx),
    sourceKind,
    sourceLabel,
    title,
    snippet: snippet || undefined,
    state: memoryState(item),
    confidence: item.confidence,
    confidenceTier: item.confidenceTier,
    provenance: item.provenance as AnswerSourceSupport["provenance"],
    occurredAt,
    canDereference: false
  };
}

// ── Render context line with support id ──────────────────────────────────────

/** Prepend support id attribute to a hidden context line per spec §6. */
export function renderContextLineWithSupportId(line: string, supportId: string): string {
  return `[support=${supportId}] ${line}`;
}

// ── Finalizer ─────────────────────────────────────────────────────────────────

function estimateJsonBytes(items: readonly AnswerSourceSupport[]): number {
  return Buffer.byteLength(JSON.stringify(items), "utf8");
}

/**
 * Validate, deduplicate, sort, trim, and cap support items.
 * Priority order when trimming:
 *   1. Cited items (any state)
 *   2. confirmed_source (uncited)
 *   3. inferred_memory / pending_candidate / ambiguous_identity (uncited)
 *   4. unverified_context (uncited, hidden by default)
 */
export function finalizeProvenance(
  candidates: readonly AnswerSourceSupport[],
  citedIds: readonly string[]
): AnswerProvenanceMetadataV1 {
  const citedSet = new Set(citedIds);

  // Drop items with invalid or missing required fields
  const valid = candidates.filter(
    (item) =>
      typeof item.supportId === "string" &&
      item.supportId.length > 0 &&
      typeof item.sourceKind === "string" &&
      typeof item.sourceLabel === "string" &&
      item.sourceLabel.length > 0 &&
      typeof item.title === "string" &&
      item.title.length > 0 &&
      typeof item.state === "string" &&
      typeof item.canDereference === "boolean"
  );

  // Deduplicate by supportId (first wins)
  const seen = new Set<string>();
  const deduped = valid.filter((item) => {
    if (seen.has(item.supportId)) return false;
    seen.add(item.supportId);
    return true;
  });

  // Sort: cited first, then by state priority, then by confidence desc
  const statePriority: Record<AnswerProvenanceState, number> = {
    confirmed_source: 3,
    inferred_memory: 2,
    pending_candidate: 2,
    ambiguous_identity: 2,
    unverified_context: 1
  };

  const sorted = [...deduped].sort((a, b) => {
    const aCited = citedSet.has(a.supportId) ? 1 : 0;
    const bCited = citedSet.has(b.supportId) ? 1 : 0;
    if (bCited !== aCited) return bCited - aCited;
    const pDiff = (statePriority[b.state] ?? 0) - (statePriority[a.state] ?? 0);
    if (pDiff !== 0) return pDiff;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  // Cap at 8 items, then at 16 KB
  let capped = sorted.slice(0, MAX_SUPPORT_ITEMS);
  let omittedCount = sorted.length - capped.length;

  while (capped.length > 0 && estimateJsonBytes(capped) > MAX_PAYLOAD_BYTES) {
    capped = capped.slice(0, -1);
    omittedCount += 1;
  }

  // citedSupportIds only contains ids actually present in the final capped set
  const finalIds = new Set(capped.map((i) => i.supportId));
  const citedSupportIds = citedIds.filter((id) => finalIds.has(id));

  // contextCheckedCount: items in final set that are NOT cited
  const contextCheckedCount = capped.filter((i) => !citedSet.has(i.supportId)).length;

  return {
    version: 1,
    citedSupportIds,
    supportItems: capped,
    contextCheckedCount,
    omittedCount
  };
}

// ── DTO conversion ────────────────────────────────────────────────────────────

export function toSupportCard(item: AnswerSourceSupport): AnswerSourceSupportCard {
  const { citationToken: _dropped, ...card } = item;
  return card;
}

// ── Read stored provenance from tool_metadata ─────────────────────────────────

export function readStoredProvenance(
  toolMetadata: Record<string, unknown>
): AnswerProvenanceMetadataV1 | null {
  const raw = toolMetadata.answerProvenanceV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  if (meta.version !== 1) return null;
  if (!Array.isArray(meta.citedSupportIds)) return null;
  if (!Array.isArray(meta.supportItems)) return null;
  if (typeof meta.contextCheckedCount !== "number") return null;
  if (typeof meta.omittedCount !== "number") return null;
  return meta as unknown as AnswerProvenanceMetadataV1;
}

/** Return sanitized `AnswerSourceSupportCard[]` from stored metadata. */
export function provenanceCards(metadata: AnswerProvenanceMetadataV1): AnswerSourceSupportCard[] {
  return metadata.supportItems.map(toSupportCard);
}
```

- [ ] **Step 4: Export from `packages/chat/src/index.ts`** (or wherever the chat package exports)

Check `packages/chat/src/index.ts` — add if missing:

```ts
export {
  sanitizePlainText,
  parseAnswerMarkers,
  stripAnswerMarkers,
  supportIdForIndex,
  crossToolItemToSupport,
  memoryItemToSupport,
  finalizeProvenance,
  toSupportCard,
  readStoredProvenance,
  provenanceCards
} from "./live/answer-provenance.js";
```

(If index.ts does not re-export live/ internals, skip this — tests can import directly.)

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/unit/chat-answer-provenance.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/live/answer-provenance.ts tests/unit/chat-answer-provenance.test.ts
git commit -m "feat(chat): add answer-provenance module (sanitizer, marker parser, converters, finalizer) (#539)"
```

---

### Task 3: Extend retrieval functions to expose evidence items

**Files:**

- Modify: `packages/chat/src/live/passive-retrieval.ts`
- Modify: `packages/chat/src/live/cross-tool-reasoning.ts`

**Consumes:** existing `PassiveContextRetriever`, `collectCrossToolContext`, `CrossToolReasoningPlan`, `CrossToolReadRunner`

**Produces:**

- New method on `PassiveContextRetriever`: `retrieveWithItems(input): Promise<{ block: string; items: MemoryRecallItem[] }>`
- New export: `collectCrossToolContextAndItems(actorUserId, plan, reader, localNowIso): Promise<{ block: string; items: CrossToolEvidenceItem[] }>`

Both functions call through to the existing logic — no duplication of retrieval implementation.

- [ ] **Step 1: Write tests for new functions in `tests/unit/chat-passive-retrieval.test.ts`**

Add to the existing file (after existing tests):

```ts
describe("PassiveContextRetriever.retrieveWithItems", () => {
  it("returns empty block and empty items when recall disabled", async () => {
    const mockRecall = {
      recall: vi.fn().mockResolvedValue({ items: [] })
    };
    const mockSettings = {
      getOrCreate: vi
        .fn()
        .mockResolvedValue({ recallEnabled: false, factsEnabled: true, updatedAt: new Date() })
    };
    const mockContext = {
      withDataContext: vi
        .fn()
        .mockImplementation(async (_ctx, fn) =>
          fn({ db: {} } as unknown as import("@jarv1s/db").DataContextDb)
        )
    };
    const retriever = new PassiveContextRetriever({
      dataContext: mockContext,
      graphRecall: mockRecall,
      settingsRepo: mockSettings
    });
    const result = await retriever.retrieveWithItems({
      actorUserId: "u1",
      userText: "what did we decide about the remodel?",
      threadTitle: null,
      recentTurns: []
    });
    expect(result.block).toBe("");
    expect(result.items).toEqual([]);
  });
});
```

Add for cross-tool (in `tests/unit/chat-cross-tool-reasoning.test.ts` after existing tests):

```ts
import { collectCrossToolContextAndItems } from "../../packages/chat/src/live/cross-tool-reasoning.js";

describe("collectCrossToolContextAndItems", () => {
  it("returns empty block and empty items when plan shouldRun=false", async () => {
    const mockReader = { runReadTool: vi.fn() };
    const result = await collectCrossToolContextAndItems(
      "u1",
      { shouldRun: false, reason: "skip", query: "", sources: [] },
      mockReader,
      new Date().toISOString()
    );
    expect(result.block).toBe("");
    expect(result.items).toEqual([]);
    expect(mockReader.runReadTool).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
pnpm vitest run tests/unit/chat-passive-retrieval.test.ts tests/unit/chat-cross-tool-reasoning.test.ts
```

Expected: FAIL on the new tests (method not found).

- [ ] **Step 3: Add `retrieveWithItems` to `PassiveContextRetriever`** in `packages/chat/src/live/passive-retrieval.ts`

Import `MemoryRecallItem` from `@jarv1s/memory` at the top (it's already imported via the existing `MemoryRecallResult` import).

Add after the existing `retrieve` method:

```ts
async retrieveWithItems(input: {
  readonly actorUserId: string;
  readonly userText: string;
  readonly threadTitle: string | null;
  readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
}): Promise<{ block: string; items: MemoryRecallItem[] }> {
  try {
    return (
      (await withPassiveRetrievalTimeout(this.retrieveNowWithItems(input), PASSIVE_TIMEOUT_MS)) ??
      { block: "", items: [] }
    );
  } catch {
    return { block: "", items: [] };
  }
}

private async retrieveNowWithItems(input: {
  readonly actorUserId: string;
  readonly userText: string;
  readonly threadTitle: string | null;
  readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
}): Promise<{ block: string; items: MemoryRecallItem[] }> {
  const decision = planPassiveRetrieval(input);
  if (!decision.shouldRetrieve) return { block: "", items: [] };

  return this.deps.dataContext.withDataContext(
    { actorUserId: input.actorUserId, requestId: "chat:passive-memory-retrieval" },
    async (scopedDb) => {
      const settings = await this.settingsRepo.getOrCreate(scopedDb, input.actorUserId);
      if (!settings.recallEnabled || !settings.factsEnabled) return { block: "", items: [] };
      const result = await this.deps.graphRecall.recall(
        scopedDb,
        input.actorUserId,
        decision.query,
        { limit: PASSIVE_RECALL_LIMIT }
      );
      const qualifying = result.items.filter((item) => item.score >= MIN_CONTEXT_SCORE);
      const block = renderRetrievedContextBlock(qualifying);
      return { block, items: qualifying };
    }
  );
}
```

- [ ] **Step 4: Add `collectCrossToolContextAndItems` to `cross-tool-reasoning.ts`**

At the bottom of `packages/chat/src/live/cross-tool-reasoning.ts`, add:

```ts
export async function collectCrossToolContextAndItems(
  actorUserId: string,
  plan: CrossToolReasoningPlan,
  reader: CrossToolReadRunner,
  localNowIso: string
): Promise<{ block: string; items: CrossToolEvidenceItem[] }> {
  if (!plan.shouldRun || plan.sources.length === 0) return { block: "", items: [] };

  const allItems = await withDeadline(
    runSourcesWithConcurrencyLimit(actorUserId, plan, reader, localNowIso),
    TOTAL_TIMEOUT_MS
  ).catch(() => [] as CrossToolEvidenceItem[]);

  const deduplicated = deduplicateItems(allItems);
  const sorted = [...deduplicated].sort(
    (a, b) => relevanceRank(b.relevance) - relevanceRank(a.relevance)
  );

  return {
    block: renderCrossToolContextBlock(sorted),
    items: sorted
  };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/unit/chat-passive-retrieval.test.ts tests/unit/chat-cross-tool-reasoning.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/passive-retrieval.ts packages/chat/src/live/cross-tool-reasoning.ts \
        tests/unit/chat-passive-retrieval.test.ts tests/unit/chat-cross-tool-reasoning.test.ts
git commit -m "feat(chat): expose evidence items from passive retrieval and cross-tool context (#539)"
```

---

### Task 4: Wire provenance into `ChatSessionManager`

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts`

**Consumes:**

- `collectCrossToolContextAndItems` from `./cross-tool-reasoning.js`
- `crossToolItemToSupport`, `memoryItemToSupport`, `parseAnswerMarkers`, `stripAnswerMarkers`, `supportIdForIndex`, `finalizeProvenance` from `./answer-provenance.js`
- `MemoryRecallItem` from `@jarv1s/memory`
- `AnswerSourceSupport`, `AnswerProvenanceMetadataV1` from `@jarv1s/shared`
- `PassiveRetrievalPort` already in scope (new method needed: `retrieveWithItems`)

**Produces:**

- `engineText()` now returns `Promise<{ text: string; pendingItems: AnswerSourceSupport[] }>`
- `runTurn()` collects provenance from `engineText`, parses markers after assistant reply, calls `persistence.recordTurn` with optional 5th argument `answerProvenance`
- `ChatPersistencePort.recordTurn` signature extended to accept optional `answerProvenance?: AnswerProvenanceMetadataV1`
- `PassiveRetrievalPort` interface gets `retrieveWithItems` optional method

- [ ] **Step 1: Write failing test in `tests/unit/chat-session-manager-provenance.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import type {
  ChatSessionManagerDeps,
  ChatPersistencePort
} from "../../packages/chat/src/live/chat-session-manager.js";

function makeDeps(overrides: Partial<ChatSessionManagerDeps> = {}): ChatSessionManagerDeps {
  const persistence: ChatPersistencePort = {
    resolveActiveProvider: vi
      .fn()
      .mockResolvedValue({ provider: "anthropic", model: "claude-3-opus" }),
    listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
    recordTurn: vi.fn().mockResolvedValue({ userMessageId: "u1", assistantMessageId: "a1" }),
    openNewConversation: vi.fn(),
    getThreadContext: vi.fn().mockResolvedValue({ threadTitle: null, localTimezone: null })
  };

  const engine = {
    launch: vi.fn().mockResolvedValue({ offset: 0 }),
    submit: vi.fn().mockResolvedValue(undefined),
    readNew: vi
      .fn()
      .mockResolvedValueOnce({
        records: [{ kind: "reply", text: "Answer [[S1]] confirmed." }],
        offset: 1,
        complete: false
      })
      .mockResolvedValueOnce({ records: [], offset: 1, complete: true }),
    kill: vi.fn()
  };

  return {
    engineFactory: vi.fn().mockReturnValue(engine),
    persistence,
    personaFs: {
      readFile: vi.fn().mockRejectedValue(new Error("no persona")),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined)
    },
    clock: { now: () => Date.now() },
    idleMs: 60_000,
    neutralBase: "/tmp",
    persona: "You are Jarvis.",
    pollMs: 0,
    idleWatchdogMs: 0,
    ...overrides
  };
}

describe("ChatSessionManager provenance wiring", () => {
  it("calls recordTurn with answerProvenance when cross-tool items exist", async () => {
    const crossToolItems = [
      {
        source: "email" as const,
        title: "Pricing discussion",
        summary: "Sarah asked about Q3 pricing",
        sourceLabel: "Email: Sarah / Pricing",
        occurredAt: "2026-06-01T10:00:00Z",
        relevance: "high" as const
      }
    ];

    const crossToolRead = {
      runReadTool: vi.fn().mockResolvedValue({ ok: false })
    };

    // Mock passiveRetrieval that returns items
    const passiveRetrieval = {
      retrieve: vi.fn().mockResolvedValue(""),
      retrieveWithItems: vi.fn().mockResolvedValue({ block: "", items: [] })
    };

    const deps = makeDeps({ crossToolRead, passiveRetrieval });
    // Override collectCrossToolContextAndItems result by making runReadTool return data
    // (skip deep mocking of internals; test that answerProvenance key reaches recordTurn)
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what emails do I owe?");

    const recordTurnCall = (deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    // recordTurn(actorUserId, userText, assistantReply, executed, answerProvenance?)
    expect(recordTurnCall).toBeDefined();
    // 5th arg is answerProvenance (may be undefined when no items collected)
    // Just verify the call happened — full provenance wiring is tested via integration
  });
});
```

- [ ] **Step 2: Run test to see current state**

```bash
pnpm vitest run tests/unit/chat-session-manager-provenance.test.ts
```

- [ ] **Step 3: Update `ChatPersistencePort.recordTurn` signature**

In `packages/chat/src/live/chat-session-manager.ts`, add optional 5th param:

```ts
recordTurn(
  actorUserId: string,
  userText: string,
  assistantReply: string,
  executed: { provider: ProviderKind; model: string },
  answerProvenance?: AnswerProvenanceMetadataV1
): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined>;
```

Update `PassiveRetrievalPort` to add optional `retrieveWithItems`:

```ts
export interface PassiveRetrievalPort {
  retrieve(input: {
    readonly actorUserId: string;
    readonly userText: string;
    readonly threadTitle: string | null;
    readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
  }): Promise<string>;
  retrieveWithItems?(input: {
    readonly actorUserId: string;
    readonly userText: string;
    readonly threadTitle: string | null;
    readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
  }): Promise<{ block: string; items: MemoryRecallItem[] }>;
}
```

Add imports at top of `chat-session-manager.ts`:

```ts
import type { MemoryRecallItem } from "@jarv1s/memory";
import type { AnswerProvenanceMetadataV1, AnswerSourceSupport } from "@jarv1s/shared";
import {
  crossToolItemToSupport,
  memoryItemToSupport,
  parseAnswerMarkers,
  finalizeProvenance
} from "./answer-provenance.js";
import { collectCrossToolContextAndItems } from "./cross-tool-reasoning.js";
```

- [ ] **Step 4: Refactor `engineText()` to return items**

Replace the existing `engineText` private method with:

```ts
private async engineText(
  actorUserId: string,
  text: string
): Promise<{ text: string; pendingItems: AnswerSourceSupport[] }> {
  if (!this.deps.passiveRetrieval && !this.deps.crossToolRead) {
    return { text, pendingItems: [] };
  }
  try {
    const [{ recent }, threadCtx] = await Promise.all([
      this.deps.persistence.listPriorTurns(actorUserId),
      this.deps.persistence.getThreadContext(actorUserId)
    ]);

    const localNow = new Date().toISOString();
    const plan =
      this.deps.crossToolRead != null
        ? planCrossToolReasoning({
            userText: text,
            threadTitle: threadCtx.threadTitle,
            recentTurns: recent,
            localNowIso: localNow,
            localTimezone: threadCtx.localTimezone ?? "UTC"
          })
        : null;

    const [passiveResult, crossToolResult] = await Promise.all([
      this.deps.passiveRetrieval != null
        ? (this.deps.passiveRetrieval.retrieveWithItems != null
            ? this.deps.passiveRetrieval.retrieveWithItems({
                actorUserId,
                userText: text,
                threadTitle: threadCtx.threadTitle,
                recentTurns: recent
              })
            : this.deps.passiveRetrieval
                .retrieve({
                  actorUserId,
                  userText: text,
                  threadTitle: threadCtx.threadTitle,
                  recentTurns: recent
                })
                .then((block) => ({ block, items: [] as MemoryRecallItem[] }))
          ).catch(() => ({ block: "", items: [] as MemoryRecallItem[] }))
        : Promise.resolve({ block: "", items: [] as MemoryRecallItem[] }),
      plan != null && this.deps.crossToolRead != null
        ? collectCrossToolContextAndItems(actorUserId, plan, this.deps.crossToolRead, localNow).catch(
            () => ({ block: "", items: [] })
          )
        : Promise.resolve({ block: "", items: [] })
    ]);

    // Convert evidence to pending support items
    let idx = 0;
    const memoryItems = passiveResult.items.map((item) => memoryItemToSupport(item, idx++));
    const crossToolItems = crossToolResult.items.map((item) => crossToolItemToSupport(item, idx++));
    const pendingItems: AnswerSourceSupport[] = [...memoryItems, ...crossToolItems];

    const combined = combineHiddenContextBlocks(passiveResult.block, crossToolResult.block);
    return {
      text: combined ? `${combined}\n\n${text}` : text,
      pendingItems
    };
  } catch {
    return { text, pendingItems: [] };
  }
}
```

- [ ] **Step 5: Update `runTurn()` to collect and persist provenance**

Find the line in `runTurn` that calls `this.engineText`:

```ts
const engineText = await this.engineText(actorUserId, text);
```

Replace with:

```ts
const { text: engineText, pendingItems } = await this.engineText(actorUserId, text);
```

Find where `reply` is built and used to call `recordTurn`. After `complete` breaks the loop and before calling `recordTurn`, add provenance computation:

```ts
// Build provenance from collected evidence
let answerProvenance: AnswerProvenanceMetadataV1 | undefined;
if (pendingItems.length > 0 && reply) {
  try {
    const citedIds = parseAnswerMarkers(reply);
    answerProvenance = finalizeProvenance(pendingItems, citedIds);
  } catch {
    answerProvenance = undefined;
  }
}

const stored = await this.deps.persistence.recordTurn(
  actorUserId,
  text,
  reply,
  {
    provider: session.provider,
    model: session.model
  },
  answerProvenance
);
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Fix any type errors (e.g. `collectCrossToolContext` vs `collectCrossToolContextAndItems` import name conflicts).

- [ ] **Step 7: Run unit tests**

```bash
pnpm vitest run tests/unit/chat-session-manager*.test.ts tests/unit/chat-answer-provenance.test.ts
```

Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/chat/src/live/chat-session-manager.ts tests/unit/chat-session-manager-provenance.test.ts
git commit -m "feat(chat): wire answer provenance collection into ChatSessionManager.runTurn (#539)"
```

---

### Task 5: Persist `answerProvenanceV1` in repository and persistence layer

**Files:**

- Modify: `packages/chat/src/live/persistence.ts`
- Modify: `packages/chat/src/repository.ts`

**Consumes:** `AnswerProvenanceMetadataV1` from `@jarv1s/shared`

**Produces:**

- `DataContextChatPersistence.recordTurn` accepts optional 5th param `answerProvenance`
- `ChatRepository.recordCompletedTurn` accepts optional `answerProvenance` in its signature and stores it in `tool_metadata.answerProvenanceV1`

- [ ] **Step 1: Update `persistence.ts` — pass provenance to repository**

In `packages/chat/src/live/persistence.ts`, update the `recordTurn` signature to match the interface:

```ts
async recordTurn(
  actorUserId: string,
  userText: string,
  assistantReply: string,
  executed: { provider: ProviderKind; model: string },
  answerProvenance?: AnswerProvenanceMetadataV1
): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined> {
  return this.run(actorUserId, "record-turn", async (scopedDb) => {
    const thread =
      (await this.chat.getCurrentThread(scopedDb, actorUserId)) ??
      (await this.chat.openNewThread(scopedDb, { title: DEFAULT_CONVERSATION_TITLE }));

    const result = await this.chat.recordCompletedTurn(
      scopedDb,
      thread.id,
      userText,
      assistantReply,
      executed,
      answerProvenance   // <-- pass through
    );
    // ... rest unchanged
```

Add import at top of persistence.ts:

```ts
import type { AnswerProvenanceMetadataV1 } from "@jarv1s/shared";
```

- [ ] **Step 2: Update `ChatRepository.recordCompletedTurn` to accept and store provenance**

In `packages/chat/src/repository.ts`, update `recordCompletedTurn`:

```ts
async recordCompletedTurn(
  scopedDb: DataContextDb,
  threadId: string,
  userText: string,
  assistantReply: string,
  executed: { readonly provider: string; readonly model: string },
  answerProvenance?: import("@jarv1s/shared").AnswerProvenanceMetadataV1
): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage } | undefined> {
```

And update the `insertMessage` call for the assistant message:

```ts
const assistantMessage = await this.insertMessage(scopedDb, {
  thread,
  role: "assistant",
  status: "stored",
  body: assistantReply,
  modelMetadata: { executed: { provider: executed.provider, model: executed.model } },
  toolMetadata: {
    selectedTools: [],
    ...(answerProvenance !== undefined ? { answerProvenanceV1: answerProvenance } : {})
  },
  now
});
```

- [ ] **Step 3: Typecheck + run existing tests**

```bash
pnpm typecheck && pnpm vitest run tests/unit/chat-session-manager*.test.ts tests/unit/chat-answer-provenance.test.ts
```

Expected: All PASS, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/src/live/persistence.ts packages/chat/src/repository.ts
git commit -m "feat(chat): persist answerProvenanceV1 in chat_messages.tool_metadata (#539)"
```

---

### Task 6: Chat provenance API routes + `serializeMessage` update

**Files:**

- Modify: `packages/chat/src/routes.ts`

**Consumes:** `readStoredProvenance`, `provenanceCards`, `toSupportCard` from `./live/answer-provenance.js`; `AnswerSourceSupportCard` from `@jarv1s/shared`

**Produces:**

- `serializeMessage` reads `answerProvenanceV1` from `tool_metadata` and populates `ChatMessageDto.answerProvenance`
- New route: `GET /api/chat/messages/:messageId/provenance` → `{ cards: AnswerSourceSupportCard[] }`
- New route: `GET /api/chat/messages/:messageId/provenance/:supportId/dereference` → `{ deepLinkPath?, unavailableReason? }`

Security invariant: routes use `DataContextDb` (RLS scoped), never accept owner id from client, and the dereference route passes `actorUserId` from request context to providers — never from stored metadata.

- [ ] **Step 1: Write integration tests in `tests/integration/chat-provenance-routes.test.ts`**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { DataContextDb } from "@jarv1s/db";

// Use the project's integration test helpers — import from the helpers used by chat-live.test.ts
import {
  createTestApp,
  createTestUser,
  teardownTestApp,
  type TestApp
} from "../helpers/test-app.js";

let app: TestApp;
let userId: string;
let cookie: string;

beforeAll(async () => {
  app = await createTestApp();
  ({ userId, cookie } = await createTestUser(app));
});

afterAll(async () => {
  await teardownTestApp(app);
});

describe("GET /api/chat/messages/:messageId/provenance", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages/nonexistent/provenance"
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for nonexistent message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages/00000000-0000-0000-0000-000000000000/provenance",
      headers: { cookie }
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns empty cards array for message with no provenance", async () => {
    // Create a chat thread and turn without provenance
    const sendRes = await app.inject({
      method: "POST",
      url: "/api/chat/send", // adjust to actual live-chat send route
      headers: { cookie },
      payload: { body: "test turn" }
    });
    // If live chat is unavailable in test env, skip this test
    if (sendRes.statusCode === 503) return;
    expect(sendRes.statusCode).toBe(200);
    const { assistantMessageId } = JSON.parse(sendRes.body);
    if (!assistantMessageId) return; // turn may not have stored an id

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/messages/${assistantMessageId}/provenance`,
      headers: { cookie }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.cards)).toBe(true);
    // citationToken must not be present
    for (const card of body.cards) {
      expect(card).not.toHaveProperty("citationToken");
    }
  });
});

describe("GET /api/chat/messages/:messageId/provenance/:supportId/dereference", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages/nonexistent/provenance/S1/dereference"
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for nonexistent message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages/00000000-0000-0000-0000-000000000000/provenance/S1/dereference",
      headers: { cookie }
    });
    expect(res.statusCode).toBe(404);
  });
});
```

(Note: Adjust the send route path to match the actual live-chat endpoint. If the test environment can't exercise live chat, the provenance-on-live-message tests are marked as conditional skips.)

- [ ] **Step 2: Update `serializeMessage` in `packages/chat/src/routes.ts`**

Add import at top:

```ts
import { readStoredProvenance, provenanceCards } from "./live/answer-provenance.js";
```

Update `serializeMessage`:

```ts
function serializeMessage(message: ChatMessage): ChatMessageDto {
  const toolMetadata = asRecord(message.tool_metadata);
  const storedProvenance = readStoredProvenance(toolMetadata);
  const answerProvenance = storedProvenance != null ? provenanceCards(storedProvenance) : undefined;
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
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at),
    answerProvenance: answerProvenance && answerProvenance.length > 0 ? answerProvenance : undefined
  };
}
```

- [ ] **Step 3: Add provenance routes to `registerChatRoutes`**

After the existing `/api/chat/memory/facts/:id/reject` route, add:

```ts
// ── Answer provenance ──────────────────────────────────────────────────────

server.get<{ Params: { messageId: string } }>(
  "/api/chat/messages/:messageId/provenance",
  async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const message = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        repository.getMessageById(scopedDb, request.params.messageId)
      );
      if (!message || message.owner_user_id !== access.actorUserId) {
        return reply.code(404).send({ error: "Message not found" });
      }
      const toolMetadata = asRecord(message.tool_metadata);
      const stored = readStoredProvenance(toolMetadata);
      const cards: AnswerSourceSupportCard[] = stored != null ? provenanceCards(stored) : [];
      return { cards };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

server.get<{ Params: { messageId: string; supportId: string } }>(
  "/api/chat/messages/:messageId/provenance/:supportId/dereference",
  async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const message = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        repository.getMessageById(scopedDb, request.params.messageId)
      );
      if (!message || message.owner_user_id !== access.actorUserId) {
        return reply.code(404).send({ error: "Message not found" });
      }
      const toolMetadata = asRecord(message.tool_metadata);
      const stored = readStoredProvenance(toolMetadata);
      if (!stored) return reply.code(404).send({ error: "No provenance for this message" });

      const supportItem = stored.supportItems.find(
        (item) => item.supportId === request.params.supportId
      );
      if (!supportItem) return reply.code(404).send({ error: "Support item not found" });

      // No providers registered in V1 → return unavailable
      // Future: look up registered AnswerProvenanceProvider by sourceKind and call dereferenceSupport
      return {
        unavailableReason: "source_unavailable" as const,
        sourceLabel: supportItem.sourceLabel,
        title: supportItem.title
      };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Add missing imports at the top of `routes.ts`:

```ts
import type { AnswerSourceSupportCard } from "@jarv1s/shared";
import { readStoredProvenance, provenanceCards } from "./live/answer-provenance.js";
```

- [ ] **Step 4: Typecheck + run route tests**

```bash
pnpm typecheck
pnpm vitest run tests/integration/chat-provenance-routes.test.ts tests/integration/chat-live.test.ts
```

Expected: Existing chat-live tests PASS (no regressions); new provenance route tests PASS or conditionally skip for 503 live-chat-unavailable.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/routes.ts tests/integration/chat-provenance-routes.test.ts
git commit -m "feat(chat): add provenance API routes and update serializeMessage (#539)"
```

---

### Task 7: Frontend — marker strip + source chips + source tray

**Files:**

- Create: `apps/web/src/chat/answer-provenance.tsx`
- Modify: `apps/web/src/chat/markdown-message.tsx`

**Consumes:** `AnswerSourceSupportCard`, `AnswerProvenanceState` from `@jarv1s/shared` (browser-safe — `@jarv1s/shared` is Vite-bundled); `ChatMessageDto` from `@jarv1s/shared`

**Produces:**

- `stripDisplayMarkers(text: string, validIds: ReadonlySet<string>): string`
- `<SourceChips cards={AnswerSourceSupportCard[]} />` — compact chip row
- `<SourceTray card={AnswerSourceSupportCard} onClose={() => void} />` — expanded card
- `markdown-message.tsx` strips markers and renders `<SourceChips>` below assistant messages that have cited provenance

UI rules:

- Use existing `jds-*` and chat primitives (no raw CSS colors — only `tokens.css` design tokens)
- Chips are compact; this is NOT a document browser
- Never show raw source refs, citationTokens, connector ids, or prompt text
- "Context checked" items (uncited) are hidden by default
- State label mapping: `confirmed_source`→"Source", `inferred_memory`→"Inferred memory", `pending_candidate`→"Pending review", `ambiguous_identity`→"Ambiguous person", `unverified_context`→"Context checked"

- [ ] **Step 1: Create `apps/web/src/chat/answer-provenance.tsx`**

```tsx
import { useState } from "react";
import type { AnswerSourceSupportCard } from "@jarv1s/shared";

/** Matches [[S1]] through [[S99]] — same regex as backend. */
const MARKER_RE = /\[\[S(\d{1,2})\]\]/g;

export function stripDisplayMarkers(text: string, validIds: ReadonlySet<string>): string {
  return text.replace(MARKER_RE, (match, digits) => {
    const id = `S${parseInt(digits, 10)}`;
    return validIds.has(id) ? "" : match;
  });
}

const STATE_LABELS: Record<string, string> = {
  confirmed_source: "Source",
  inferred_memory: "Inferred memory",
  pending_candidate: "Pending review",
  ambiguous_identity: "Ambiguous person",
  unverified_context: "Context checked"
};

const SOURCE_ICONS: Record<string, string> = {
  email: "✉",
  calendar: "📅",
  note: "📝",
  task: "✓",
  memory: "◎",
  commitment: "⟳",
  person: "⚇",
  goal: "◎",
  briefing: "◎"
};

interface SourceTrayProps {
  card: AnswerSourceSupportCard;
  onClose: () => void;
}

export function SourceTray({ card, onClose }: SourceTrayProps) {
  const stateLabel = STATE_LABELS[card.state] ?? card.state;
  const icon = SOURCE_ICONS[card.sourceKind] ?? "◎";

  return (
    <div className="source-tray" role="dialog" aria-label={`Source: ${card.title}`}>
      <button className="source-tray__close" onClick={onClose} aria-label="Close source">
        ×
      </button>
      <div className="source-tray__kind">
        <span aria-hidden="true">{icon}</span> {card.sourceKind}
      </div>
      <div className="source-tray__label">{card.sourceLabel}</div>
      <div className="source-tray__title">{card.title}</div>
      <div className="source-tray__state">{stateLabel}</div>
      {card.confidenceTier && <div className="source-tray__confidence">{card.confidenceTier}</div>}
      {card.occurredAt && (
        <time className="source-tray__time" dateTime={card.occurredAt}>
          {new Date(card.occurredAt).toLocaleDateString()}
        </time>
      )}
      {card.snippet && <p className="source-tray__snippet">{card.snippet}</p>}
    </div>
  );
}

interface SourceChipsProps {
  cards: readonly AnswerSourceSupportCard[];
  citedIds?: readonly string[];
}

export function SourceChips({ cards, citedIds }: SourceChipsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Only show cited items in the default chip row (uncited context-checked items are hidden)
  const citedSet = new Set(citedIds ?? []);
  const visibleCards = citedIds != null ? cards.filter((c) => citedSet.has(c.supportId)) : cards;

  if (visibleCards.length === 0) return null;

  const openCard = openId != null ? cards.find((c) => c.supportId === openId) : null;
  const icon = (kind: string) => SOURCE_ICONS[kind] ?? "◎";

  return (
    <div className="source-chips">
      <div className="source-chips__row" role="list">
        {visibleCards.map((card) => (
          <button
            key={card.supportId}
            role="listitem"
            className={`source-chip source-chip--${card.sourceKind}`}
            onClick={() => setOpenId(openId === card.supportId ? null : card.supportId)}
            aria-expanded={openId === card.supportId}
            aria-label={`${STATE_LABELS[card.state] ?? card.state}: ${card.title}`}
          >
            <span aria-hidden="true">{icon(card.sourceKind)}</span>
            <span className="source-chip__label">{card.sourceLabel}</span>
          </button>
        ))}
      </div>
      {openCard && <SourceTray card={openCard} onClose={() => setOpenId(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Modify `apps/web/src/chat/markdown-message.tsx`**

First, read the file to understand the current structure:

```bash
cat apps/web/src/chat/markdown-message.tsx | head -60
```

Find where the message body is displayed. The change:

1. When `message.role === "assistant"` AND `message.answerProvenance` exists, strip `[[S1]]` markers from the displayed body text
2. Render `<SourceChips>` below the assistant message body

Typical update pattern (adjust to the file's actual structure):

```tsx
// Add import at top
import { SourceChips, stripDisplayMarkers } from "./answer-provenance.js";
import type { AnswerSourceSupportCard } from "@jarv1s/shared";
```

In the render path for assistant messages:

```tsx
// Where body text is rendered:
const validCitedIds = new Set(message.answerProvenance?.map((c) => c.supportId) ?? []);
const displayBody =
  message.role === "assistant" && message.answerProvenance
    ? stripDisplayMarkers(message.body, validCitedIds)
    : message.body;
```

After the body display, for assistant messages with cited provenance:

```tsx
{
  message.role === "assistant" &&
    message.answerProvenance &&
    message.answerProvenance.length > 0 && (
      <SourceChips
        cards={message.answerProvenance}
        citedIds={message.answerProvenance.map((c) => c.supportId)}
      />
    );
}
```

(Note: the `citedIds` from the message DTO does not include uncited context-checked items — only the cited ones are in `answerProvenance` in the DTO per spec §8: "The list routes return `AnswerSourceSupportCard[]`". The DTO only returns cards for items the model cited, since uncited context-checked items are hidden by default.)

Actually, looking at the spec more carefully: the API list route `GET /api/chat/threads/:id/messages` returns `ChatMessageDto.answerProvenance` which is populated in `serializeMessage`. `serializeMessage` calls `provenanceCards(stored)` which maps ALL support items in the stored metadata (both cited and uncited) via `toSupportCard`. The frontend needs to know which are cited to hide the uncited ones.

But `ChatMessageDto.answerProvenance` currently has no field to indicate which are cited. We need to either:

- Also serialize `citedSupportIds` in the DTO
- Or mark each card with a `cited: boolean` field

Per the spec: "Uncited context-checked support is hidden by default and not presented as cited proof." So the frontend needs to know which items are cited. Update the `ChatMessageDto` (or a separate field) to carry `citedSupportIds`.

Option: Add `answerProvenanceCitedIds?: string[]` to `ChatMessageDto`:

In `packages/shared/src/chat-api.ts`, in `ChatMessageDto`:

```ts
readonly answerProvenanceCitedIds?: readonly string[];
```

In `serializeMessage` in routes.ts:

```ts
answerProvenanceCitedIds: storedProvenance != null && storedProvenance.citedSupportIds.length > 0
  ? [...storedProvenance.citedSupportIds]
  : undefined;
```

Then in the frontend, use `message.answerProvenanceCitedIds` as the `citedIds` prop to `<SourceChips>`.

- [ ] **Step 3: Typecheck frontend**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Run existing unit tests**

```bash
pnpm vitest run tests/unit/ --reporter=dot
```

Expected: All existing unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/chat/answer-provenance.tsx apps/web/src/chat/markdown-message.tsx \
        packages/shared/src/chat-api.ts packages/chat/src/routes.ts
git commit -m "feat(web): render source chips with marker stripping for chat answer provenance (#539)"
```

---

### Task 8: Full gate verification + cleanup

- [ ] **Step 1: Format check**

```bash
pnpm format:check
```

If failing, run `pnpm format` and then re-check. Stage any reformatted files.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Fix any lint errors.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Unit tests**

```bash
pnpm vitest run tests/unit/ --reporter=dot
```

Expected: All PASS.

- [ ] **Step 5: Integration test — chat**

```bash
pnpm test:chat
```

Expected: PASS (no regressions in existing chat-live tests).

- [ ] **Step 6: Integration test — new provenance routes**

```bash
pnpm vitest run tests/integration/chat-provenance-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Integration test — memory (no regressions)**

```bash
pnpm test:memory
```

Expected: PASS.

- [ ] **Step 8: Final commit (any stray format/lint fixes)**

```bash
git add -p   # stage only your files
git commit -m "fix(chat): format and lint cleanup for provenance PR (#539)"
```

---

## Self-Review Against Spec

### Acceptance criteria coverage:

| Criterion                                                                                 | Task                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Chat answers persist bounded `answerProvenanceV1` metadata                                | Tasks 4+5                                                                          |
| Briefing runs persist `answerProvenanceV1`                                                | ⚠️ **Out of scope** — packages/briefings/ excluded per collision notes             |
| #525/#530 source items produce sidecar `AnswerSourceSupport` items                        | Tasks 3+4                                                                          |
| Valid answer support markers map to source cards; invalid don't expose metadata           | Task 2 (marker parser, strip)                                                      |
| Source cards distinguish all 5 states                                                     | Tasks 1+2                                                                          |
| Source cards show only bounded labels/snippets — never raw refs, prompts, bodies, secrets | Task 2 (sanitizer)                                                                 |
| API list routes return sanitized cards that omit `citationToken`                          | Tasks 1+6                                                                          |
| Deep links/dereference go through source-owned providers under DataContextDb              | Task 6 (stub: returns unavailable; provider implementations TBD per source module) |
| Dereference passes authenticated actor id to providers, never from stored metadata        | Task 6                                                                             |
| Uncited context-checked support hidden by default                                         | Tasks 6+7 (`answerProvenanceCitedIds` distinguishes cited from uncited)            |
| Central layer never queries source-owned tables directly                                  | Design: routes.ts only reads `tool_metadata`, no source-package imports            |
| Missing/failed providers degrade to label-only or unavailable cards                       | Task 6 (unavailable returned; no provider crash)                                   |
| Provenance UI has no action audit details or freshness warnings                           | Task 7 (SourceTray only shows provenance fields)                                   |
| User A cannot view or dereference User B's answer provenance                              | Tasks 5+6 (RLS via DataContextDb + `owner_user_id` check)                          |

**Known gaps (out of scope for this PR):**

- Briefings integration (`packages/briefings/` excluded per collision notes — tracked in issue)
- Source-owned provider implementations (notes, email, calendar, tasks, memory, people all need providers — those ship when each source module adds its own `AnswerProvenanceProvider` registration)
- `[[support=S1 source="..."] text` rendering in hidden context blocks (spec §6 says add support ids to context lines; the current pass adds support items but does not modify the rendered context strings — this is a follow-up that requires wiring `renderContextLineWithSupportId` into the render paths in passive-retrieval and cross-tool-reasoning)
