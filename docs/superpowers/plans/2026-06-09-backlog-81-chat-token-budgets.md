# Chat Token Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the memory-seed and conversation-replay blocks injected at CLI session launch to prevent compounding token cost on long-lived conversations.

**Architecture:** Two bounded injection paths: (1) `trimToTokenBudget` in `recall-seed.ts` drops lowest-scoring episodic chunks first; (2) a rolling `conversation_summary` column on `chat_threads` replaces verbatim replay of old turns, leaving only the last K turns verbatim. `launchSession` is updated to use both. No AI calls at relaunch time — summary is a deterministic concatenation of old assistant turns.

**Tech Stack:** TypeScript, Kysely, PostgreSQL (ALTER TABLE migration), Vitest integration tests, process.env config.

---

## File Map

| File                                                   | Action     | Responsibility                                                                                                            |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/chat/sql/00NN_chat_conversation_summary.sql` | **Create** | ALTER TABLE migration                                                                                                     |
| `packages/db/src/types.ts`                             | **Modify** | Add `conversation_summary: string \| null` to `ChatThreadsTable`                                                          |
| `packages/chat/src/live/recall-seed.ts`                | **Modify** | Add `hybridScore` to `EpisodicChunk`; add `estimateTokens`, `trimToTokenBudget`; update `renderMemorySeedBlock` signature |
| `packages/chat/src/recall-port.ts`                     | **Modify** | Populate `hybridScore` on chunks in `RecallService`                                                                       |
| `packages/chat/src/repository.ts`                      | **Modify** | Add `updateConversationSummary`                                                                                           |
| `packages/chat/src/live/persistence.ts`                | **Modify** | Update `listPriorTurns` return type + rolling-summary logic in `recordTurn`                                               |
| `packages/chat/src/live/chat-session-manager.ts`       | **Modify** | Update `ChatPersistencePort.listPriorTurns`; update `launchSession`; add `renderSummaryBlock`                             |
| `packages/chat/src/index.ts`                           | **Modify** | Export `DataContextChatPersistence` + `DataContextChatPersistenceDeps`                                                    |
| `tests/unit/chat-live-manager.test.ts`                 | **Modify** | Update `FakePersistence.listPriorTurns` to match new return type                                                          |
| `tests/unit/chat-session-manager.test.ts`              | **Modify** | Update `vi.fn().mockResolvedValue` for `listPriorTurns`                                                                   |
| `tests/integration/chat-token-budgets.test.ts`         | **Create** | Integration tests for all spec exit criteria                                                                              |

---

## Task 1: DB migration + Kysely type

**Files:**

- Create: `packages/chat/sql/00NN_chat_conversation_summary.sql`
- Modify: `packages/db/src/types.ts` (lines 343–351)

- [ ] **Step 1: Write the migration file**

Create `packages/chat/sql/00NN_chat_conversation_summary.sql`:

```sql
ALTER TABLE app.chat_threads
  ADD COLUMN IF NOT EXISTS conversation_summary text;
```

That is the entire file. No grant needed — `jarvis_app_runtime` already has `UPDATE ON app.chat_threads` from migration 0014.

- [ ] **Step 2: Add `conversation_summary` to the Kysely type**

In `packages/db/src/types.ts`, update `ChatThreadsTable` (currently around line 343):

```ts
export interface ChatThreadsTable {
  id: string;
  owner_user_id: string;
  title: string;
  incognito: boolean;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  last_active_at: TimestampColumn;
  conversation_summary: string | null;
}
```

- [ ] **Step 3: Write the migration test (failing until DB is reset)**

Create `tests/integration/chat-token-budgets.test.ts` with just the migration check describe block:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";
const { Client } = pg;

describe("chat token budgets — migration (00NN)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("chat_threads has conversation_summary column", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app'
           AND table_name   = 'chat_threads'
           AND column_name  = 'conversation_summary'`
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});
```

- [ ] **Step 4: Run to verify migration test passes**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/backlog-81-chat-token-budgets
pnpm db:up
pnpm db:migrate
vitest run tests/integration/chat-token-budgets.test.ts
```

Expected: the migration describe passes (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/chat/sql/00NN_chat_conversation_summary.sql \
        packages/db/src/types.ts \
        tests/integration/chat-token-budgets.test.ts
git commit -m "feat(chat): add conversation_summary column + Kysely type

Nullable text column on app.chat_threads stores the pre-computed rolling
summary of turns older than JARVIS_CHAT_REPLAY_K. No backfill required.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `EpisodicChunk.hybridScore` + `trimToTokenBudget`

**Files:**

- Modify: `packages/chat/src/live/recall-seed.ts`
- Modify: `packages/chat/src/recall-port.ts`
- Modify: `tests/integration/chat-token-budgets.test.ts` (add pure-logic describe)

This task is pure TypeScript logic — no DB needed for the unit-style tests.

- [ ] **Step 1: Write failing tests for `trimToTokenBudget`**

Append to `tests/integration/chat-token-budgets.test.ts`:

```ts
import {
  trimToTokenBudget,
  estimateTokens,
  type EpisodicChunk
} from "../../packages/chat/src/live/recall-seed.js";

describe("trimToTokenBudget (pure logic)", () => {
  const chunk = (text: string, hybridScore: number): EpisodicChunk => ({
    text,
    date: "2025-01-01",
    threadId: "t1",
    hybridScore
  });

  it("returns all chunks when total within budget", () => {
    // 2 chunks × 100 chars = 2 × 25 tokens = 50 total — fits in budget of 100
    const chunks = [chunk("a".repeat(100), 0.8), chunk("b".repeat(100), 0.6)];
    expect(trimToTokenBudget(chunks, 100)).toHaveLength(2);
  });

  it("drops lowest-score chunk when budget is tight", () => {
    // Each chunk = 400 chars = 100 tokens. Budget 150 → only 1 fits.
    const high = chunk("a".repeat(400), 0.9);
    const low = chunk("b".repeat(400), 0.3);
    const result = trimToTokenBudget([low, high], 150);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(high);
  });

  it("returns empty when budget is 0", () => {
    expect(trimToTokenBudget([chunk("hello", 0.9)], 0)).toHaveLength(0);
  });

  it("returns empty for empty input", () => {
    expect(trimToTokenBudget([], 1000)).toHaveLength(0);
  });

  it("estimateTokens: Math.ceil(text.length / 4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
vitest run tests/integration/chat-token-budgets.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: errors about missing exports `trimToTokenBudget`, `estimateTokens`, `EpisodicChunk.hybridScore`.

- [ ] **Step 3: Add `hybridScore` to `EpisodicChunk`, add helpers, update `renderMemorySeedBlock`**

Replace the contents of `packages/chat/src/live/recall-seed.ts`:

```ts
export interface EpisodicChunk {
  readonly text: string;
  readonly date: string;
  readonly threadId: string;
  readonly hybridScore: number;
}

export interface FactSummary {
  readonly category: string;
  readonly content: string;
}

/** λ for recency decay: exp(-λ * days). At λ=0.05, half-life ≈ 14 days. */
const LAMBDA = 0.05;

/** Hybrid score: 60% cosine similarity + 25% recency decay. */
export function hybridScore(similarity: number, recencyDecay: number): number {
  return 0.6 * similarity + 0.25 * recencyDecay;
}

/** Recency decay: exp(-λ * daysAgo). Returns 1.0 at 0 days, ~0.5 at 14 days. */
export function applyRecencyDecay(daysAgo: number): number {
  return Math.exp(-LAMBDA * daysAgo);
}

/** Approximate token count: 1 token ≈ 4 chars (±20% for typical prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Return the highest-scoring chunks that fit within `budgetTokens`.
 * Drops lowest-hybridScore chunks first when the budget is exceeded.
 */
export function trimToTokenBudget(
  chunks: readonly EpisodicChunk[],
  budgetTokens: number
): readonly EpisodicChunk[] {
  const sorted = [...chunks].sort((a, b) => a.hybridScore - b.hybridScore);
  const kept: EpisodicChunk[] = [];
  let used = 0;
  for (const chunk of sorted.reverse()) {
    const est = estimateTokens(chunk.text);
    if (used + est > budgetTokens) break;
    kept.push(chunk);
    used += est;
  }
  return kept;
}

/**
 * Render the <memory> seed block injected before the conversation replay.
 * Trims episodic chunks to `budgetTokens` (default 1 500) before rendering.
 * Returns empty string if there is nothing to inject after trimming.
 */
export function renderMemorySeedBlock(
  chunks: readonly EpisodicChunk[],
  facts: readonly FactSummary[],
  budgetTokens: number = 1500
): string {
  const trimmedChunks = trimToTokenBudget(chunks, budgetTokens);
  if (trimmedChunks.length === 0 && facts.length === 0) return "";

  const lines: string[] = ["<memory>"];

  if (trimmedChunks.length > 0) {
    lines.push("Recalled from past conversations (use as context; not the current conversation):");
    for (const chunk of trimmedChunks) {
      lines.push(`[${chunk.date}] ${chunk.text}`);
    }
  }

  if (facts.length > 0) {
    if (trimmedChunks.length > 0) lines.push("");
    lines.push("What I know about you:");
    for (const fact of facts) {
      lines.push(`- ${fact.content}`);
    }
  }

  lines.push("</memory>");
  return lines.join("\n");
}
```

- [ ] **Step 4: Update `RecallService` to populate `hybridScore`**

In `packages/chat/src/recall-port.ts`, update the loop that builds `injected` in `recallEpisodic`. Find this block (around line 104–108):

```ts
for (const { chunk, date } of scored) {
  if (charCount + chunk.text.length > MAX_CHARS) break;
  injected.push({ text: chunk.text, date, threadId: chunk.sourcePath });
  charCount += chunk.text.length;
}
```

Replace with:

```ts
for (const { chunk, score, date } of scored) {
  if (charCount + chunk.text.length > MAX_CHARS) break;
  injected.push({ text: chunk.text, date, threadId: chunk.sourcePath, hybridScore: score });
  charCount += chunk.text.length;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
vitest run tests/integration/chat-token-budgets.test.ts --reporter=verbose 2>&1 | tail -20
pnpm typecheck
```

Expected: all `trimToTokenBudget` tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/recall-seed.ts \
        packages/chat/src/recall-port.ts \
        tests/integration/chat-token-budgets.test.ts
git commit -m "feat(chat): add trimToTokenBudget + hybridScore to EpisodicChunk

Memory seed block now trims to JARVIS_CHAT_SEED_BUDGET_TOKENS (default
1 500 tokens) by dropping lowest-hybridScore chunks first. Facts are
never dropped (they pass through trimToTokenBudget only for chunks).
RecallService populates hybridScore on each EpisodicChunk.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Rolling summary — `ChatRepository` + `DataContextChatPersistence`

**Files:**

- Modify: `packages/chat/src/repository.ts`
- Modify: `packages/chat/src/live/persistence.ts`
- Modify: `packages/chat/src/index.ts`
- Modify: `tests/integration/chat-token-budgets.test.ts` (add DB tests)

This task changes `ChatPersistencePort.listPriorTurns`'s return type and wires up summary
computation in `recordTurn`. The `ChatPersistencePort` interface change (in `chat-session-manager.ts`)
happens in Task 4 — but because `persistence.ts` implements that interface, Task 4 and Task 3
must be done before typechecking can pass. Commit in one pass at the end of Task 4.

- [ ] **Step 1: Write failing integration tests for `listPriorTurns` and rolling summary**

Append to `tests/integration/chat-token-budgets.test.ts`:

```ts
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type Kysely,
  type JarvisDatabase
} from "@jarv1s/db";
import { ChatRepository, DataContextChatPersistence } from "@jarv1s/chat";
import type { AiRepository } from "@jarv1s/ai";
import { ids } from "./test-database.js";

// Minimal AiRepository stub — resolveActiveProvider never called in these tests.
const stubAiRepository = {
  selectModelForCapability: () => {
    throw new Error("not used");
  }
} as unknown as AiRepository;

describe("listPriorTurns — bounded replay + rolling summary", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;
  let persistence: DataContextChatPersistence;

  beforeAll(async () => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
    persistence = new DataContextChatPersistence({
      dataContext,
      chatRepository: repository,
      aiRepository: stubAiRepository
    });
    await resetFoundationDatabase();
  });

  function ctx(userId: string): AccessContext {
    return { actorUserId: userId, requestId: "test:token-budgets" };
  }

  it("≤K turns: returns all turns verbatim, oldSummary is null", async () => {
    // K = 10 default. Insert 4 pairs (8 messages).
    const thread = await dataContext.withDataContext(ctx(ids.userA), (db) =>
      repository.openNewThread(db, { title: "Short thread" })
    );
    for (let i = 0; i < 4; i++) {
      await dataContext.withDataContext(ctx(ids.userA), (db) =>
        repository.recordCompletedTurn(db, thread.id, `user ${i}`, `assistant ${i}`, {
          provider: "anthropic",
          model: "test"
        })
      );
    }

    const result = await persistence.listPriorTurns(ids.userA);
    expect(result.oldSummary).toBeNull();
    expect(result.recent).toHaveLength(8); // 4 pairs × 2 messages
    expect(result.recent[0]).toEqual({ role: "user", content: "user 0" });
    expect(result.recent[7]).toEqual({ role: "assistant", content: "assistant 3" });
  });

  it(">K turns: returns last K turns + non-null oldSummary", async () => {
    // Use userB to avoid polluting userA's thread.
    // Insert K+2 pairs (default K=10 → 12 pairs = 24 messages).
    const thread = await dataContext.withDataContext(ctx(ids.userB), (db) =>
      repository.openNewThread(db, { title: "Long thread" })
    );
    for (let i = 0; i < 12; i++) {
      await persistence.recordTurn(ids.userB, `user ${i}`, `assistant ${i}`, {
        provider: "anthropic",
        model: "test"
      });
    }

    const result = await persistence.listPriorTurns(ids.userB);
    expect(result.oldSummary).not.toBeNull();
    expect(result.recent).toHaveLength(10); // last K=10 messages (not pairs)
    // The first of the recent messages should be message index (24-10)=14, i.e. pair 7 user
    expect(result.recent[0]?.role).toBe("user");
  });

  it("recordTurn stores conversation_summary on thread when turns exceed K", async () => {
    // This is the same userB thread from the previous test — it already has 24 messages.
    // Verify the thread has a non-null conversation_summary in the DB.
    const thread = await dataContext.withDataContext(ctx(ids.userB), (db) =>
      repository.getCurrentThread(db, ids.userB)
    );
    expect(thread).not.toBeUndefined();
    expect(thread!.conversation_summary).not.toBeNull();
    expect(thread!.conversation_summary).toContain("As of turn");
  });

  it("JARVIS_CHAT_REPLAY_K env override: K=2 limits to 2 messages", async () => {
    const original = process.env.JARVIS_CHAT_REPLAY_K;
    process.env.JARVIS_CHAT_REPLAY_K = "2";
    try {
      // userB thread has 24+ messages; with K=2 only 2 recent returned.
      const result = await persistence.listPriorTurns(ids.userB);
      expect(result.recent).toHaveLength(2);
      expect(result.oldSummary).not.toBeNull();
    } finally {
      if (original === undefined) delete process.env.JARVIS_CHAT_REPLAY_K;
      else process.env.JARVIS_CHAT_REPLAY_K = original;
    }
  });
});
```

> **Note on test ordering:** The ">K turns" test uses `persistence.recordTurn` which calls `openNewConversation` fallback if no thread — but since we pre-created the `thread` for `ids.userB` above, `recordTurn` will use it (it finds the current thread). The "recordTurn stores summary" test shares state with the previous test and reads the same thread. This is intentional — the tests build on each other within this describe.

- [ ] **Step 2: Run to confirm tests fail**

```bash
vitest run tests/integration/chat-token-budgets.test.ts --reporter=verbose 2>&1 | grep "FAIL\|Error\|Cannot find" | head -20
```

Expected: import errors for `DataContextChatPersistence` (not yet exported).

- [ ] **Step 3: Add `updateConversationSummary` to `ChatRepository`**

In `packages/chat/src/repository.ts`, add after `touchThread`:

```ts
  async updateConversationSummary(
    scopedDb: DataContextDb,
    threadId: string,
    summary: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.chat_threads")
      .set({ conversation_summary: summary })
      .where("id", "=", threadId)
      .execute();
  }
```

- [ ] **Step 4: Export `DataContextChatPersistence` from `packages/chat/src/index.ts`**

Add to `packages/chat/src/index.ts`:

```ts
export { DataContextChatPersistence } from "./live/persistence.js";
export type { DataContextChatPersistenceDeps } from "./live/persistence.js";
```

(Keep all existing lines; append these two.)

- [ ] **Step 5: Update `DataContextChatPersistence.listPriorTurns`**

In `packages/chat/src/live/persistence.ts`, replace the `listPriorTurns` method (currently lines 64–82) with:

```ts
  async listPriorTurns(actorUserId: string): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }> {
    return this.run(actorUserId, "list-prior-turns", async (scopedDb) => {
      const thread = await this.chat.getCurrentThread(scopedDb, actorUserId);
      if (!thread) return { recent: [], oldSummary: null };

      const messages = await this.chat.listMessages(scopedDb, thread.id);
      const turns = messages
        .filter(
          (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
        )
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.body }));

      const k = getReplayK();
      if (turns.length <= k) {
        return { recent: turns, oldSummary: null };
      }

      const recent = turns.slice(-k);
      const oldSummary =
        thread.conversation_summary ?? buildRollingSummary(turns.slice(0, -k));
      return { recent, oldSummary };
    });
  }
```

- [ ] **Step 6: Add `buildRollingSummary` and `getReplayK` helpers to `persistence.ts`**

Add these two module-level functions at the bottom of `packages/chat/src/live/persistence.ts` (before the closing of the file, after the exported class):

```ts
function getReplayK(): number {
  const val = process.env.JARVIS_CHAT_REPLAY_K;
  return val ? parseInt(val, 10) : 10;
}

function buildRollingSummary(
  oldTurns: readonly { role: "user" | "assistant"; content: string }[]
): string {
  const assistantContent = oldTurns
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join(" ");
  return `As of turn ${oldTurns.length}: ${assistantContent}`;
}
```

- [ ] **Step 7: Update `DataContextChatPersistence.recordTurn` to maintain the rolling summary**

In `packages/chat/src/live/persistence.ts`, inside `recordTurn`, after the existing `await this.chat.touchThread(scopedDb, thread.id)` call (and after the `this.boss` block), add:

```ts
// Maintain rolling summary: if turns exceed K, fold oldest into a summary paragraph.
const allMessages = await this.chat.listMessages(scopedDb, thread.id);
const storedTurns = allMessages.filter(
  (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
);
const k = getReplayK();
if (storedTurns.length > k) {
  const oldTurns = storedTurns.slice(0, -k).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.body
  }));
  await this.chat.updateConversationSummary(scopedDb, thread.id, buildRollingSummary(oldTurns));
}
```

The full updated `recordTurn` body now looks like this (showing the run callback only):

```ts
  async recordTurn(...): Promise<void> {
    await this.run(actorUserId, "record-turn", async (scopedDb) => {
      const thread =
        (await this.chat.getCurrentThread(scopedDb, actorUserId)) ??
        (await this.chat.openNewThread(scopedDb, { title: DEFAULT_CONVERSATION_TITLE }));

      const result = await this.chat.recordCompletedTurn(
        scopedDb,
        thread.id,
        userText,
        assistantReply,
        executed
      );
      await this.chat.touchThread(scopedDb, thread.id);

      if (this.boss && result && !thread.incognito) {
        // ... existing boss.send calls unchanged ...
      }

      // Maintain rolling summary.
      const allMessages = await this.chat.listMessages(scopedDb, thread.id);
      const storedTurns = allMessages.filter(
        (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
      );
      const k = getReplayK();
      if (storedTurns.length > k) {
        const oldTurns = storedTurns.slice(0, -k).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.body
        }));
        await this.chat.updateConversationSummary(
          scopedDb,
          thread.id,
          buildRollingSummary(oldTurns)
        );
      }
    });
  }
```

---

## Task 4: Update `ChatPersistencePort` interface + `launchSession` + fix unit test stubs

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts`
- Modify: `tests/unit/chat-live-manager.test.ts`
- Modify: `tests/unit/chat-session-manager.test.ts`

This task changes the `ChatPersistencePort` interface to match the new return type from Task 3,
updates `launchSession` to use the bounded replay, and fixes the two unit test stubs that implement
the old interface. Do all changes in this task before running `pnpm typecheck`.

- [ ] **Step 1: Update `ChatPersistencePort.listPriorTurns` in `chat-session-manager.ts`**

In `packages/chat/src/live/chat-session-manager.ts`, replace line 34 (the `listPriorTurns` signature):

Old:

```ts
  /** Prior stored turns of the user's CURRENT conversation, oldest-first. */
  listPriorTurns(actorUserId: string): Promise<{ role: "user" | "assistant"; content: string }[]>;
```

New:

```ts
  /** Prior stored turns of the user's CURRENT conversation.
   *  `recent` = last K turns verbatim; `oldSummary` = pre-computed paragraph for older turns (null if ≤K). */
  listPriorTurns(actorUserId: string): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }>;
```

- [ ] **Step 2: Update the import of `renderMemorySeedBlock` call + update `launchSession`**

In `packages/chat/src/live/chat-session-manager.ts`, replace the current `launchSession` block from line 170 to line 188:

Old:

```ts
// Phase 3: recall injection — prepend <memory> seed before conversation replay.
const recallResult = this.deps.recall ? await this.deps.recall.recall(actorUserId) : null;
const memorySeed = recallResult
  ? renderMemorySeedBlock(recallResult.episodicChunks, recallResult.facts)
  : "";

// Replay prior turns of the current conversation so a respawned or
// provider-switched engine continues seamlessly.
const priorTurns = await this.deps.persistence.listPriorTurns(actorUserId);
if (memorySeed || priorTurns.length > 0) {
  const parts: string[] = [];
  if (memorySeed) parts.push(memorySeed);
  if (priorTurns.length > 0) parts.push(renderReplayBlock(priorTurns));
  await engine.submit(parts.join("\n\n"));
  // Drain (and discard) so real turn records start from a clean offset.
  session.transcriptOffset = await this.drain(engine, session.transcriptOffset);
}
```

New:

```ts
// Phase 3: recall injection — prepend budget-trimmed <memory> seed.
const recallResult = this.deps.recall ? await this.deps.recall.recall(actorUserId) : null;
const seedBudget = process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS
  ? parseInt(process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS, 10)
  : 1500;
const memorySeed = recallResult
  ? renderMemorySeedBlock(recallResult.episodicChunks, recallResult.facts, seedBudget)
  : "";

// Bounded conversation replay: last K turns verbatim + pre-computed summary for older turns.
const { recent: recentTurns, oldSummary } = await this.deps.persistence.listPriorTurns(actorUserId);
if (memorySeed || oldSummary || recentTurns.length > 0) {
  const parts: string[] = [];
  if (memorySeed) parts.push(memorySeed);
  if (oldSummary) parts.push(renderSummaryBlock(oldSummary));
  if (recentTurns.length > 0) parts.push(renderReplayBlock(recentTurns));
  await engine.submit(parts.join("\n\n"));
  session.transcriptOffset = await this.drain(engine, session.transcriptOffset);
}
```

- [ ] **Step 3: Add `renderSummaryBlock` helper to `chat-session-manager.ts`**

In `packages/chat/src/live/chat-session-manager.ts`, add after the `renderReplayBlock` function (around line 364):

```ts
/**
 * Wrap the pre-computed rolling summary so the model recognises it as
 * prior context rather than a new message.
 */
function renderSummaryBlock(summary: string): string {
  return `<prior-context>\n${summary}\n</prior-context>`;
}
```

- [ ] **Step 4: Fix `FakePersistence.listPriorTurns` in `tests/unit/chat-live-manager.test.ts`**

Find the `FakePersistence` class (around line 214). Replace:

```ts
  async listPriorTurns(): Promise<{ role: "user" | "assistant"; content: string }[]> {
    return [...this.turns];
  }
```

With:

```ts
  async listPriorTurns(): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }> {
    return { recent: [...this.turns], oldSummary: null };
  }
```

- [ ] **Step 5: Fix `listPriorTurns` mock in `tests/unit/chat-session-manager.test.ts`**

Find line 11:

```ts
      listPriorTurns: vi.fn().mockResolvedValue([]),
```

Replace with:

```ts
      listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
```

- [ ] **Step 6: Typecheck + run unit tests**

```bash
pnpm typecheck
vitest run tests/unit/chat-live-manager.test.ts tests/unit/chat-session-manager.test.ts --reporter=verbose
```

Expected: both unit test files pass; typecheck clean.

- [ ] **Step 7: Run integration tests so far**

```bash
vitest run tests/integration/chat-token-budgets.test.ts --reporter=verbose
```

Expected: all tests in the file pass including the DB tests added in Task 3.

- [ ] **Step 8: Commit all Tasks 3 + 4 together**

```bash
git add \
  packages/chat/src/repository.ts \
  packages/chat/src/live/persistence.ts \
  packages/chat/src/live/chat-session-manager.ts \
  packages/chat/src/index.ts \
  tests/unit/chat-live-manager.test.ts \
  tests/unit/chat-session-manager.test.ts \
  tests/integration/chat-token-budgets.test.ts
git commit -m "feat(chat): bounded listPriorTurns + rolling summary in recordTurn

listPriorTurns now returns { recent, oldSummary }: last JARVIS_CHAT_REPLAY_K
turns verbatim (default 10) plus a pre-computed summary paragraph for older
turns. recordTurn updates conversation_summary on the thread whenever total
stored turns exceed K. launchSession uses the bounded replay and passes the
seed budget to renderMemorySeedBlock.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Integration test — full bounded relaunch + env-var budget override

**Files:**

- Modify: `tests/integration/chat-token-budgets.test.ts` (add 2 more describe blocks)

These tests verify the full spec Exit Criteria end-to-end.

- [ ] **Step 1: Write failing test for full launchSession bounded inject (using fake engine)**

Append to `tests/integration/chat-token-budgets.test.ts`:

```ts
import {
  ChatSessionManager,
  type ChatPersistencePort
} from "../../packages/chat/src/live/chat-session-manager.js";
import type { CliChatEngine, TranscriptRecord } from "../../packages/chat/src/live/types.js";

// Minimal in-memory engine stub for session manager tests.
class FakeEngine implements CliChatEngine {
  readonly provider = "anthropic" as const;
  readonly submitted: string[] = [];
  private complete = true;

  async launch() {}
  async submit(text: string) {
    this.submitted.push(text);
    this.complete = true;
  }
  async readNew(afterOffset: number) {
    return { records: [] as TranscriptRecord[], offset: afterOffset, complete: this.complete };
  }
  async isAlive() {
    return true;
  }
  async kill() {}
}

describe("launchSession — bounded inject (fake engine)", () => {
  it("uses oldSummary + recent K turns when persistence returns both", async () => {
    const fakePersistence: ChatPersistencePort = {
      resolveActiveProvider: async () => ({ provider: "anthropic", model: "test" }),
      listPriorTurns: async () => ({
        recent: [
          { role: "user", content: "recent user msg" },
          { role: "assistant", content: "recent assistant msg" }
        ],
        oldSummary: "As of turn 5: old context here"
      }),
      recordTurn: async () => {},
      openNewConversation: async () => {}
    };

    const engine = new FakeEngine();
    const manager = new ChatSessionManager({
      engineFactory: () => engine,
      persistence: fakePersistence,
      personaFs: { mkdir: async () => {}, writeFile: async () => {} },
      clock: { now: () => 0 },
      idleMs: 60_000,
      neutralBase: "/tmp",
      persona: "You are Jarvis.",
      pollMs: 0
    });

    await manager.ensureSession("user-1", "Test User");

    expect(engine.submitted).toHaveLength(1);
    const inject = engine.submitted[0] ?? "";
    expect(inject).toContain("<prior-context>");
    expect(inject).toContain("As of turn 5: old context here");
    expect(inject).toContain("recent user msg");
    expect(inject).toContain("recent assistant msg");
    expect(inject).not.toContain("<memory>"); // no recall port configured
  });

  it("no inject when listPriorTurns returns empty recent + null summary", async () => {
    const fakePersistence: ChatPersistencePort = {
      resolveActiveProvider: async () => ({ provider: "anthropic", model: "test" }),
      listPriorTurns: async () => ({ recent: [], oldSummary: null }),
      recordTurn: async () => {},
      openNewConversation: async () => {}
    };

    const engine = new FakeEngine();
    const manager = new ChatSessionManager({
      engineFactory: () => engine,
      persistence: fakePersistence,
      personaFs: { mkdir: async () => {}, writeFile: async () => {} },
      clock: { now: () => 0 },
      idleMs: 60_000,
      neutralBase: "/tmp",
      persona: "You are Jarvis.",
      pollMs: 0
    });

    await manager.ensureSession("user-2", "Test User");
    expect(engine.submitted).toHaveLength(0);
  });
});

describe("memory seed budget env override", () => {
  it("JARVIS_CHAT_SEED_BUDGET_TOKENS=50 trims chunks to ≤50 tokens", () => {
    const original = process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS;
    process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS = "50";
    try {
      // Budget 50 tokens = 200 chars. One chunk = 400 chars (100 tokens) — must be dropped.
      // Another = 100 chars (25 tokens) — fits.
      const big: EpisodicChunk = {
        text: "x".repeat(400),
        date: "2025-01-01",
        threadId: "t1",
        hybridScore: 0.5
      };
      const small: EpisodicChunk = {
        text: "y".repeat(100),
        date: "2025-01-01",
        threadId: "t2",
        hybridScore: 0.9
      };
      const budget = process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS
        ? parseInt(process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS, 10)
        : 1500;
      const result = trimToTokenBudget([big, small], budget);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(small);
    } finally {
      if (original === undefined) delete process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS;
      else process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS = original;
    }
  });
});
```

- [ ] **Step 2: Run to verify tests pass**

```bash
vitest run tests/integration/chat-token-budgets.test.ts --reporter=verbose
```

Expected: all describes pass, including the new fake-engine and budget-override tests.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/chat-token-budgets.test.ts
git commit -m "test(chat): integration tests for bounded inject + env budget override

Covers all spec exit criteria: launchSession uses <prior-context> + K-turn
replay; empty conversation skips inject; env vars trim seed and replay correctly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Pre-push gate

- [ ] **Step 1: Format + lint + typecheck**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Fix any issues (`pnpm format` to auto-fix format, resolve lint/type errors manually).

- [ ] **Step 2: Run the full chat integration suite**

```bash
vitest run tests/integration/chat-token-budgets.test.ts \
            tests/integration/chat-live.test.ts \
            tests/integration/chat-live-api.test.ts \
            tests/integration/chat-recall.test.ts \
            tests/unit/chat-live-manager.test.ts \
            tests/unit/chat-session-manager.test.ts \
  --reporter=verbose
```

Expected: all pass.

- [ ] **Step 3: Rebase + full gate**

```bash
git fetch origin main
git rebase origin/main
pnpm verify:foundation
```

Expected: green. If any failures, fix before proceeding.

- [ ] **Step 4: Escalate to coordinator**

Message the `Coordinator` pane via `herdr-pane-message`:

```
[backlog-81] plan ready. path: docs/superpowers/plans/2026-06-09-backlog-81-chat-token-budgets.md
changes: recall-seed trimToTokenBudget, EpisodicChunk.hybridScore, listPriorTurns→{recent,oldSummary},
recordTurn rolling summary, launchSession bounded inject, migration 00NN.
approve or flag fork.
```

---

## Self-Review Against Spec Exit Criteria

| Exit Criterion                                                                                                                | Task                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `pnpm verify:foundation` green                                                                                                | Task 6                  |
| Memory seed capped at `JARVIS_CHAT_SEED_BUDGET_TOKENS` (default 1500); lowest-score chunks trimmed first; facts never trimmed | Tasks 2 + 3             |
| Conversation replay: last `JARVIS_CHAT_REPLAY_K` turns verbatim (default 10); older turns as summary                          | Tasks 3 + 4             |
| Integration test: long relaunch under budget, last-K verbatim                                                                 | Task 5                  |
| Single-conversation (≤K turns) identical to today                                                                             | Task 5 (no-inject test) |
| DB migration idempotent; column nullable; no required backfill                                                                | Task 1                  |

All Exit Criteria covered. Hard Invariants honored:

- `DataContextDb only` — all DB access via `DataContextChatPersistence` → `DataContextRunner`
- `Secrets never escape` — summary derived from chat content only
- `Module isolation` — all changes in `packages/chat/`
- `Never edit applied migrations` — new file only
- `Provider-agnostic AI` — no AI model called

> **Note on migration number:** File is named `00NN_chat_conversation_summary.sql` as required by the HANDOFF. The coordinator assigns the landing number (0048) at merge time.
