# Codex Non-Interactive Execution Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-level Codex execution-mode setting and make `non_interactive` Codex preserve the same chat/tool behavior as the current interactive path.

**Architecture:** Store `executionMode` on AI provider configs, expose it through existing admin provider APIs, and render it in the admin provider card. Keep `ChatSessionManager` and `CliChatEngine` as the external runtime contract; route the selected provider's mode into the engine factory and hide Codex `codex exec --json` transcript differences inside the Codex engine/transcript adapter.

**Tech Stack:** TypeScript, Fastify JSON schemas, Kysely/Postgres migrations, React settings pane, Vitest unit/integration tests, Codex CLI transcript JSONL.

---

## File Map

- Modify: `packages/shared/src/ai-types.ts` - add `AiProviderExecutionMode` and thread `executionMode` through provider DTO/request types.
- Modify: `packages/shared/src/ai-api.ts` - add JSON schema for the execution-mode enum and provider payloads.
- Create: `packages/ai/sql/0099_provider_execution_mode.sql` - add `execution_mode` to `app.ai_provider_configs` with default `interactive`.
- Modify: `packages/db/src/schema.ts` or generated DB schema home if this repo uses a different Kysely type file - add the column to `AiProviderConfigsTable`.
- Modify: `packages/ai/src/repository.ts` - read/write `execution_mode` in safe provider rows.
- Modify: `packages/ai/src/routes.ts` - validate and map create/update provider payloads.
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx` - render the admin `Execution mode` segmented control.
- Modify: `packages/chat/src/live/types.ts` - add optional execution-mode launch/factory threading, if the selected provider config is not already available at engine construction.
- Modify: `packages/chat/src/live/runtime.ts` - pass execution mode into `CliChatEngineImpl` construction.
- Modify: `packages/chat/src/live/cli-chat-engine.ts` - choose Codex interactive vs non-interactive command/session behavior internally.
- Modify: `packages/ai/src/adapters/transcript-reader.ts` - parse Codex `response_item.function_call` and `response_item.function_call_output`.
- Modify: `tests/unit/ai-tmux-bridge.test.ts` - pin Codex transcript parser parity.
- Modify or create: `tests/integration/ai-provider-execution-mode.test.ts` - API persistence and validation tests.
- Modify or create: focused runtime tests beside existing chat live tests - prove factory selection honors provider execution mode.

## Task 1: Add Shared Execution Mode Types And Schemas

**Files:**

- Modify: `packages/shared/src/ai-types.ts`
- Modify: `packages/shared/src/ai-api.ts`

- [ ] **Step 1: Add the shared type first**

In `packages/shared/src/ai-types.ts`, add the enum near the provider types:

```ts
export type AiProviderExecutionMode = "interactive" | "non_interactive";
```

Then add `executionMode` to:

```ts
export interface AiProviderConfigDto {
  readonly id: string;
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly status: AiProviderStatus;
  readonly authMethod: AiAuthMethod;
  readonly executionMode: AiProviderExecutionMode;
  readonly hasCredential: boolean;
  readonly cliAvailable: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Add optional request fields:

```ts
export interface CreateAiProviderConfigRequest {
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly executionMode?: AiProviderExecutionMode;
  readonly credentialPayload?: Record<string, unknown>;
}

export interface UpdateAiProviderConfigRequest {
  readonly providerKind?: AiProviderKind;
  readonly displayName?: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly executionMode?: AiProviderExecutionMode;
  readonly credentialPayload?: Record<string, unknown>;
}
```

- [ ] **Step 2: Add the JSON schema**

In `packages/shared/src/ai-api.ts`, add:

```ts
export const aiProviderExecutionModeSchema = {
  type: "string",
  enum: ["interactive", "non_interactive"]
} as const;
```

Add `"executionMode"` to `aiProviderConfigSchema.required`, and add:

```ts
executionMode: aiProviderExecutionModeSchema,
```

Add optional `executionMode` properties to create/update provider request schemas:

```ts
executionMode: aiProviderExecutionModeSchema,
```

- [ ] **Step 3: Run the focused typecheck**

Run:

```bash
pnpm typecheck
```

Expected: Type errors in repository/route/UI call sites that have not been updated yet. If there are unrelated pre-existing errors, record them in the task notes and continue to Task 2.

## Task 2: Persist Execution Mode On Provider Configs

**Files:**

- Create: `packages/ai/sql/0099_provider_execution_mode.sql`
- Modify: `packages/db/src/schema.ts` or the repo's Kysely schema file for `AiProviderConfigsTable`
- Modify: `packages/ai/src/repository.ts`

- [ ] **Step 1: Add a migration**

Create `packages/ai/sql/0099_provider_execution_mode.sql` unless another merged change has already
claimed `0099`; in that case use the next available number in `packages/ai/sql/`.

```sql
ALTER TABLE app.ai_provider_configs
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'interactive';

ALTER TABLE app.ai_provider_configs
  ADD CONSTRAINT ai_provider_configs_execution_mode_check
  CHECK (execution_mode IN ('interactive', 'non_interactive'));
```

Do not edit applied migrations.

- [ ] **Step 2: Update DB table typing**

Find `AiProviderConfigsTable` and add:

```ts
execution_mode: string;
```

If the local table type uses a stricter union, use:

```ts
execution_mode: "interactive" | "non_interactive";
```

- [ ] **Step 3: Update repository row types**

In `packages/ai/src/repository.ts`, import `AiProviderExecutionMode` from `@jarv1s/shared` if the DB table type is not already strict enough. Add:

```ts
readonly execution_mode: AiProviderExecutionMode;
```

to `AiProviderConfigSafeRow`.

Add optional input fields:

```ts
readonly executionMode?: AiProviderExecutionMode;
```

to both `CreateAiProviderInput` and `UpdateAiProviderInput`.

- [ ] **Step 4: Select the column**

In `safeProviderQuery()`, add `"execution_mode"` to the selected provider columns.

- [ ] **Step 5: Insert and update the column**

In the repository create method, include:

```ts
execution_mode: input.executionMode ?? "interactive",
```

In the repository update method, include `execution_mode` only when `input.executionMode !== undefined`.

- [ ] **Step 6: Run repository-level compile check**

Run:

```bash
pnpm typecheck
```

Expected: remaining errors should point to API mapping/UI call sites, not repository missing fields.

## Task 3: Thread Execution Mode Through API Routes

**Files:**

- Modify: `packages/ai/src/routes.ts`
- Test: `tests/integration/ai-provider-execution-mode.test.ts`

- [ ] **Step 1: Write the failing API test**

Create `tests/integration/ai-provider-execution-mode.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("AI provider execution mode", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("defaults providers to interactive mode", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Codex",
        authMethod: "cli"
      }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().provider.executionMode).toBe("interactive");
  });

  it("persists provider execution mode updates", async () => {
    const createRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Codex Noninteractive",
        authMethod: "cli",
        executionMode: "non_interactive"
      }
    });
    expect(createRes.statusCode).toBe(201);
    const providerId = createRes.json().provider.id;

    const patchRes = await server.inject({
      method: "PATCH",
      url: `/api/ai/providers/${providerId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { executionMode: "interactive" }
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().provider.executionMode).toBe("interactive");
  });

  it("rejects unknown execution modes", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Bad Codex",
        authMethod: "cli",
        executionMode: "batch"
      }
    });

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run tests/integration/ai-provider-execution-mode.test.ts
```

Expected: FAIL because API mapping and/or schema does not yet include `executionMode`.

- [ ] **Step 3: Map route payloads**

In `packages/ai/src/routes.ts`, update provider DTO mapping to return:

```ts
executionMode: row.execution_mode,
```

Update create/update body parsing so it passes:

```ts
executionMode: body.executionMode,
```

to repository create/update calls.

- [ ] **Step 4: Run the API test**

Run:

```bash
pnpm vitest run tests/integration/ai-provider-execution-mode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai-types.ts packages/shared/src/ai-api.ts packages/ai/sql packages/db/src/schema.ts packages/ai/src/repository.ts packages/ai/src/routes.ts tests/integration/ai-provider-execution-mode.test.ts
git commit -m "feat: persist provider execution mode"
```

## Task 4: Add The Admin Execution Mode Control

**Files:**

- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx`
- Test: existing settings/admin pane tests if present; otherwise `pnpm typecheck`

- [ ] **Step 1: Add the prop callback**

Extend `ProviderCard` props with:

```ts
readonly onExecutionMode: (id: string, executionMode: AiProviderExecutionMode) => void;
```

Import `AiProviderExecutionMode` from the shared API/type export already used in the file.

- [ ] **Step 2: Render the segmented control in edit mode**

Inside the existing `props.editing` block, add a `Field` near the authentication control:

```tsx
<Field label="Execution mode">
  <Segmented<AiProviderExecutionMode>
    value={provider.executionMode}
    options={[
      { value: "interactive", label: "Interactive" },
      { value: "non_interactive", label: "Non-interactive" }
    ]}
    ariaLabel="Execution mode"
    onChange={(v) => props.onExecutionMode(provider.id, v)}
  />
</Field>
```

- [ ] **Step 3: Wire the mutation**

In the parent pane, add a handler that calls the existing provider update helper:

```ts
const updateExecutionMode = (id: string, executionMode: AiProviderExecutionMode) =>
  updateProviderMutation.mutate({ id, input: { executionMode } });
```

Pass it to `ProviderCard`.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS, or only unrelated pre-existing errors recorded in the task notes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-ai-admin-pane.tsx
git commit -m "feat: add provider execution mode control"
```

## Task 5: Extend Codex Transcript Parsing

**Files:**

- Modify: `packages/ai/src/adapters/transcript-reader.ts`
- Modify: `tests/unit/ai-tmux-bridge.test.ts`

- [ ] **Step 1: Add failing parser fixtures**

In `tests/unit/ai-tmux-bridge.test.ts`, add fixtures beside the existing Codex fixtures:

```ts
const CODEX_EXEC_FUNCTION_CALL = JSON.stringify({
  timestamp: "2026-06-26T12:00:00.000Z",
  type: "response_item",
  payload: {
    type: "function_call",
    name: "shell",
    arguments: "{\"cmd\":\"git status --short\"}"
  }
});

const CODEX_EXEC_FUNCTION_OUTPUT = JSON.stringify({
  timestamp: "2026-06-26T12:00:01.000Z",
  type: "response_item",
  payload: {
    type: "function_call_output",
    output: "?? docs/superpowers/specs/example.md"
  }
});
```

Add a test:

```ts
it("maps non-interactive Codex function call records to tool activity", () => {
  const jsonl = [CODEX_EXEC_FUNCTION_CALL, CODEX_EXEC_FUNCTION_OUTPUT, CODEX_FIXTURE_FINAL].join(
    "\n"
  );

  const result = parseTranscript("openai-compatible", jsonl, 0);

  expect(result.events.map((e) => e.kind)).toEqual(["tool", "tool"]);
  expect(result.events[0]?.text).toContain("shell");
  expect(result.events[1]?.text).toContain("function_call_output");
  expect(result.complete).toBe(true);
  expect(result.reply).toBe("All done, sir.");
});
```

- [ ] **Step 2: Run the failing parser test**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts
```

Expected: FAIL because `mapCodexRecord()` ignores `response_item`.

- [ ] **Step 3: Implement the minimal parser change**

In `packages/ai/src/adapters/transcript-reader.ts`, update `mapCodexRecord()` to branch on both record families:

```ts
function mapCodexRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  if (rec["type"] === "response_item") {
    mapCodexResponseItem(rec, events);
    return;
  }
  if (rec["type"] !== "event_msg") return;

  const payload = rec["payload"] as Record<string, unknown> | undefined;
  if (!payload) return;

  const payloadType = payload["type"] as string | undefined;

  switch (payloadType) {
    case "agent_reasoning": {
      const text = typeof payload["text"] === "string" ? payload["text"] : "";
      events.push({ kind: "thinking", text });
      break;
    }
    case "exec_command_end": {
      const command = payload["command"];
      const cmdText = Array.isArray(command) ? command.join(" ") : String(command ?? "");
      events.push({ kind: "tool", text: cmdText });
      break;
    }
    case "agent_message": {
      const text = typeof payload["message"] === "string" ? payload["message"] : "";
      events.push({ kind: "status", text });
      break;
    }
    case "task_complete": {
      const msg = payload["last_agent_message"];
      if (typeof msg === "string") onFinal(msg);
      break;
    }
  }
}

function mapCodexResponseItem(rec: Record<string, unknown>, events: ChatActivityEvent[]): void {
  const payload = rec["payload"] as Record<string, unknown> | undefined;
  if (!payload) return;
  const payloadType = payload["type"];

  if (payloadType === "function_call") {
    const name = typeof payload["name"] === "string" ? payload["name"] : "function_call";
    events.push({ kind: "tool", text: name });
    return;
  }

  if (payloadType === "function_call_output") {
    events.push({ kind: "tool", text: "function_call_output" });
  }
}
```

Keep this minimal. Do not parse arbitrary JSON `arguments` unless a later test proves the UI needs it.

- [ ] **Step 4: Run the parser tests**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/transcript-reader.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat: parse codex exec tool records"
```

## Task 6: Thread Execution Mode Into Chat Runtime Selection

**Files:**

- Modify: `packages/chat/src/live/types.ts`
- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/chat/src/live/cli-chat-engine.ts`
- Modify or create: focused unit test beside `tests/unit/chat-session-manager.test.ts`

- [ ] **Step 1: Add a runtime option type**

In `packages/chat/src/live/types.ts`, import the shared execution mode type and add an optional field to the launch or factory path. Prefer factory-level threading if the provider config is known before engine construction:

```ts
import type { AiProviderExecutionMode } from "@jarv1s/shared";
```

Add where the local code shape fits best:

```ts
readonly executionMode?: AiProviderExecutionMode;
```

- [ ] **Step 2: Add a failing runtime-selection test**

Create a test that constructs `CliChatEngineImpl` for `openai-compatible` with `executionMode: "non_interactive"` and asserts the Codex command builder path includes `exec --json` rather than the interactive command. If private method access makes this awkward, test through a fake `TmuxIo.run` launch capture.

Expected captured launch line contains:

```text
codex exec --json
```

and the interactive default still contains the existing Codex launch shape.

- [ ] **Step 3: Add an engine option**

In `packages/chat/src/live/cli-chat-engine.ts`, extend `CliChatEngineOpts`:

```ts
readonly executionMode?: AiProviderExecutionMode;
```

Store it on the class with default:

```ts
this.executionMode = opts.executionMode ?? "interactive";
```

- [ ] **Step 4: Split the Codex command internally**

Keep the existing interactive Codex command unchanged. Add a non-interactive branch in the Codex command builder:

```ts
if (this.executionMode === "non_interactive") {
  return ["codex", "exec", "--json", "--sandbox", "read-only", "-a", "never", ...modelArgs].join(" ");
}
```

Preserve existing security flags and model behavior. Do not route other providers through this branch.

- [ ] **Step 5: Pass provider config mode into the factory**

Update the runtime path that resolves the active provider/model so engine construction receives the provider config's `executionMode`. If the current factory only receives `provider` and `sessionKey`, introduce the smallest compatible extension:

```ts
export type ChatEngineFactory = (
  provider: ProviderKind,
  sessionKey: string,
  opts?: { readonly executionMode?: AiProviderExecutionMode }
) => CliChatEngine;
```

Then pass `opts.executionMode` into `CliChatEngineImpl`.

- [ ] **Step 6: Run runtime tests**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts
```

Expected: PASS plus the new runtime-selection assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/live/types.ts packages/chat/src/live/runtime.ts packages/chat/src/live/cli-chat-engine.ts tests/unit/chat-session-manager.test.ts
git commit -m "feat: route codex execution mode to engine"
```

## Task 7: Verify End-To-End Behavior

**Files:**

- Existing tests only unless a focused integration test is needed for a regression found here.

- [ ] **Step 1: Run focused provider tests**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts tests/integration/ai-provider-execution-mode.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run chat/runtime tests**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the repo gate**

Run:

```bash
pnpm verify:foundation
```

Expected: PASS. If it fails for unrelated pre-existing reasons, record the failing command and exact failure in the handoff.

- [ ] **Step 4: Manual live Codex parity smoke**

In a dev environment with Codex CLI auth available, configure the Codex provider `Execution mode` to `Non-interactive`, then send:

```text
Reply with exactly: codex noninteractive ok
```

Expected: final reply contains only:

```text
codex noninteractive ok
```

Then send a prompt that requires visible local tool use in the neutral chat dir:

```text
List the names of files in the current directory and then say done.
```

Expected: the activity stream shows tool activity and the turn completes.

- [ ] **Step 5: Commit any verification-only test fixes**

If verification exposed only test fixture drift, commit those fixes explicitly:

```bash
git add packages/ai/src/adapters/transcript-reader.ts tests/unit/ai-tmux-bridge.test.ts tests/integration/ai-provider-execution-mode.test.ts
git commit -m "test: cover codex noninteractive execution mode"
```

## Self-Review Checklist

- [ ] Provider config APIs expose `executionMode`.
- [ ] Admin UI can edit `Execution mode`.
- [ ] Runtime selection honors the provider config value.
- [ ] `ChatSessionManager` and `CliChatEngine` public contract are unchanged.
- [ ] Codex interactive transcript parsing still passes.
- [ ] Codex non-interactive tool records map to Jarv1s tool activity.
- [ ] No silent fallback from non-interactive to interactive mode was introduced.
