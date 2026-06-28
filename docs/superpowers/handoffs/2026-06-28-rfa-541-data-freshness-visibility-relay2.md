# Relay Handoff — rfa-541-data-freshness-visibility (R4)

**Date:** 2026-06-28
**Spec:** `docs/superpowers/specs/2026-06-28-data-freshness-visibility.md`
**Plan:** `docs/superpowers/plans/2026-06-28-rfa-541-data-freshness-visibility.md`
**Issue:** #541
**Branch/worktree:** `rfa-541-data-freshness-visibility`
**Risk tier:** routine (UI + metadata enrichment; no new tables, no RLS changes)
**Coordinator label:** `Coordinator`
**Coordinator session id:** `fa1a543f-55a4-46a3-9c52-36b642aa0c62`

## State

Plan APPROVED by Coordinator. Build in progress. **Tasks 1–6 complete and green.** Task 7 failing test committed. Tasks 7–11 remain.

node_modules present — **skip `pnpm install`**.

## Completed commits (in order)

```
e7fa2aff feat(freshness): add SourceFreshnessV1 shared types (#541)
db23ffd1 feat(freshness): add getConnectorSyncAt to connectors public API (#541)
ed7e8f2e feat(freshness): add MemoryRepository.getLatestIngestedAt (#541)
cee97b4b feat(freshness): add resolveBriefingFreshness resolver (#541)
d5c477a9 feat(freshness): populate sourceTimestamps in briefing sourceMetadata (#541)
01329e66 feat(freshness): add sourceFreshness to ChatMessageDto and Fastify schema (#541)
358c0b19 test(freshness): add failing unit tests for chat freshness persistence (#541)
```

## Remaining tasks

### Task 7 — Chat persistence: tool names + freshness (IN PROGRESS)

Failing test already committed: `tests/unit/chat-freshness.test.ts`

Tests import `toolNameToSource` and `resolveChatFreshness` from `packages/chat/src/live/persistence.ts` — these do NOT exist yet.

**Step A: Add helpers + extend `DataContextChatPersistenceDeps` in `packages/chat/src/live/persistence.ts`**

Imports to add at top:

```ts
import type { SourceFreshnessEntry, SourceFreshnessV1 } from "@jarv1s/shared";
```

Add these two exported functions (above or below the class, not inside it):

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

const CONNECTOR_SOURCES_CHAT = new Set(["email", "calendar"]);
const REALTIME_SOURCES_CHAT = new Set(["tasks", "commitments", "chats", "goals"]);

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
      if (REALTIME_SOURCES_CHAT.has(source)) {
        return { source, freshnessKind: "realtime", asOf: capturedAtIso };
      }
      if (CONNECTOR_SOURCES_CHAT.has(source)) {
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
      // vault — V1: asOf: null (no vaultLastWriteAt dep for chat)
      return { source, freshnessKind: "vault_write", asOf: null };
    })
  );

  return { version: 1, capturedAt: capturedAtIso, sources: entries };
}
```

Add `connectorSyncAt?` to `DataContextChatPersistenceDeps` interface (around line 34):

```ts
  readonly connectorSyncAt?: (scopedDb: DataContextDb, kind: "email" | "calendar") => Promise<Date | null>;
```

Store it in the class constructor:

```ts
  private readonly connectorSyncAt: DataContextChatPersistenceDeps["connectorSyncAt"];
  // (add to constructor body:)
  this.connectorSyncAt = deps.connectorSyncAt;
```

**Step B: Extend `recordTurn` in `DataContextChatPersistence` to compute + thread freshness**

Current signature (around line 99):

```ts
async recordTurn(actorUserId: string, userText: string, assistantReply: string, executed: { provider: ProviderKind; model: string })
```

New signature:

```ts
async recordTurn(
  actorUserId: string,
  userText: string,
  assistantReply: string,
  executed: { provider: ProviderKind; model: string },
  opts?: { readonly invokedToolNames?: ReadonlySet<string> }
)
```

Inside `recordTurn`, before calling `this.chat.recordCompletedTurn(...)`, compute freshness:

```ts
const capturedAt = new Date();
const sourceFreshness = opts?.invokedToolNames
  ? await resolveChatFreshness(scopedDb, opts.invokedToolNames, capturedAt, {
      connectorSyncAt: this.connectorSyncAt
    })
  : null;
```

Then pass `{ sourceFreshness }` as the last argument to `recordCompletedTurn` (which will be extended in Task 8).

**Step C: Extend `ChatPersistencePort` interface in `packages/chat/src/live/chat-session-manager.ts`**

Current `recordTurn` signature in the `ChatPersistencePort` interface (around line 48):

```ts
recordTurn(actorUserId: string, userText: string, assistantReply: string, executed: { provider: ProviderKind; model: string }): Promise<...>
```

Add optional opts:

```ts
recordTurn(
  actorUserId: string,
  userText: string,
  assistantReply: string,
  executed: { provider: ProviderKind; model: string },
  opts?: { readonly invokedToolNames?: ReadonlySet<string> }
): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined>;
```

**Step D: Collect tool names in `ChatSessionManager.runTurn`**

In the `runTurn` method, declare a Set before the turn loop:

```ts
const invokedToolNames = new Set<string>();
```

Inside the `for (const record of records)` loop (around line 431), add:

```ts
if (record.kind === "tool" && record.toolName) {
  invokedToolNames.add(record.toolName);
}
```

Then in the `recordTurn` call (around line 476), pass the set:

```ts
await this.deps.persistence.recordTurn(
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

**Verification after Task 7:**

```bash
pnpm test:unit -- tests/unit/chat-freshness.test.ts
pnpm typecheck
git add packages/chat/src/live/persistence.ts packages/chat/src/live/chat-session-manager.ts
git commit -m "feat(freshness): collect tool names and compute chat sourceFreshness (#541)"
```

---

### Task 8 — Chat repository + routes: store and serialize sourceFreshness

**Step A: Create failing test `tests/unit/chat-routes-freshness.test.ts`**

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
    expect(result!.sources[0].source).toBe("email");
  });
  it("filters out malformed source entries", () => {
    const blob = {
      version: 1,
      capturedAt: "2026-06-28T09:00:00.000Z",
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" },
        { source: 42, freshnessKind: "realtime", asOf: null },
        { source: "tasks", freshnessKind: "realtime", asOf: "2026-06-28T09:00:00.000Z" }
      ]
    };
    expect(readSourceFreshness(blob)!.sources).toHaveLength(2);
  });
});
```

Run — expect FAIL (readSourceFreshness not exported).

**Step B: Extend `ChatRepository.recordCompletedTurn` in `packages/chat/src/repository.ts`**

Add import:

```ts
import type { SourceFreshnessV1 } from "@jarv1s/shared";
```

Add opts param to `recordCompletedTurn` (around line 172):

```ts
async recordCompletedTurn(
  scopedDb: DataContextDb,
  threadId: string,
  userText: string,
  assistantReply: string,
  executed: { readonly provider: string; readonly model: string },
  opts?: { readonly sourceFreshness?: SourceFreshnessV1 | null }
)
```

In the assistant message insert, change `toolMetadata: { selectedTools: [] }` to:

```ts
toolMetadata: opts?.sourceFreshness
  ? { selectedTools: [], sourceFreshness: opts.sourceFreshness }
  : { selectedTools: [] },
```

**Step C: Add `readSourceFreshness` to `packages/chat/src/routes.ts`**

Add import at top:

```ts
import type { SourceFreshnessV1, SourceFreshnessEntry, FreshnessKind } from "@jarv1s/shared";
```

The file already has an `asRecord` helper. Add this exported function alongside `readTools`/`readActivity`:

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

In `serializeMessage` (around line 600), add to the returned DTO:

```ts
sourceFreshness: readSourceFreshness(toolMetadata.sourceFreshness),
```

**Verification after Task 8:**

```bash
pnpm test:unit -- tests/unit/chat-routes-freshness.test.ts
pnpm typecheck
git add packages/chat/src/repository.ts packages/chat/src/routes.ts tests/unit/chat-routes-freshness.test.ts
git commit -m "feat(freshness): store and serialize chat sourceFreshness in repository and routes (#541)"
```

---

### Task 9 — Module registry + runtime wiring

**File: `packages/chat/src/live/runtime.ts`**

Find `CreateChatSessionRuntimeDeps` interface and add:

```ts
readonly connectorSyncAt?: (scopedDb: DataContextDb, kind: "email" | "calendar") => Promise<Date | null>;
```

In `createChatSessionRuntime`, add `connectorSyncAt: deps.connectorSyncAt` to the `DataContextChatPersistence` constructor call.

**File: `packages/module-registry/src/index.ts`**

Check current imports — add if not already present:

```ts
import { ConnectorsRepository, getConnectorSyncAt } from "@jarv1s/connectors";
import { MemoryRepository } from "@jarv1s/memory";
```

In the `composeDeps` block (around line 614), add:

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

Find where `createChatSessionRuntime` is called — search `grep -n "createChatSessionRuntime"` — and add:

```ts
connectorSyncAt: async (scopedDb, kind) => {
  const repo = new ConnectorsRepository();
  return getConnectorSyncAt(repo, scopedDb, kind);
},
```

**Verification after Task 9:**

```bash
pnpm typecheck
pnpm test:unit
git add packages/chat/src/live/runtime.ts packages/module-registry/src/index.ts
git commit -m "feat(freshness): wire connectorSyncAt and vaultLastWriteAt in module registry and chat runtime (#541)"
```

---

### Task 10 — Web UI: briefing freshness section

**Create `apps/web/src/today/briefing-freshness.tsx`**

```tsx
import type { SourceFreshnessV1, SourceFreshnessEntry } from "@jarv1s/shared";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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
  if (entry.freshnessKind === "realtime" || !entry.asOf) return false;
  return new Date(capturedAt).getTime() - new Date(entry.asOf).getTime() > STALE_THRESHOLD_MS;
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
                className={`bfresh__age${
                  entry.freshnessKind === "realtime"
                    ? " bfresh__age--live"
                    : age === "unknown"
                      ? " bfresh__age--unknown"
                      : ""
                }`}
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
  if (rec.version !== 1 || typeof rec.capturedAt !== "string" || !Array.isArray(rec.sources))
    return null;
  return ts as SourceFreshnessV1;
}
```

**Write failing test `tests/unit/briefing-freshness-ui.test.tsx`**

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
    { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" },
    { source: "tasks", freshnessKind: "realtime", asOf: CAPTURED },
    { source: "vault", freshnessKind: "vault_write", asOf: null }
  ]
};

describe("BriefingFreshnessList", () => {
  it("renders source labels", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toContain("Email");
    expect(html).toContain("Tasks");
    expect(html).toContain("Notes");
  });
  it("renders live for realtime sources", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toContain("live");
  });
  it("renders unknown for null asOf", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toContain("unknown");
  });
  it("renders relative age for timestamped sources", () => {
    const html = renderToString(createElement(BriefingFreshnessList, { freshness }));
    expect(html).toMatch(/\d+(h|m|d) ago/);
  });
});

describe("BriefingStaleBanner", () => {
  it("renders for stale sources (>24h)", () => {
    const staleFreshness: SourceFreshnessV1 = {
      version: 1,
      capturedAt: CAPTURED,
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-26T10:00:00.000Z" }
      ]
    };
    const html = renderToString(createElement(BriefingStaleBanner, { freshness: staleFreshness }));
    expect(html).toContain("Email");
  });
  it("renders nothing when all sources are within threshold", () => {
    const recentFreshness: SourceFreshnessV1 = {
      version: 1,
      capturedAt: CAPTURED,
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" }
      ]
    };
    expect(renderToString(createElement(BriefingStaleBanner, { freshness: recentFreshness }))).toBe(
      ""
    );
  });
  it("renders nothing for realtime sources", () => {
    const rtFreshness: SourceFreshnessV1 = {
      version: 1,
      capturedAt: CAPTURED,
      sources: [{ source: "tasks", freshnessKind: "realtime", asOf: CAPTURED }]
    };
    expect(renderToString(createElement(BriefingStaleBanner, { freshness: rtFreshness }))).toBe("");
  });
});
```

**Add CSS to `apps/web/src/styles/kit-today-misc.css`** (append — check file size first):

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

**Modify `apps/web/src/today/today-page.tsx`**

Add import:

```ts
import {
  BriefingFreshnessList,
  BriefingStaleBanner,
  parseBriefingFreshness
} from "./briefing-freshness";
```

Find the evening run display block (search for `latestEveningRun.summaryText`). Where it renders the summary text, add freshness above and below it:

```tsx
{
  (() => {
    const freshness = parseBriefingFreshness(latestEveningRun.sourceMetadata);
    return freshness ? (
      <>
        <BriefingStaleBanner freshness={freshness} />
        {/* ...existing summary text... */}
        <BriefingFreshnessList freshness={freshness} />
      </>
    ) : null;
  })();
}
```

(Read the file to find the exact JSX structure before editing.)

**Verification after Task 10:**

```bash
pnpm test:unit -- tests/unit/briefing-freshness-ui.test.tsx
pnpm check:file-size
pnpm typecheck
git add apps/web/src/today/briefing-freshness.tsx apps/web/src/today/today-page.tsx apps/web/src/styles/kit-today-misc.css tests/unit/briefing-freshness-ui.test.tsx
git commit -m "feat(freshness): add BriefingFreshnessList and BriefingStaleBanner to today page (#541)"
```

---

### Task 11 — Web UI: chat freshness footer

**Add `ChatFreshnessFooter` to `apps/web/src/chat/chat-drawer.tsx`**

First check what `TranscriptRecord` type is used in the web (grep for it — it may be local or imported). If local, add `sourceFreshness?: SourceFreshnessV1 | null` to it.

Add to `recordsFromMessages`: include `sourceFreshness: message.role === "assistant" ? message.sourceFreshness : undefined` in each reply record.

Add imports:

```ts
import type { SourceFreshnessV1, SourceFreshnessEntry } from "@jarv1s/shared";
```

Add these module-scope helpers and the exported component (near `ChatFeedbackMenu`):

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

In the component that renders `record.kind === "reply"` records, add below the reply body / above `ChatFeedbackMenu`:

```tsx
<ChatFreshnessFooter sourceFreshness={record.sourceFreshness} />
```

**Add CSS to `apps/web/src/styles/kit-chat.css`** (append — check file size first):

```css
/* Chat freshness footer (#541) */
.chatd-freshness__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
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

**Write failing test `tests/unit/chat-freshness-footer.test.tsx`**

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
    expect(renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: null }))).toBe("");
  });
  it("renders nothing when sourceFreshness is undefined", () => {
    expect(renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: undefined }))).toBe(
      ""
    );
  });
  it("renders a details element with source names", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: freshness }));
    expect(html).toContain("<details");
    expect(html).toContain("Email");
    expect(html).toContain("Tasks");
  });
  it("renders ages in the body", () => {
    const html = renderToString(createElement(ChatFreshnessFooter, { sourceFreshness: freshness }));
    expect(html).toContain("live");
    expect(html).toMatch(/\d+(h|m|d) ago/);
  });
});
```

**Verification after Task 11:**

```bash
pnpm test:unit -- tests/unit/chat-freshness-footer.test.tsx
pnpm check:file-size
pnpm typecheck
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css tests/unit/chat-freshness-footer.test.tsx
git commit -m "feat(freshness): add ChatFreshnessFooter to chat assistant messages (#541)"
```

---

## Final gate (after Task 11)

```bash
pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm test:unit && pnpm test:briefings && pnpm test:chat
```

Then invoke `coordinated-wrap-up` skill to open PR and report to Coordinator.

## Key constraints (from Coordinator approval)

- Field name: `sourceFreshness` (not `provenance`/`sources`)
- No new tables, no migrations, no RLS changes
- Freshness errors always produce `asOf: null`, never fail a run/turn
- No curved colored left-border card accent
- `chatd-peek` pattern for chat footer (`<details>` collapsed by default)
- File size gate: all files ≤ 1000 lines — run `pnpm check:file-size` before every commit
- Collision note: #539 also modifies `chat-api.ts` — fields are disjoint (`sourceFreshness` vs provenance), second to merge will need rebase

## Compact

Tasks 1–6 complete and green. Task 7 failing test committed. Tasks 7–11 need implementation.
Successor: read this doc IN FULL → resume via `coordinated-build` → implement tasks 7–11 → wrap-up.
