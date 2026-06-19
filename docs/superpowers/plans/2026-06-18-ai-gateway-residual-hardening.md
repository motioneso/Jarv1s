# AI Gateway Residual Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task under coordinated-build. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #123 residuals: race-safe confirmation waiters, restart cleanup for orphaned pending actions, and Codex launch without raw MCP tokens in command strings.

**Architecture:** Keep the existing in-memory confirmation model and make the waiter exist before notification. Add a small DB-owned stale-action cleanup helper and call it once at API/chat startup with a conservative grace window; this avoids inventing a fake actor or bypassing owner-only RLS in app code. For Codex, write a per-session `0600` env file under the neutral dir and source it from the launch line so the command string carries only a path and variable name, not the MCP token value.

**Tech Stack:** TypeScript, Fastify, Kysely/DataContextRunner, Vitest integration + unit tests, existing `TmuxIo.writeFile` / `run("chmod"|"rm")` seam.

---

## Files

- Modify: `packages/ai/src/gateway/gateway.ts` — register waiter before `action_request` emit.
- Create: `packages/ai/sql/<coordinator-assigned>_ai_cancel_stale_assistant_actions.sql` — `SECURITY DEFINER` maintenance helper.
- Modify: `packages/ai/src/manifest.ts` — include assigned AI SQL migration.
- Modify: `packages/ai/src/repository.ts` — call stale pending cancellation helper.
- Modify: `packages/chat/src/routes.ts` — run stale cleanup at chat route startup and document grace.
- Modify: `packages/chat/src/live/cli-chat-engine.ts` — write/source/remove Codex token env file.
- Modify: `packages/chat/README.md` — replace old inline-token limitation with new env-injection behavior and remaining shared-uid limit.
- Test: `tests/integration/mcp-gateway.test.ts`
- Test: `tests/unit/cli-chat-engine.test.ts`
- Test: `tests/unit/ai-tmux-multiplexer.test.ts`
- Test: `tests/unit/ai-herdr-multiplexer.test.ts`
- Test: `tests/unit/ai-redact.test.ts`

## Task 1: Confirmation Waiter Ordering

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write failing lost-wakeup test**

Add an integration test that resolves inside the notifier callback, before `callTool()` reaches the explicit await point:

```ts
it("does not lose an Approve emitted immediately with the action_request", async () => {
  const eagerGateway = new AssistantToolGateway({
    resolveActiveModules: async () => [exampleToolModule],
    repository,
    runner,
    tokens,
    confirmations,
    notifier: {
      emit: (chatSessionId, record) => {
        emitted.push({ chatSessionId, record });
        if (record.kind === "action_request") {
          void eagerGateway.resolveActionRequest(ids.userA, record.actionRequestId, "confirmed");
        }
      }
    },
    confirmTimeoutMs: 30_000
  });
  const token = tokens.mint({
    actorUserId: ids.userA,
    chatSessionId: "s-eager",
    allowedToolNames: null
  });

  const res = await eagerGateway.callTool(token, "example.write", { value: "eager" });

  expect(res.ok).toBe(true);
  expect(exampleToolCalls).toHaveLength(1);
  const rows = await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "r-eager-check" },
    (scopedDb) => repository.listAssistantActions(scopedDb)
  );
  expect(rows.find((r) => r.id === firstActionRequest().actionRequestId)?.status).toBe("confirmed");
});
```

- [ ] **Step 2: Run failing test**

Run: `JARVIS_PGDATABASE=jarv1s_deploy123 pnpm test:integration -- tests/integration/mcp-gateway.test.ts -t "does not lose an Approve"`

Expected: FAIL or timeout because the waiter is registered after notification.

- [ ] **Step 3: Minimal implementation**

In `confirmAndRun`, create the promise before emitting:

```ts
const pendingResolution = this.deps.confirmations.awaitResolution(
  action.id,
  this.deps.confirmTimeoutMs
);

this.deps.notifier.emit(ctx.chatSessionId, {
  kind: "action_request",
  actionRequestId: action.id,
  toolName: found.dto.name,
  summary: this.summaryFor(found.tool, input, ctx)
});

const outcome = await pendingResolution;
```

- [ ] **Step 4: Verify task**

Run: `JARVIS_PGDATABASE=jarv1s_deploy123 pnpm test:integration -- tests/integration/mcp-gateway.test.ts`

Expected: PASS, including existing confirm-after-timeout guard.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts tests/integration/mcp-gateway.test.ts
git commit -m "fix(ai): register confirmation waiter before notify" \
  -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 2: Stale Pending Action Cleanup

**Files:**

- Create: `packages/ai/sql/<coordinator-assigned>_ai_cancel_stale_assistant_actions.sql`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/ai/src/repository.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/chat/README.md`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Confirm migration number**

Ask Coordinator to assign the SQL filename before coding this task. Current highest observed migration is `0097_chat_memory_corrections_update_grant.sql`; do not assume `0098` without approval because sibling branches may land migrations first.

- [ ] **Step 2: Write failing repository cleanup test**

Add test rows through the repository for two owners, age one row for each owner with SQL, run cleanup once, assert stale rows for both owners are cancelled while fresh rows stay pending. This proves startup cleanup is DB-owned, not scoped to whichever user happened to trigger it:

```ts
it("cancels stale pending assistant actions while leaving fresh pending actions pending", async () => {
  let staleId = "";
  let freshId = "";
  let otherStaleId = "";
  await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "r-stale-seed" },
    async (scopedDb) => {
      const stale = await repository.createPendingAssistantAction(scopedDb, {
        toolModuleId: "example",
        toolModuleName: "Example",
        toolName: "example.write",
        permissionId: "example.write",
        risk: "write",
        inputSummary: { inputKeyCount: 0 },
        requestId: "stale"
      });
      const fresh = await repository.createPendingAssistantAction(scopedDb, {
        toolModuleId: "example",
        toolModuleName: "Example",
        toolName: "example.write",
        permissionId: "example.write",
        risk: "write",
        inputSummary: { inputKeyCount: 0 },
        requestId: "fresh"
      });
      staleId = stale.id;
      freshId = fresh.id;
    }
  );
  await runner.withDataContext(
    { actorUserId: ids.userB, requestId: "r-stale-seed-b" },
    async (scopedDb) => {
      const other = await repository.createPendingAssistantAction(scopedDb, {
        toolModuleId: "example",
        toolModuleName: "Example",
        toolName: "example.write",
        permissionId: "example.write",
        risk: "write",
        inputSummary: { inputKeyCount: 0 },
        requestId: "stale-b"
      });
      otherStaleId = other.id;
    }
  );
  await sql`
    UPDATE app.ai_assistant_action_requests
    SET requested_at = now() - interval '10 minutes',
        updated_at = now() - interval '10 minutes'
    WHERE id IN (${staleId}::uuid, ${otherStaleId}::uuid)
  `.execute(appDb);
  await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "r-stale-seed-fresh" },
    async (scopedDb) => {
      await scopedDb.db
        .updateTable("app.ai_assistant_action_requests")
        .set({ updated_at: new Date() })
        .where("id", "=", freshId)
        .execute();
    }
  );

  const cancelled = await repository.cancelStalePendingAssistantActions(appDb, {
    olderThan: new Date(Date.now() - 5 * 60_000)
  });

  expect(cancelled).toBe(2);
  const userARows = await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "r-stale-check" },
    (scopedDb) => repository.listAssistantActions(scopedDb)
  );
  const userBRows = await runner.withDataContext(
    { actorUserId: ids.userB, requestId: "r-stale-check-b" },
    (scopedDb) => repository.listAssistantActions(scopedDb)
  );
  expect(userARows.find((r) => r.id === staleId)?.status).toBe("cancelled");
  expect(userARows.find((r) => r.id === staleId)?.resolved_at).toBeTruthy();
  expect(userARows.find((r) => r.id === freshId)?.status).toBe("pending");
  expect(userBRows.find((r) => r.id === otherStaleId)?.status).toBe("cancelled");
});
```

- [ ] **Step 3: Run failing test**

Run: `JARVIS_PGDATABASE=jarv1s_deploy123 pnpm test:integration -- tests/integration/mcp-gateway.test.ts -t "cancels stale pending"`

Expected: FAIL with missing `cancelStalePendingAssistantActions`.

- [ ] **Step 4: Add SQL helper**

Create the Coordinator-assigned SQL file:

```sql
CREATE OR REPLACE FUNCTION app.cancel_stale_ai_assistant_action_requests(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE app.ai_assistant_action_requests
  SET status = 'cancelled',
      resolved_at = now(),
      updated_at = now()
  WHERE status = 'pending'
    AND requested_at < older_than;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.cancel_stale_ai_assistant_action_requests(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cancel_stale_ai_assistant_action_requests(timestamptz)
  TO jarvis_app_runtime;
```

Add the filename to `aiModuleManifest.database.migrations`.

- [ ] **Step 5: Add repository method**

```ts
async cancelStalePendingAssistantActions(
  appDb: Kysely<JarvisDatabase>,
  input: { readonly olderThan: Date }
): Promise<number> {
  const row = await sql<{ count: number }>`
    SELECT app.cancel_stale_ai_assistant_action_requests(${input.olderThan}) AS count
  `.execute(appDb);
  return Number(row.rows[0]?.count ?? 0);
}
```

- [ ] **Step 6: Add startup cleanup hook**

In `registerChatRoutes`, after wiring is created:

```ts
const STALE_ACTION_GRACE_MS = 5 * 60_000;

server.addHook("onReady", async () => {
  if (!wiring) return;
  const cutoff = new Date(Date.now() - STALE_ACTION_GRACE_MS);
  const count = await wiring.aiRepository.cancelStalePendingAssistantActions(dependencies.rootDb, {
    olderThan: cutoff
  });
  if (count > 0) server.log.info({ count }, "cancelled stale assistant action requests");
});
```

This requires adding `rootDb: Kysely<JarvisDatabase>` to `ChatRoutesDependencies` and passing it from module registry. It is a bounded DB-owned maintenance call; it returns only a count and does not expose private row content.

- [ ] **Step 7: Document behavior**

In `packages/chat/README.md`, add:

```md
## Assistant action restart cleanup

Pending write/destructive tool approvals are in-memory waits. On API startup, Jarv1s cancels pending action requests older than the startup grace window so a restart leaves visible terminal `cancelled` rows instead of approvals that can never resume. Fresh pending rows stay pending.
```

- [ ] **Step 8: Verify task**

Run: `JARVIS_PGDATABASE=jarv1s_deploy123 pnpm test:integration -- tests/integration/mcp-gateway.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ai/sql/<coordinator-assigned>_ai_cancel_stale_assistant_actions.sql packages/ai/src/manifest.ts packages/ai/src/repository.ts packages/chat/src/routes.ts packages/chat/README.md tests/integration/mcp-gateway.test.ts
git commit -m "fix(ai): cancel stale assistant action requests" \
  -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 3: Codex Token File Launch Hygiene

**Files:**

- Modify: `packages/chat/src/live/cli-chat-engine.ts`
- Modify: `packages/chat/README.md`
- Test: `tests/unit/cli-chat-engine.test.ts`
- Test: `tests/unit/ai-redact.test.ts`

- [ ] **Step 1: Write failing Codex launch test**

Change existing Codex unit test to assert token value is not in launch line, token file is written, and file mode is forced to `0600`:

```ts
expect(launchLine).toContain("codex");
expect(launchLine).toContain('bearer_token_env_var="JARVIS_MCP_TOKEN"');
expect(launchLine).not.toContain("JARVIS_MCP_TOKEN=jst_codex");
expect(launchLine).not.toContain("jst_codex");
expect(launchLine).toContain(".jarvis-mcp-token.env");
const writeCall = io.writeFile.mock.calls.find((c) =>
  String(c[0]).endsWith(".jarvis-mcp-token.env")
);
expect(writeCall?.[1]).toContain("jst_codex");
expect(io.run).toHaveBeenCalledWith("chmod", ["600", "/tmp/neutral/.jarvis-mcp-token.env"]);
```

Add cleanup assertion to an existing `kill()`-oriented unit test or new focused test:

```ts
await engine.kill();
expect(io.run).toHaveBeenCalledWith("rm", ["-f", "/tmp/neutral/.jarvis-mcp-token.env"]);
```

- [ ] **Step 2: Run failing unit tests**

Run: `pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/ai-redact.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 3: Implement token file**

Add a private `codexTokenEnvPath: string | null = null;` field.

Before building/launching Codex when `opts.mcpToken` exists:

```ts
private async writeCodexTokenEnv(opts: EngineLaunchOpts): Promise<string | null> {
  if (!opts.mcpToken) return null;
  const path = join(opts.neutralDir, ".jarvis-mcp-token.env");
  await this.io.writeFile(
    path,
    `JARVIS_MCP_TOKEN=${shellQuote(opts.mcpToken)}\nexport JARVIS_MCP_TOKEN\n`
  );
  await this.io.run("chmod", ["600", path]);
  return path;
}
```

In `launch()`:

```ts
this.codexTokenEnvPath =
  this.provider === "openai-compatible" ? await this.writeCodexTokenEnv(opts) : null;
const launchLine = this.buildLaunchCommand(opts, sessionId);
```

For Codex:

```ts
const sourceEnv = this.codexTokenEnvPath ? `. ${shellQuote(this.codexTokenEnvPath)} &&` : "";
const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, sourceEnv, "codex"];
```

In `kill()`:

```ts
const tokenEnvPath = this.codexTokenEnvPath;
this.codexTokenEnvPath = null;
if (tokenEnvPath) await this.io.run("rm", ["-f", tokenEnvPath]);
```

- [ ] **Step 4: Verify redaction still catches old token shapes**

Keep `tests/unit/ai-redact.test.ts` expecting `JARVIS_MCP_TOKEN=jst_...` and `Bearer jst_...` redaction, even though launch no longer uses the env prefix.

- [ ] **Step 5: Verify task**

Run: `pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/ai-redact.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/cli-chat-engine.ts packages/chat/README.md tests/unit/cli-chat-engine.test.ts tests/unit/ai-redact.test.ts
git commit -m "fix(chat): keep codex mcp token out of launch line" \
  -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 4: Focused Regression And Gate

**Files:**

- No new source unless previous tasks expose compile failures.

- [ ] **Step 1: Run focused checks**

```bash
pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/ai-tmux-multiplexer.test.ts tests/unit/ai-herdr-multiplexer.test.ts tests/unit/ai-redact.test.ts tests/unit/mcp-gateway-units.test.ts
JARVIS_PGDATABASE=jarv1s_deploy123 pnpm test:integration -- tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/chat-live.test.ts
```

Expected: PASS.

- [ ] **Step 2: Pre-push trio and rebase**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
git fetch origin main
git rebase origin/main
```

Expected: PASS / up to date.

- [ ] **Step 3: Full acceptance gate**

```bash
JARVIS_PGDATABASE=jarv1s_deploy123 pnpm verify:foundation
```

Expected: PASS.

- [ ] **Step 4: Final commit if formatting/type fixes were needed**

```bash
git add <only-files-touched>
git commit -m "chore(ai): satisfy hardening verification" \
  -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Self-Review

- Spec coverage: Task 1 covers waiter-before-notification and immediate Approve. Existing timeout test plus Task 1 guard covers Approve-after-timeout. Task 2 covers stale pending cancellation and docs. Task 3 covers no raw Codex MCP token in launch command/backend calls and keeps redaction regression.
- Placeholder scan: no TBD/TODO/fill-in-later steps. Coordinator must assign the migration filename before Task 2 coding; this is an explicit coordination gate, not an implementation placeholder.
- Type consistency: repository cleanup takes root `Kysely<JarvisDatabase>` only to call a DB-owned helper returning count; normal row reads remain `DataContextDb`.
