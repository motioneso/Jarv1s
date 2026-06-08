# Jarv1s Chat — Phase 1: Live Runtime + Drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hold a live, multi-turn conversation with "Jarvis" in a chat drawer, powered by a persistent per-user tmux CLI session (Claude/Codex/Gemini), with conversations persisted and provider-switching that carries context.

**Architecture:** A durable **conversation** (`chat_threads`/`chat_messages`) is executed by an ephemeral per-user **tmux CLI session** managed in-process by a `ChatSessionManager` in the API. The manager lazily launches the session in a neutral per-user dir with a rendered persona file (native shell/file tools disabled, no bypass-permissions), pastes input, tails the JSONL transcript via a per-provider `CliChatEngine`, streams parsed **records** to the drawer over SSE, and persists each turn. `/clear` opens a new conversation; switching provider kills the engine and replays the conversation's turns into the new one.

**Tech Stack:** TypeScript, Fastify (API, SSE), tmux + the three CLIs, Postgres/Kysely (`DataContextDb`, RLS), React/Vite + React Query (web), Vitest + Playwright.

> **Granularity note:** This plan front-loads a **discovery spike** (Task 1) because the exact CLI launch/transcript/`/clear` behaviors are not yet verified. Tasks after the spike give exact code for the parts we're certain about (migrations, interfaces, manager logic, tests) and specify spike-gated specifics (exact CLI flags, transcript decoding) at the interface + test level — the implementing agent fills the verified flags from the Task-1 findings doc. Reuses the M-A3 `transcript-reader` + the #17 tmux fixes.

---

## Prerequisites

- PR #20 (issue #17 — worker grants + tmux bridge fixes) merged, or this branch based on it. The `transcript-reader.ts` per-provider parsing and the corrected `transcriptGlobDir` encoding are reused.
- `pnpm db:up` running; `claude` CLI installed + logged in. Codex/Gemini optional for the spike (mark unavailable ones).

## File Structure

| Path                                                                                                     | Responsibility                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/spikes/2026-06-08-cli-capability-matrix.md`                                            | **(new)** Spike output: verified per-CLI launch/persona/clear/transcript/tool-disable matrix.                                             |
| `packages/chat/sql/0038_chat_live_runtime.sql`                                                           | **(new)** Migration: `chat_threads.last_active_at` + a per-user current-conversation pointer; index.                                      |
| `packages/chat/src/live/types.ts`                                                                        | **(new)** `TranscriptRecord`, `CliChatEngine`, `ChatSessionManager` interfaces + `ChatRecordKind`.                                        |
| `packages/chat/src/live/persona.ts`                                                                      | **(new)** Neutral-dir resolution + persona context-file rendering per provider.                                                           |
| `packages/chat/src/live/cli-chat-engine.ts`                                                              | **(new)** Persistent-session engine per provider (launch/submit/clear/tail), built on injected IO + `transcript-reader`.                  |
| `packages/chat/src/live/chat-session-manager.ts`                                                         | **(new)** Per-user session registry + lifecycle (lazy launch, idle reap, respawn+replay, switch, subscribe).                              |
| `packages/chat/src/repository.ts`                                                                        | **(modify)** Stamp executed provider/model on `updateMessageComplete`; `touchThread(last_active_at)`; `getCurrentThread`/`openNewThread`. |
| `packages/chat/src/routes.ts`                                                                            | **(modify)** Add `POST /api/chat/turn`, `/clear`, `/switch`, `GET /api/chat/stream` (SSE).                                                |
| `apps/web/src/chat/chat-drawer.tsx`                                                                      | **(new)** Slide-in drawer: message log, input, new-chat, provider indicator, history list.                                                |
| `apps/web/src/chat/use-chat-stream.ts`                                                                   | **(new)** SSE client hook → records → React state.                                                                                        |
| `apps/web/src/api/client.ts`                                                                             | **(modify)** `sendChatTurn`, `clearChat`, `switchChatProvider`, stream URL helper.                                                        |
| `tests/unit/chat-live-*.test.ts`, `tests/integration/chat-live.test.ts`, `tests/e2e/chat-drawer.spec.ts` | **(new)** Tests.                                                                                                                          |

---

## Task 1: CLI capability spike (discovery — not TDD)

**Files:** Create `docs/superpowers/spikes/2026-06-08-cli-capability-matrix.md`

- [ ] **Step 1: Verify Claude Code.** In a scratch neutral dir (e.g. `/tmp/jarvis-spike/claude/`) with a `CLAUDE.md` persona file, launch detached in tmux and confirm: (a) a launch system-prompt flag exists and its text is present in the first transcript record; (b) `/clear` resets the conversation but the launch persona/`CLAUDE.md` persists; (c) native tools can be disabled (e.g. `--disallowedTools "Bash Edit Write Read"` or settings) — confirm a bash request is refused; (d) transcript path/format under `~/.claude/projects/<encoded>/`. Record exact flags + observations.

- [ ] **Step 2: Verify Codex CLI** (if installed). Confirm: persona injection (`AGENTS.md` / `developer_instructions` / `model_instructions_file`); `/clear` vs `/new`; **transcript path AND whether it is `.jsonl` or `.jsonl.zst` (compressed)** under `~/.codex/sessions/...`; how to disable shell/file tools. If not installed, mark "UNAVAILABLE — implement adapter behind the matrix, integration-test later."

- [ ] **Step 3: Verify Gemini CLI** (if installed). Confirm: `GEMINI_SYSTEM_MD` replacement (must keep `${AvailableTools}`); `/clear` semantics; transcript path under `~/.gemini/tmp/<hash>/chats/`; tool-disable mechanism. Mark UNAVAILABLE if absent.

- [ ] **Step 4: Write the matrix.** Fill the doc: per CLI × {launch persona flag, persona survives /clear?, /clear command, transcript path, transcript decoding, disable-native-tools flag, MCP config flag (note for Phase 2)}. Flag any item still unconfirmed. **This doc is the source of truth for Tasks 4–5.**

- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/spikes/2026-06-08-cli-capability-matrix.md
git commit -m "spike(jarvis-chat): verified CLI capability matrix (launch/persona/clear/transcript/tool-disable)"
```

---

## Task 2: Migration — conversation activity + executed-model stamp

**Files:** Create `packages/chat/sql/0038_chat_live_runtime.sql`; Test `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Write the failing test** (asserts the new column + grant exist).

```ts
// tests/integration/chat-live.test.ts  (new file; mirror chat.test.ts setup)
it("0038: chat_threads has last_active_at and the worker/app role can update it", async () => {
  const client = new Client({ connectionString: connectionStrings.migration });
  await client.connect();
  try {
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='app' AND table_name='chat_threads' AND column_name='last_active_at'`
    );
    expect(col.rowCount).toBe(1);
  } finally {
    await client.end();
  }
});
```

- [ ] **Step 2: Run it, verify it FAILS.** `vitest run tests/integration/chat-live.test.ts -t "0038"` → fails (column missing).

- [ ] **Step 3: Write the migration.**

```sql
-- packages/chat/sql/0038_chat_live_runtime.sql
-- Live chat: track conversation recency (drawer opens to the most-recent active
-- conversation). Owner-scoped; app_runtime updates it during live turns.
ALTER TABLE app.chat_threads
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS chat_threads_owner_last_active_idx
  ON app.chat_threads (owner_user_id, last_active_at DESC);
```

(The executed-model stamp is a code change in Task 6, not schema — `model_metadata jsonb` already exists.)

- [ ] **Step 4: Migrate + run test, verify PASS.** `pnpm db:migrate && vitest run tests/integration/chat-live.test.ts -t "0038"` → applied `0038_…`, test passes.

- [ ] **Step 5: Commit.**

```bash
git add packages/chat/sql/0038_chat_live_runtime.sql tests/integration/chat-live.test.ts
git commit -m "feat(jarvis-chat): migration 0038 — chat_threads.last_active_at"
```

---

## Task 3: Core types (`packages/chat/src/live/types.ts`)

**Files:** Create `packages/chat/src/live/types.ts`

- [ ] **Step 1: Define the interfaces** (no test — pure types; consumed/tested by later tasks).

```ts
import type { ChatActivityEvent } from "@jarv1s/ai";
import type { ProviderKind } from "@jarv1s/ai"; // ("anthropic" | "openai-compatible" | "google")

export type ChatRecordKind = "user" | "thinking" | "tool" | "status" | "reply" | "error";
export interface TranscriptRecord {
  readonly kind: ChatRecordKind;
  readonly text: string;
}

export interface EngineLaunchOpts {
  readonly neutralDir: string;
  readonly personaPath: string; // rendered persona context file in neutralDir
  readonly mcpConfigPath?: string; // Phase 2 (unused in Phase 1)
}

/** A persistent per-user CLI session. One instance per live session. */
export interface CliChatEngine {
  readonly provider: ProviderKind;
  launch(opts: EngineLaunchOpts): Promise<void>;
  submit(text: string): Promise<void>; // paste prompt + send
  clear(): Promise<void>; // /clear within the session
  /** Read transcript records appended since the given byte offset; returns the new offset. */
  readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }>;
  isAlive(): Promise<boolean>;
  kill(): Promise<void>;
}

export interface ChatTurnSeed {
  readonly priorTurns: readonly { role: "user" | "assistant"; content: string }[];
}
```

- [ ] **Step 2: Commit.**

```bash
git add packages/chat/src/live/types.ts
git commit -m "feat(jarvis-chat): live runtime core types"
```

---

## Task 4: `CliChatEngine` (per-provider, spike-gated)

**Files:** Create `packages/chat/src/live/cli-chat-engine.ts`; Test `tests/unit/chat-live-engine.test.ts`

> Built on the **same injected-IO pattern** as `packages/ai/src/adapters/tmux-bridge.ts` (reuse `TmuxIo` + `parseTranscript` + the #17 `transcriptGlobDir` fix). Exact launch flags (persona, **disable native tools**, no bypass-permissions) and transcript decoding (Codex `.zst`) come from the **Task-1 matrix**.

- [ ] **Step 1: Write the failing test** — a fake IO where the session launches with the persona flag and native-tools-disabled flag, `submit` writes the prompt, and `readNew` parses appended records into `reply`. (Model on `ai-tmux-bridge.test.ts`'s fake IO + Claude fixtures.)

```ts
it("launches with persona + native tools disabled, submits, and reads the reply record", async () => {
  const io = fakeEngineIo(/* transcript that gains an end_turn reply after submit */);
  const engine = new TmuxCliChatEngine("anthropic", "user-1", io);
  await engine.launch({ neutralDir: "/tmp/u1", personaPath: "/tmp/u1/CLAUDE.md" });
  const launchCmd = io.runCalls.find((c) => c.args.includes("new-session"))!.args.join(" ");
  expect(launchCmd).toContain("claude");
  expect(launchCmd).toMatch(/disallowed|disable/i); // native tools off (exact flag from matrix)
  await engine.submit("hello");
  const r1 = await engine.readNew(0);
  // poll-read until complete in the test loop...
  expect(r1.records.some((r) => r.kind === "reply")).toBe(true);
});
```

- [ ] **Step 2: Run it, verify FAIL.** `vitest run tests/unit/chat-live-engine.test.ts` → fails (class missing).

- [ ] **Step 3: Implement `TmuxCliChatEngine`.** Reuse `tmux-bridge`'s session-launch + transcript-resolution + `parseTranscript`; difference from the one-shot bridge: the session is **persistent** (no kill after reply), `submit`/`readNew`/`clear` are separate operations, launch adds the persona flag + **native-tool-disable flag + no bypass-permissions** (from matrix), and `readNew(afterOffset)` returns parsed records + new offset (multi-turn offset insight from #18 applies here). Map `parseTranscript` events → `TranscriptRecord` (`thinking|tool|status` + a `reply` kind when complete). For Codex, decode `.zst` if the matrix says so.

- [ ] **Step 4: Run tests, verify PASS.** `vitest run tests/unit/chat-live-engine.test.ts` → pass.

- [ ] **Step 5: Commit.** `git add packages/chat/src/live/cli-chat-engine.ts tests/unit/chat-live-engine.test.ts && git commit -m "feat(jarvis-chat): TmuxCliChatEngine persistent-session adapter"`

---

## Task 5: Persona renderer (`packages/chat/src/live/persona.ts`)

**Files:** Create `packages/chat/src/live/persona.ts`; Test `tests/unit/chat-live-persona.test.ts`

- [ ] **Step 1: Failing test.**

```ts
it("renders the persona to the provider's context filename in the user's neutral dir", async () => {
  const fs = makeFakeFs();
  const { neutralDir, personaPath } = await renderPersona(fs, {
    userId: "u1",
    userName: "Ben",
    provider: "anthropic",
    baseDir: "/base",
    persona: "You are Jarvis."
  });
  expect(neutralDir).toBe("/base/u1");
  expect(personaPath).toBe("/base/u1/CLAUDE.md"); // AGENTS.md for codex, GEMINI.md for google
  expect(fs.files["/base/u1/CLAUDE.md"]).toContain("You are Jarvis");
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.** Resolve `baseDir` from `JARVIS_CHAT_HOME ?? ~/.jarvis/chat`; `neutralDir = <base>/<userId>`; filename per provider (`anthropic→CLAUDE.md`, `openai-compatible→AGENTS.md`, `google→GEMINI.md`); ensure dir; write the persona (templating `userName`). Inject FS via a small interface (testable; `node:fs/promises` impl).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(jarvis-chat): per-user neutral dir + persona renderer"`

---

## Task 6: Repository — executed-model stamp, thread recency, current/new conversation

**Files:** Modify `packages/chat/src/repository.ts`; Test `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Failing tests** — `updateMessageComplete` stamps the executed `{provider, model}` into `model_metadata`; `getCurrentThread(user)` returns the most-recent `last_active_at` thread; `openNewThread` creates one and makes it current; `touchThread` bumps `last_active_at`. (Use the chat.test.ts DataContext harness.)
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the four repository methods (all via `DataContextDb`; app_runtime already has the grants). Merge into existing `model_metadata` without dropping `route`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(jarvis-chat): repo — executed-model stamp + conversation recency/current"`

---

## Task 7: `ChatSessionManager` (lifecycle, with a fake engine)

**Files:** Create `packages/chat/src/live/chat-session-manager.ts`; Test `tests/unit/chat-live-manager.test.ts`

- [ ] **Step 1: Failing tests** (fake `CliChatEngine` + fake clock):
  - `ensureSession` lazily launches once per user; second call reuses.
  - `submitTurn` submits, drains records via `readNew`, persists user+assistant turns (fake repo), emits records to subscribers, returns the assistant reply.
  - idle reaper kills a session after the idle window; next `submitTurn` **respawns + replays** prior turns as seed.
  - `switchProvider` kills the old engine, launches the new provider, replays prior turns.
  - one engine per user.

```ts
it("respawns and replays prior turns after idle-kill", async () => {
  const m = new ChatSessionManager({
    engineFactory,
    repo,
    clock,
    idleMs: 1000,
    neutralBase: "/b",
    persona: "P"
  });
  await m.submitTurn(ctxU1, "first");
  clock.advance(2000);
  m.reapIdle(); // kill on idle
  const replayed: string[] = [];
  engineFactory.onLaunch = (e) => {
    e.onSeed = (turns) => replayed.push(...turns.map((t) => t.content));
  };
  await m.submitTurn(ctxU1, "second");
  expect(replayed).toContain("first"); // prior turn replayed into the new engine
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `ChatSessionManager`.** In-memory `Map<userId, { engine, providerKey, lastActivity, subscribers }>`; `ensureSession` renders persona (Task 5) + launches engine; `submitTurn` = ensure → submit → poll `readNew` to completion (emitting records to subscribers) → persist (Task 6) → return reply; `clear` = engine.clear + `openNewThread`; `switchProvider` = kill + ensure(newModel) seeded by `repo.listTurns(currentThread)`; `subscribe` returns an async event stream; `reapIdle` kills sessions past `idleMs`. Seeding (replay) builds the seed prompt from prior turns (reuse `buildPromptText` shape).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(jarvis-chat): ChatSessionManager lifecycle (lazy/idle/respawn-replay/switch)"`

---

## Task 8: API routes — turn / clear / switch / stream (SSE)

**Files:** Modify `packages/chat/src/routes.ts`; Test `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Failing integration tests** — `POST /api/chat/turn` (auth required; returns the reply + persists; 401 without session); `POST /api/chat/clear` opens a new current thread; `POST /api/chat/switch` changes provider; `GET /api/chat/stream` is SSE and a user **cannot** read another user's stream (authorize to `actorUserId` only). Inject a **fake engine factory** into the manager for these tests.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** routes that resolve `AccessContext`, call the manager, and (for `/stream`) set SSE headers and pipe the user's subscription, closing on disconnect. The manager is constructed once at server wiring (`registerBuiltInApiRoutes`) with the real engine factory; tests inject a fake.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(jarvis-chat): chat live API — turn/clear/switch/stream(SSE)"`

---

## Task 9: Drawer UI + SSE hook

**Files:** Create `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/chat/use-chat-stream.ts`; Modify `apps/web/src/api/client.ts`; Test `tests/e2e/chat-drawer.spec.ts`

- [ ] **Step 1: API client methods** — `sendChatTurn(text)`, `clearChat()`, `switchChatProvider(modelId)`, and a `chatStreamUrl()` for the SSE `EventSource`.
- [ ] **Step 2: `use-chat-stream.ts`** — open an `EventSource` to the stream, parse `TranscriptRecord` events, append to React state; reconnect on drop.
- [ ] **Step 3: `chat-drawer.tsx`** — slide-in drawer: message log rendering records (user bubbles, "working…/thinking" activity, assistant reply), an input + send, a "New chat" button (`clearChat`), an active-provider indicator, and a history list (existing thread browse routes) to reopen a past conversation read-only. Follow existing `chat-page.tsx` styles/React-Query patterns.
- [ ] **Step 4: E2E (mocked engine)** `tests/e2e/chat-drawer.spec.ts` — open drawer → send → see streamed reply → New chat → switch provider indicator → reopen a history item. (Mock the API per `tests/e2e/mock-*.ts`.)
- [ ] **Step 5: Run** `pnpm test:e2e -g "chat-drawer"`, verify PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(jarvis-chat): chat drawer + SSE streaming UI"`

---

## Task 10: Verify gate + ADR + supersession note

**Files:** Create `docs/architecture/decisions/00XX-interactive-chat-is-cli-transport.md`; Modify GitHub issues.

- [ ] **Step 1: ADR** recording "interactive chat = CLI transport (router-selected among CLI providers); api_key interactive deferred; native shell/file tools disabled; actions via MCP only (Phase 2)."
- [ ] **Step 2: Run the full gate.** `pnpm verify:foundation && pnpm audit:release-hardening` → green.
- [ ] **Step 3: Manual smoke** (record-level): open the drawer, hold a 3-turn conversation with the live `claude` CLI, `/clear`, reopen history. Capture evidence under git-ignored `docs/testing/`.
- [ ] **Step 4: Close #18** (superseded by this runtime) with a note; update the Jarv1s Chat epic checklist.
- [ ] **Step 5: Commit + open PR** for the Phase 1 branch.

---

## Self-Review

- **Spec coverage:** Phase-1 spec §6 — spike (T1), data model (T2,T6), `CliChatEngine` (T4), persona/neutral dir (T5), `ChatSessionManager`+lifecycle (T7), streaming+routes (T8), drawer+history (T9), error-handling (fast-fail/respawn folded into T4/T7), testing (each task), ADR/supersession (T10). Persona content draft lives in the spec §6.3 (rendered by T5). ✓
- **Placeholders:** spike-gated specifics (exact CLI flags, `.zst`) are explicitly sourced from the Task-1 matrix, not vague TODOs. Interfaces are concrete (Task 3). ✓
- **Type consistency:** `CliChatEngine`/`TranscriptRecord`/`ChatRecordKind`/`EngineLaunchOpts` defined in Task 3 are used unchanged in Tasks 4, 7, 8. `readNew(afterOffset)→{records,offset,complete}` consistent across engine + manager. ✓
- **Deferred to Phase 2/3 (not gaps):** MCP/agentic tools, recall/embedding, fact layer — separate plans per the approved sequencing.
