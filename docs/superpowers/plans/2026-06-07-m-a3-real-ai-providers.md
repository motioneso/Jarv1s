# M-A3 Real AI Provider Calls — Implementation Plan

> **For agentic workers:** This plan is executed by a **Workflow** (Claude Code's built-in
> orchestration), not the superpowers execution skills (disabled in this repo). Build agents run on
> **Sonnet**. Steps use checkbox (`- [ ]`) syntax. Each task says **[SERIAL]** or **[PARALLEL:group]**
> — see _Execution Topology_.

**Goal:** Make chat real — a routed chat-capable model actually answers, via the user's local
`claude`/`codex`/`gemini` CLIs (subscription, in tmux) with a BYO-API-key HTTP fallback, executed
asynchronously with the agent's "working" activity surfaced live in a collapsible panel.

**Architecture:** A provider-agnostic `ChatProviderAdapter` (one interface, two transports) sits
behind a `createChatAdapter` factory keyed by the provider's `auth_method` + `provider_kind`. Chat
enqueues a metadata-only pg-boss job; a worker drives the turn, streams activity into the assistant
message, and writes the final reply. The CLI transport runs each provider as an interactive session
in a per-thread tmux session and reads the CLI's **JSONL session transcript** for activity + reply.

**Tech Stack:** TypeScript (ESM/NodeNext), Fastify REST + `@jarv1s/shared` contracts, Kysely +
Postgres, pg-boss (`@jarv1s/jobs` `registerDataContextWorker`), tmux (new bundled dep), Vitest
(mocked boundaries), React Query web shell.

**Spec:** `docs/superpowers/specs/m-a3-real-ai-providers.md` (approved).

---

## Execution Topology (for the Workflow author)

Same hard constraint as M-A1: **integration tests share one Postgres DB** and cannot run
concurrently, and repo-wide `typecheck`/`lint` + the git index serialize. So:

```
Phase 0  [SERIAL]      Task 1  chat-adapter interface + types          (no DB)
Phase 1  [PARALLEL]    Task 2  tmux-bridge + transcript-reader  ┐
                       Task 3  http-api adapter                 ├ worktree-isolated, unit tests only
                       Task 4  cli-availability helper          ┘ (mock boundaries → NO Postgres)
            └── merge worktrees → main, serial typecheck gate
Phase 2  [SERIAL,DB]   Task 5  auth_method migration + types + DTOs + ai repo/routes
                       Task 6  createChatAdapter factory wiring + ai exports
                       Task 7a chat DTOs/status + repository enqueue (pending)
                       Task 7b chat worker: drive adapter, activity, reply
Phase 3  [SERIAL]      Task 8  web activity panel (collapsible) + polling + provider auth_method UI
Phase 4  [SERIAL gate] Task 9  verify:foundation + audit + manual smoke + docs + GitHub close-out
```

**Why Phase 1 parallelizes:** Tasks 2–4 create disjoint NEW files and their tests **mock the
subprocess/tmux/HTTP/fs boundaries**, so they never touch Postgres and never edit a shared file.
Run each in its own worktree, then merge (clean — disjoint files). Everything in Phase 2+ touches
the shared DB and/or shared files (`ai/index.ts`, `chat/repository.ts`, `shared/*-api.ts`,
`db/types.ts`) and must be serial.

**Parallel-phase rule:** Tasks 2–4 must NOT edit `packages/ai/src/index.ts` (a hot shared import) —
exports are added serially in Task 6. They import the interface from Task 1 directly.

---

## File Structure

| Action | File                                              | Responsibility                                                              | Phase |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Create | `packages/ai/src/chat-adapter.ts`                 | `ChatTurn`, `ChatActivityEvent`, `ChatProviderAdapter`, `createChatAdapter` | 0 / 6 |
| Create | `packages/ai/src/adapters/tmux-bridge.ts`         | tmux session driver (create/send/inspect) for all `cli` providers           | 1     |
| Create | `packages/ai/src/adapters/transcript-reader.ts`   | Per-provider JSONL transcript reader → activity events + final reply        | 1     |
| Create | `packages/ai/src/adapters/http-api.ts`            | API-key HTTP transport per `provider_kind`                                  | 1     |
| Create | `packages/ai/src/cli-availability.ts`             | CLI + tmux **presence** detection (PATH only)                               | 1     |
| Create | `packages/ai/sql/00NN_ai_auth_method.sql`         | `auth_method` column on `app.ai_provider_configs`                           | 2     |
| Modify | `packages/ai/src/repository.ts`                   | persist/read `auth_method`; presence into `cliAvailable`                    | 2     |
| Modify | `packages/ai/src/routes.ts`                       | accept `auth_method`; expose `authMethod` + `cliAvailable`                  | 2     |
| Modify | `packages/ai/src/index.ts`                        | export adapters, factory, types                                             | 2     |
| Modify | `packages/shared/src/ai-api.ts`                   | `authMethod`, `cliAvailable` on provider DTOs                               | 2     |
| Create | `packages/chat/sql/00NN_chat_status_activity.sql` | extend message status + activity (if constrained)                           | 2     |
| Modify | `packages/chat/src/manifest.ts`                   | declare `CHAT_EXECUTION_QUEUE`                                              | 2     |
| Create | `packages/chat/src/jobs.ts`                       | queue def + `registerChatJobWorkers` (drive adapter)                        | 2     |
| Modify | `packages/chat/src/repository.ts`                 | enqueue job; `working`/`stored`/`error`; activity log                       | 2     |
| Modify | `packages/shared/src/chat-api.ts`                 | activity DTO; `working`/`error` statuses                                    | 2     |
| Modify | `packages/db/src/types.ts`                        | `auth_method`; new message statuses; activity shape                         | 2     |
| Modify | `apps/web/src/chat/*`                             | collapsible activity panel + polling                                        | 3     |
| Modify | `apps/web/src/ai/*` (or settings)                 | `auth_method` selector + `cliAvailable` warning                             | 3     |
| Modify | `docs/STATUS.md`                                  | milestone close-out                                                         | 4     |

---

## Phase 0 — Foundation contract

### Task 1: Chat adapter interface + types **[SERIAL]**

**Files:** Create `packages/ai/src/chat-adapter.ts`

This is a pure type/contract file (no runtime behavior yet → no unit test; the factory is wired in
Task 6). It must compile and be importable so Phase-1 adapters can implement it.

- [ ] **Step 1: Create the interface file**

```ts
import type { AiConfiguredModelSafeRow } from "./repository.js";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatActivityEvent {
  readonly kind: "thinking" | "tool" | "status" | "other";
  readonly text: string;
}

export interface GenerateChatInput {
  readonly model: AiConfiguredModelSafeRow;
  readonly messages: readonly ChatTurn[];
  /** Streams progress while working. Final answer is returned whole (no token-streaming). */
  readonly onActivity?: (event: ChatActivityEvent) => void;
}

export interface ChatProviderAdapter {
  generateChat(input: GenerateChatInput): Promise<{ readonly text: string }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (file compiles; `AiConfiguredModelSafeRow` already exported from `repository.ts`).

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/chat-adapter.ts
git commit -m "feat(ai): chat provider adapter interface + activity event types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 1 — Adapters (parallel, worktree-isolated, no DB)

> Each Phase-1 task: own worktree, mock all boundaries, **do not edit `index.ts`**. Tests run via
> Vitest but must NOT hit Postgres (no `resetEmptyFoundationDatabase`, no `DataContextRunner`).
> Place tests under `tests/unit/` (create the dir) so they're outside the DB-integration suite.

### Task 2: tmux bridge + transcript reader **[PARALLEL:A]**

**Files:**

- Create `packages/ai/src/adapters/transcript-reader.ts`
- Create `packages/ai/src/adapters/tmux-bridge.ts`
- Test: `tests/unit/ai-tmux-bridge.test.ts`

- [ ] **Step 1 (DISCOVERY — do this first, it's not optional):** Capture a real transcript for each
      CLI and record the exact JSONL schema. Run, for Claude:

  ```bash
  ls -t ~/.claude/projects/*/*.jsonl | head -1 | xargs tail -5
  ```

  and the equivalent for Codex (`~/.codex/`) and Gemini (`~/.gemini/` or its log dir — locate with
  `find ~ -maxdepth 4 -iname '*.jsonl' -path '*codex*'` / `*gemini*`). Write the observed shapes
  (which field holds role, which holds text, how assistant-final vs intermediate events look) as a
  comment block at the top of `transcript-reader.ts`. **The parser in Step 3 must match what you
  observed, not this plan's guess.**

- [ ] **Step 2: Write the failing test** (`tests/unit/ai-tmux-bridge.test.ts`) using a **fixture
      JSONL string** matching what you discovered. Example (adapt fields to reality):

```ts
import { describe, it, expect, vi } from "vitest";
import { parseTranscript } from "../../packages/ai/src/adapters/transcript-reader.js";

describe("parseTranscript", () => {
  it("returns activity events for intermediate records and the final assistant reply", () => {
    // Replace with the REAL schema captured in Step 1.
    const jsonl = [
      JSON.stringify({ type: "thinking", text: "considering options" }),
      JSON.stringify({ type: "tool_use", text: "ran search" }),
      JSON.stringify({ type: "assistant", text: "Here is the answer.", final: true })
    ].join("\n");

    const result = parseTranscript("anthropic", jsonl, /*afterOffset*/ 0);

    expect(result.events.map((e) => e.kind)).toEqual(["thinking", "tool"]);
    expect(result.reply).toBe("Here is the answer.");
    expect(result.complete).toBe(true);
  });

  it("reports incomplete when no final assistant record is present yet", () => {
    const jsonl = JSON.stringify({ type: "thinking", text: "..." });
    const result = parseTranscript("anthropic", jsonl, 0);
    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails** — `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts`
      → FAIL (`parseTranscript` not defined).

- [ ] **Step 4: Implement `transcript-reader.ts`** — a pure function (easy to test, no I/O):

```ts
import type { ChatActivityEvent } from "../chat-adapter.js";

export type ProviderKind = "anthropic" | "openai-compatible" | "google";

export interface TranscriptParseResult {
  readonly events: readonly ChatActivityEvent[];
  readonly reply: string | null;
  readonly complete: boolean;
}

// NOTE: field names below MUST match the schema captured in Step 1 per provider.
export function parseTranscript(
  provider: ProviderKind,
  jsonl: string,
  afterOffset: number
): TranscriptParseResult {
  const lines = jsonl
    .slice(afterOffset)
    .split("\n")
    .filter((l) => l.trim());
  const events: ChatActivityEvent[] = [];
  let reply: string | null = null;
  let complete = false;

  for (const line of lines) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // partial trailing line while the CLI is mid-write
    }
    const mapped = mapRecord(provider, rec);
    if (mapped.final) {
      reply = mapped.text;
      complete = true;
    } else if (mapped.activity) {
      events.push(mapped.activity);
    }
  }
  return { events, reply, complete };
}

// Per-provider record mapping — fill in from the Step-1 discovery.
function mapRecord(
  provider: ProviderKind,
  rec: Record<string, unknown>
): { final: boolean; text: string | null; activity: ChatActivityEvent | null } {
  // Implement the real mapping per provider here. Keep it total (default to a benign 'other').
  // ... (match observed schema) ...
  return { final: false, text: null, activity: { kind: "other", text: JSON.stringify(rec) } };
}
```

- [ ] **Step 5: Implement `tmux-bridge.ts`** — the `ChatProviderAdapter` that owns the tmux session
      and polls the transcript. Inject the subprocess + fs boundaries so they're mockable:

```ts
import type { ChatProviderAdapter, GenerateChatInput } from "../chat-adapter.js";
import { parseTranscript, type ProviderKind } from "./transcript-reader.js";

export interface TmuxIo {
  run(cmd: string, args: readonly string[]): Promise<{ code: number; stdout: string }>;
  readFile(path: string): Promise<string>;
  sleep(ms: number): Promise<void>;
}

const CLI_FOR: Record<ProviderKind, string> = {
  anthropic: "claude",
  "openai-compatible": "codex",
  google: "gemini"
};

export class TmuxBridgeAdapter implements ChatProviderAdapter {
  constructor(
    private readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    private readonly opts: { timeoutMs?: number; pollMs?: number } = {}
  ) {}

  async generateChat(input: GenerateChatInput): Promise<{ text: string }> {
    // 1. ensure tmux session exists (tmux new-session -d -s jarv1s-<threadKey> <cli>)
    // 2. resolve transcript path (per provider; from Step-1 discovery)
    // 3. record current transcript length (afterOffset)
    // 4. send prompt: tmux load-buffer (temp file) + paste-buffer + send-keys Enter
    // 5. poll: read transcript, parseTranscript(provider, jsonl, afterOffset);
    //    emit input.onActivity for each new event; stop when complete or timeout
    // 6. return { text: reply } or throw a clear error on timeout/dead-session/empty
    throw new Error("implement against TmuxIo using the discovered transcript path");
  }
}
```

Then write the test's bridge case: inject a fake `TmuxIo` whose `readFile` returns the fixture
JSONL after N polls; assert `onActivity` fired per event and the returned text matches. Make the
real implementation pass it.

- [ ] **Step 6: Run tests** — `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts` → PASS.

- [ ] **Step 7: Commit** (do NOT touch `index.ts`)

```bash
git add packages/ai/src/adapters/transcript-reader.ts packages/ai/src/adapters/tmux-bridge.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat(ai): tmux CLI bridge adapter + JSONL transcript reader

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: HTTP API adapter **[PARALLEL:B]**

**Files:** Create `packages/ai/src/adapters/http-api.ts`; Test `tests/unit/ai-http-api.test.ts`

- [ ] **Step 1: Failing test** — inject a fake `fetch`, assert request shape + response→`{text}` for
      each provider kind, and that the key never appears in thrown errors.

```ts
import { describe, it, expect } from "vitest";
import { HttpApiAdapter } from "../../packages/ai/src/adapters/http-api.js";

const model = { provider_kind: "anthropic", provider_model_id: "claude-x" } as any;

describe("HttpApiAdapter", () => {
  it("calls the anthropic endpoint and maps the reply text", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 });
    const adapter = new HttpApiAdapter("anthropic", "sk-test", {
      fetch: fakeFetch as typeof fetch
    });
    const out = await adapter.generateChat({ model, messages: [{ role: "user", content: "yo" }] });
    expect(out.text).toBe("hi");
  });

  it("throws a clear error without leaking the key", async () => {
    const fakeFetch = async () => new Response("nope", { status: 401 });
    const adapter = new HttpApiAdapter("anthropic", "sk-secret", {
      fetch: fakeFetch as typeof fetch
    });
    await expect(adapter.generateChat({ model, messages: [] })).rejects.toThrow(/401/);
    await expect(adapter.generateChat({ model, messages: [] })).rejects.not.toThrow(/sk-secret/);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm vitest run tests/unit/ai-http-api.test.ts`

- [ ] **Step 3: Implement `http-api.ts`** — `ChatProviderAdapter` with a per-kind request builder +
      response mapper (anthropic Messages, openai-compatible Chat Completions w/ `base_url`, google
      generateContent). Accept an injectable `fetch` in opts (default global `fetch`). Never include the
      key in error messages.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/http-api.ts tests/unit/ai-http-api.test.ts
git commit -m "feat(ai): API-key HTTP chat adapter (anthropic/openai/google)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: CLI availability (presence only) **[PARALLEL:C]**

**Files:** Create `packages/ai/src/cli-availability.ts`; Test `tests/unit/ai-cli-availability.test.ts`

- [ ] **Step 1: Failing test** — inject a fake PATH-lookup; assert present/absent per binary and that
      it never probes auth.

```ts
import { describe, it, expect } from "vitest";
import { cliAvailable } from "../../packages/ai/src/cli-availability.js";

describe("cliAvailable", () => {
  it("true when the binary resolves on PATH", async () => {
    expect(await cliAvailable("anthropic", { which: async () => "/usr/bin/claude" })).toBe(true);
  });
  it("false when the binary is missing", async () => {
    expect(await cliAvailable("anthropic", { which: async () => null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — map kind→binary (`claude`/`codex`/`gemini`), resolve via injected
      `which` (default: `node:child_process` lookup or `command -v`); also export `tmuxAvailable()`.
      **No auth probing.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/cli-availability.ts tests/unit/ai-cli-availability.test.ts
git commit -m "feat(ai): CLI + tmux presence detection (no auth probe)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> **After Phase 1:** merge the three worktrees into the integration branch (disjoint files → clean),
> then run `pnpm typecheck` once as a serial gate before Phase 2.

---

## Phase 2 — Wiring (serial, DB)

### Task 5: `auth_method` column + types + DTOs + ai repo/routes **[SERIAL, DB]**

**Files:** Create `packages/ai/sql/00NN_ai_auth_method.sql`; Modify `packages/ai/src/manifest.ts`,
`packages/db/src/types.ts`, `packages/shared/src/ai-api.ts`, `packages/ai/src/repository.ts`,
`packages/ai/src/routes.ts`; Test `tests/integration/ai.test.ts`.

- [ ] **Step 1 (DISCOVERY):** find the next migration number (the M-A1 lesson: numbers are global
      across modules). `ls packages/*/sql/*.sql | sort | tail -3` and pick the next integer. Confirm the
      `app.ai_provider_configs` table name + columns: `grep -n "ai_provider_configs" packages/ai/sql/*.sql`.

- [ ] **Step 2: Write the migration** `packages/ai/sql/00NN_ai_auth_method.sql`:

```sql
ALTER TABLE app.ai_provider_configs
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'api_key'
    CHECK (auth_method IN ('cli', 'api_key'));
```

Register it in `packages/ai/src/manifest.ts` `database.migrations`. Update
`tests/integration/foundation.test.ts` migration snapshot count (M-A1 lesson: this test asserts an
exact applied-migration list).

- [ ] **Step 3: Failing integration test** in `tests/integration/ai.test.ts`: create a provider with
      `authMethod: "cli"`, read it back, assert `authMethod === "cli"` and `hasCredential === false`;
      default remains `"api_key"`.

- [ ] **Step 4: Run → FAIL.** `pnpm test:ai`

- [ ] **Step 5: Implement** — add `auth_method` to `AiProviderConfigsTable` (db/types.ts) and
      `AiProviderConfigSafeRow`; thread it through `CreateAiProviderInput`/`UpdateAiProviderInput` +
      repository writes/reads; add `authMethod` + `cliAvailable` to `AiProviderConfigDto`
      (shared/ai-api.ts) and populate `cliAvailable` in routes via `cli-availability`. For `cli`
      providers, skip the credential requirement.

- [ ] **Step 6: Run → PASS** (`pnpm test:ai`), then `pnpm db:migrate` clean.

- [ ] **Step 7: Commit** (list the exact files).

### Task 6: `createChatAdapter` factory + ai exports **[SERIAL]**

**Files:** Modify `packages/ai/src/chat-adapter.ts` (add factory), `packages/ai/src/index.ts`;
Test `tests/unit/ai-chat-adapter-factory.test.ts`.

- [ ] **Step 1: Failing test** — factory returns `TmuxBridgeAdapter` for `auth_method="cli"` and
      `HttpApiAdapter` for `"api_key"`, keyed by `provider_kind`; throws clearly for an unsupported kind.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `createChatAdapter(provider, model, deps)`** in `chat-adapter.ts` wiring the
      Phase-1 adapters; decrypt the key for `api_key` via existing `ai/crypto.ts`. Export adapters +
      factory + types from `packages/ai/src/index.ts`.
- [ ] **Step 4: Run → PASS;** `pnpm typecheck`.
- [ ] **Step 5: Commit.**

### Task 7a: chat statuses + activity DTO + repository enqueue **[SERIAL, DB]**

**Files:** Modify `packages/shared/src/chat-api.ts`, `packages/db/src/types.ts`,
`packages/chat/src/repository.ts`, `packages/chat/src/manifest.ts`; maybe Create
`packages/chat/sql/00NN_chat_status_activity.sql`; Test `tests/integration/chat.test.ts`.

- [ ] **Step 1 (DISCOVERY):** check how `status` is constrained: `grep -n "status" packages/chat/sql/*.sql`.
      If there's a `CHECK`/enum, add a migration extending it with `working` and `error`; if it's free
      text, no migration needed. Check where activity should live (reuse `model_metadata` JSONB).
- [ ] **Step 2: Failing test** — `appendUserMessage` with an available route now stores the assistant
      message as `pending` AND enqueues exactly one metadata-only job
      (`{ actorUserId, threadId, assistantMessageId }`). Assert the job is enqueued (inject a fake boss
      or assert via a captured enqueue) and the payload has only those keys.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — declare `CHAT_EXECUTION_QUEUE` in `manifest.ts`; add `working`/`error`
      to `ChatMessageStatus` (shared/chat-api.ts + db/types.ts) and an `activity: ChatActivityEventDto[]`
      field surfaced from `model_metadata`; change `appendUserMessage` to set `pending` + enqueue the job
      (give `ChatRepository` a `boss`/enqueue dependency, mirroring how `tasks` enqueues — see
      `packages/tasks/src/routes.ts` + `jobs.ts`). Keep `no_model`/`blocked` behavior.
- [ ] **Step 5: Run → PASS** (`pnpm test:chat`).
- [ ] **Step 6: Commit.**

### Task 7b: chat worker drives the adapter **[SERIAL, DB]**

**Files:** Create `packages/chat/src/jobs.ts`; Modify `packages/chat/src/repository.ts` (worker-side
update helpers); register the worker in the module-registry path; Test `tests/integration/chat.test.ts`.

- [ ] **Step 1 (DISCOVERY):** copy the worker pattern from `packages/tasks/src/jobs.ts`
      (`registerDataContextWorker`, `ActorScopedJobPayload`, metadata-only guard, `QueueDefinition`) and
      find where tasks' queue defs + workers are wired into `@jarv1s/module-registry`
      (`getAllQueueDefinitions`, `registerBuiltInModuleWorkers`). Wire chat the same way.
- [ ] **Step 2: Failing integration test** — enqueue a chat job for a `pending` assistant message;
      run the worker handler with a **fake `createChatAdapter`** that emits two activity events and
      returns `"the answer"`; assert the message transitions `pending`→`working`→`stored`, body is
      `"the answer"`, and `model_metadata.activity` has the two events. A failing adapter → `error`
      status with a clear message.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** `registerChatJobWorkers(boss, dataContext, deps)`: resolve thread history
      via the scoped DB, build `ChatTurn[]`, select model via the capability router, call
      `createChatAdapter(...).generateChat({ messages, onActivity })`, persisting activity incrementally
      and the final reply; set statuses; guard payload is metadata-only (throw otherwise). Register its
      `QueueDefinition` + worker in the module-registry path.
- [ ] **Step 5: Run → PASS;** `pnpm test:chat`.
- [ ] **Step 6: Commit.**

---

## Phase 3 — Web

### Task 8: Activity panel + polling + provider auth UI **[SERIAL]**

**Files:** Modify `apps/web/src/chat/*` and `apps/web/src/ai/*` (or settings); Test: extend
Playwright/e2e mocks if present, else manual.

- [ ] **Step 1 (DISCOVERY):** read the current chat page + React Query hooks
      (`apps/web/src/chat/*`, `apps/web/src/api/*`) to match patterns.
- [ ] **Step 2: Implement polling** — while the latest assistant message status is `pending` or
      `working`, refetch the messages query on an interval (React Query `refetchInterval`); stop when
      `stored`/`error`.
- [ ] **Step 3: Implement the collapsible activity panel** — render `message.activity` in a
      `<details>`-style panel **collapsed by default**, with a "working…" indicator while `working`,
      then the final reply body.
- [ ] **Step 4: Provider config UI** — add an `auth_method` selector (cli/api_key) and show a warning
      when `cliAvailable === false` for a `cli` provider.
- [ ] **Step 5: Verify** — `pnpm build:web` + `pnpm --filter @jarv1s/web typecheck`; manual check via
      `pnpm dev:web` (headless: `pnpm --filter @jarv1s/web dev -- --host`).
- [ ] **Step 6: Commit.**

---

## Phase 4 — Verify & close out

### Task 9: Full gate + smoke + bookkeeping **[SERIAL gate]**

- [ ] **Step 1:** `pnpm verify:foundation` → green (lint, format:check, check:file-size, typecheck,
      db:migrate, test:integration). Fix any **real** regressions; do not wave off failures as
      "pre-existing" without confirming against `main` (see the `verify-agent-claims` rule).
- [ ] **Step 2:** `pnpm audit:release-hardening` → `passed true`.
- [ ] **Step 3: Manual smoke (not CI):** ensure `tmux` + the three CLIs are installed/logged in;
      configure each provider `auth_method=cli`; send a chat; confirm a real reply + the activity panel
      populates; `tmux attach` shows the live session.
- [ ] **Step 4:** `pnpm check:file-size` — split any file approaching 1000 lines (watch
      `chat/repository.ts`, `ai/routes.ts`).
- [ ] **Step 5:** update `docs/STATUS.md` (last-known-good counts, next step → M-A4). Commit.
- [ ] **Step 6 (orchestrator, not a build agent):** verify green yourself, then close epic #4 + the
      M-A3 milestone on GitHub, move the board to Done. Save an agentmemory lesson for any non-obvious
      discovery (CLI transcript schemas, the status-constraint migration).

---

## Self-Review

- **Spec coverage:** 3 providers (T2/T3/T6), CLI-via-tmux + JSONL transcript (T2), API-key backup
  (T3), router-agnostic factory (T6), async worker + metadata-only payload (T7a/T7b), live
  collapsible activity (T7b/T8), presence-only CLI check (T4/T5), `auth_method` (T5), verify +
  invariants (T9). ✓
- **Known honest gaps (by design, not placeholders):** exact CLI transcript schemas, exact tmux
  send/timing, and the chat status constraint are **discovery steps** (T2/T7a/T7b Step 1) because
  they're external/unknown — each says how to find the truth before implementing.
- **Type consistency:** `ChatProviderAdapter.generateChat({model, messages, onActivity}) →
{text}`, `ChatActivityEvent {kind,text}`, `createChatAdapter`, `auth_method`/`authMethod`,
  statuses `pending→working→stored|error` — used consistently across tasks.
- **Parallel safety:** Phase-1 tasks touch only their own new files + `tests/unit/`, never `index.ts`
  or the DB; exports/wiring happen serially in Task 6.
