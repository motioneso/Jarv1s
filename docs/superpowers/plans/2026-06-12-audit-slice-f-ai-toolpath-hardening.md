# Audit Slice F — AI Tool-Path Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four gaps in the AI tool invocation path — validate REST tool input before execute, enforce a server-side per-session tool allowlist in the MCP gateway, thread a real `actorUserId` and `requestId` into the briefings `ToolContext`, and replace the unscoped `listTools()` with an actor-scoped `listToolsForActor()` — so that no call site reaches a tool handler with blank actor identity or unvalidated caller-supplied input.

**Architecture:** All four fixes live in `packages/ai/src/` or its dependents (`packages/chat/src/routes.ts`, `packages/chat/src/mcp-transport.ts`, `packages/briefings/src/repository.ts`). The gateway (`AssistantToolGateway`) grows a session-allowlist check inside `callTool` that fires when `SessionIdentity.allowedToolNames` is non-null; `SessionIdentity` gains a new **non-optional** `allowedToolNames: Set<string> | null` field (non-optional so the typecheck surfaces every mint call site). The per-session allowlist is captured at the single production mint site — the `mcpTokenLifecycle.mint` closure in `packages/chat/src/routes.ts:93` — from `gateway.listToolsForActor(actorUserId)`. The `listTools()` method on `AssistantToolGateway` is deleted and replaced with `listToolsForActor(actorUserId: string)`, which delegates to the already-actor-scoped `executableTools` private method. The MCP transport (`mcp-transport.ts`) captures the verified `identity` and uses `identity.actorUserId` for `tools/list`. The REST route adds a `validateToolInput` + `ToolInputValidationError → 400` guard before executing a read tool. The briefings worker threads `definition.owner_user_id` and `pgboss:<job.id>` (or `briefing:<runId>`) into `ToolContext` to replace the blank strings.

**Tech Stack:** TypeScript, Fastify, `@jarv1s/ai` (gateway, session-tokens, input-validation), `@jarv1s/module-sdk` (ToolContext), `@jarv1s/briefings` (repository, jobs), Vitest integration + unit tests (Docker Postgres), pnpm workspaces.

---

## Dependency note

This slice is **parallel-safe** with migration spine slices B, D, and E. It shares no files with those slices. Build as one atomic PR — all four issues touch `packages/ai/` or its dependents and must ship together so the `listTools` deletion does not break the MCP transport mid-flight. Migration count: **0** (code-only).

---

## Task 1: Extend `SessionIdentity` with `allowedToolNames`

**Files:**

- Modify: `packages/ai/src/gateway/session-tokens.ts` (lines 3–6, the `SessionIdentity` interface; lines 22 and 28, `mint` / `verify` signatures are unchanged but callers gain the new field)
- Test: `tests/unit/mcp-gateway-units.test.ts` (session token registry describe block at lines 38–48)

### Steps

1. - [ ] Confirm the current `SessionIdentity` interface shape so the diff is clean:

   ```bash
   grep -n "SessionIdentity\|allowedToolNames\|actorUserId\|chatSessionId" packages/ai/src/gateway/session-tokens.ts
   ```

   Expected: lines 3–6 show the two-field interface with no `allowedToolNames`.

2. - [ ] Edit `packages/ai/src/gateway/session-tokens.ts` — add `allowedToolNames` to `SessionIdentity`:

   ```typescript
   export interface SessionIdentity {
     readonly actorUserId: string;
     readonly chatSessionId: string;
     /**
      * When non-null, only tools whose names appear in this set may be called
      * via this session token.  null = unrestricted (REST and non-MCP paths).
      */
     readonly allowedToolNames: Set<string> | null;
   }
   ```

   The `mint` and `verify` method bodies are unchanged — they pass `SessionIdentity` opaquely and no type annotation needs updating there.

3. - [ ] Run typecheck to surface every call site that now needs the new field:

   ```bash
   pnpm typecheck
   ```

   Expected: TypeScript errors at every `tokens.mint({ actorUserId, chatSessionId })` call missing `allowedToolNames` — the one production site `packages/chat/src/routes.ts:93`, plus the test sites in `tests/integration/mcp-gateway.test.ts`, `tests/integration/chat-mcp-transport.test.ts`, and `tests/unit/mcp-gateway-units.test.ts`. Note each failing file — they are fixed in Task 2 (the production site gets a temporary `null`, replaced by Task 4) and this task's step 4.

4. - [ ] Update the unit test at `tests/unit/mcp-gateway-units.test.ts` line 41 — add `allowedToolNames: null` to the mint call so existing token tests pass under the new interface:

   ```typescript
   const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

   expect(registry.verify(token)).toEqual({
     actorUserId: "u1",
     chatSessionId: "s1",
     allowedToolNames: null
   });
   ```

5. - [ ] Run the unit suite to confirm session token tests still pass:

   ```bash
   vitest run tests/unit/mcp-gateway-units.test.ts
   ```

   Expected: all tests pass (the other describe blocks are unaffected).

6. - [ ] Commit. NOTE: repo-wide `pnpm typecheck` is intentionally still red here — the mint call sites in Tasks 2/4 have not been updated yet. This is an expected intermediate state inside a single atomic PR; do NOT "fix" it by reverting the interface change. The unit suite run in step 5 is green because step 4 already updated the unit test:
   ```bash
   git add packages/ai/src/gateway/session-tokens.ts tests/unit/mcp-gateway-units.test.ts
   git commit -m "feat(ai/gateway): extend SessionIdentity with allowedToolNames for per-session allowlist"
   ```

---

## Task 2: Add server-side allowlist enforcement in `callTool` and update all `mint` call sites with `allowedToolNames: null`

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts` (lines 51–71, the `callTool` method; lines 47–49, `listTools` is DELETED in Task 3 — do not add `allowedToolNames` logic to `listTools`)
- Modify: `packages/chat/src/routes.ts` (line 93, the **only production** `tokens.mint` call, inside the `mcpTokenLifecycle.mint` closure — add a TEMPORARY `allowedToolNames: null` here so typecheck passes; Task 4 replaces it with the captured allowlist)
- Modify: `tests/integration/mcp-gateway.test.ts` (the `tokens.mint` calls at lines 71, 83, 105, 119, 133, 142, 157, … — every `tokens.mint` call in the file gets `allowedToolNames: null`)
- Modify: `tests/integration/chat-mcp-transport.test.ts` (the 7 `tokens.mint` calls at lines 105, 121, 132, 148, 173, 270, 304 — every one gets `allowedToolNames: null`)
- (No change to `tests/integration/briefings.test.ts` — it contains **no** `tokens.mint` calls.)

### Steps

1. - [ ] Add the allowlist guard inside `callTool` in `packages/ai/src/gateway/gateway.ts`. The guard fires immediately after the `executableTools` lookup, before the `validateToolInput` call. The complete updated `callTool` method (lines 51–71):

   ```typescript
   async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
     const { actorUserId, chatSessionId, allowedToolNames } = this.deps.tokens.verify(token);
     const ctx: ToolContext = { actorUserId, requestId: `mcp_${randomUUID()}`, chatSessionId };

     const found = this.executableTools(actorUserId).find((entry) => entry.tool.name === toolName);
     if (!found) {
       return { ok: false, error: `Tool not available: ${toolName}` };
     }

     // Server-side per-session allowlist check (defense-in-depth on top of executableTools).
     // Only fires when allowedToolNames is non-null (MCP sessions with a captured allowlist).
     // null = unrestricted (REST path tokens minted without an allowlist).
     if (allowedToolNames !== null && !allowedToolNames.has(toolName)) {
       return { ok: false, error: `Tool not in session allowlist: ${toolName}` };
     }

     let input: Record<string, unknown>;
     try {
       input = validateToolInput(found.tool.inputSchema, rawInput);
     } catch (error) {
       return { ok: false, error: error instanceof Error ? error.message : "Invalid input" };
     }

     if (resolvePolicy(found.tool.risk) === "run") {
       return this.runHandler(found, input, ctx);
     }
     return this.confirmAndRun(found, input, ctx);
   }
   ```

2. - [ ] Fix the remaining `mint` call sites that TypeScript flagged in Task 1 step 3. `SessionIdentity.allowedToolNames` is non-optional, so EVERY `mint` call — production and test — must now pass it.

   - **Production:** in `packages/chat/src/routes.ts` line 93, inside the `mcpTokenLifecycle.mint` closure, add a TEMPORARY `allowedToolNames: null` (Task 4 replaces this with the captured set):
     ```typescript
     mint: (actorUserId: string) => ({
       // TEMPORARY: Task 4 replaces null with the captured per-session allowlist.
       token: tokens!.mint({ actorUserId, chatSessionId: actorUserId, allowedToolNames: null }),
       mcpServerUrl
     }),
     ```
   - **Tests:** in `tests/integration/mcp-gateway.test.ts`, every `tokens.mint` call (lines 71, 83, 105, 119, 133, 142, 157, …) must include `allowedToolNames: null`:
     ```typescript
     const token = tokens.mint({
       actorUserId: ids.userA,
       chatSessionId: "s1",
       allowedToolNames: null
     });
     ```
     In `tests/integration/chat-mcp-transport.test.ts`, every `tokens.mint` call (lines 105, 121, 132, 148, 173, 270, 304) must include `allowedToolNames: null`.

3. - [ ] Run typecheck — expect zero errors now that all mint call sites have been updated:

   ```bash
   pnpm typecheck
   ```

   Expected: zero type errors.

4. - [ ] Add an allowlist enforcement test to `tests/integration/mcp-gateway.test.ts`. Insert after the last existing `it` block (line 168), inside the `describe("AssistantToolGateway", ...)` block:

   ```typescript
   it("blocks a tool call when allowedToolNames is set and the tool is not in it", async () => {
     // Mint a restricted token that only allows example.write
     const token = tokens.mint({
       actorUserId: ids.userA,
       chatSessionId: "s-allowlist",
       allowedToolNames: new Set(["example.write"])
     });

     // example.read is a valid tool for this actor but is NOT in the allowlist
     const res = await gateway.callTool(token, "example.read", { value: "blocked" });

     expect(res.ok).toBe(false);
     if (res.ok) throw new Error("expected not ok");
     expect(res.error).toContain("not in session allowlist");
     expect(exampleToolCalls).toHaveLength(0);
   });

   it("allows a tool call when allowedToolNames is null (unrestricted)", async () => {
     const token = tokens.mint({
       actorUserId: ids.userA,
       chatSessionId: "s-unrestricted",
       allowedToolNames: null
     });

     const res = await gateway.callTool(token, "example.read", { value: "allowed" });

     expect(res.ok).toBe(true);
     expect(exampleToolCalls).toHaveLength(1);
   });
   ```

5. - [ ] Run the mcp-gateway integration suite to confirm both new tests pass and existing tests are unaffected:

   ```bash
   vitest run tests/integration/mcp-gateway.test.ts
   ```

   Expected: all tests green.

6. - [ ] Commit:
   ```bash
   git add packages/ai/src/gateway/gateway.ts packages/chat/src/routes.ts tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts
   git commit -m "feat(ai/gateway): server-side per-session tool allowlist in callTool (#119)"
   ```

---

## Task 3: Delete `listTools()`, add `listToolsForActor(actorUserId)`, update MCP transport and tests

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts` (lines 47–49, delete `listTools()`, add `listToolsForActor`)
- Modify: `packages/chat/src/mcp-transport.ts` (line 99, replace `listTools()` call; lines 68–73, capture the discarded `verify()` result into an `identity` binding so `actorUserId` is available)
- Modify: `tests/integration/mcp-gateway.test.ts` (line 63, the `listTools()` call in the first `it` block; plus the new actor-scoping test)
- Modify: `tests/integration/chat-mcp-transport.test.ts` (lines 131–145, the `tools/list` test; plus a new actor-scoped transport test)

### Steps

1. - [ ] Write a failing, **actor-dependent** test first — add it to `tests/integration/mcp-gateway.test.ts`. This is the security point of #172: the test must FAIL if `listToolsForActor` ignores its `actorUserId` argument. The shared `gateway` in `beforeEach` uses `resolveActiveModules: () => [exampleToolModule]` (line 52), which ignores the actor — so build a LOCAL gateway whose `resolveActiveModules` is actor-dependent:

   ```typescript
   it("listToolsForActor is actor-scoped — a different actor gets a different list", () => {
     // resolveActiveModules returns the example module ONLY for userA; userB gets nothing.
     // If listToolsForActor ignored its argument (the bug listTools() had), userB would
     // get the same non-empty list and this test would fail — which is exactly the point.
     const scopedGateway = new AssistantToolGateway({
       resolveActiveModules: (actorUserId) =>
         actorUserId === ids.userA ? [exampleToolModule] : [],
       repository,
       runner,
       tokens,
       confirmations,
       notifier: { emit: () => {} },
       confirmTimeoutMs: 1000
     });

     const aNames = scopedGateway.listToolsForActor(ids.userA).map((tool) => tool.name);
     const bNames = scopedGateway.listToolsForActor(ids.userB).map((tool) => tool.name);

     expect(aNames).toContain("example.read");
     expect(aNames).toContain("example.write");
     expect(bNames).toEqual([]); // userB has no active modules -> no tools
   });
   ```

   (`AssistantToolGateway`, `repository`, `runner`, `tokens`, `confirmations` are all already in scope in this suite — see the `beforeAll`/`beforeEach` setup at lines 35–60.)

2. - [ ] Confirm the test fails before the implementation:

   ```bash
   pnpm typecheck 2>&1 | grep -i "listToolsForActor\|listTools"
   ```

   Expected: TypeScript error — `listToolsForActor` does not exist on `AssistantToolGateway`.

3. - [ ] In `packages/ai/src/gateway/gateway.ts`:
   - Delete the `listTools()` method (lines 47–49):
     ```typescript
     // DELETE THIS:
     listTools(): AiAssistantToolDto[] {
       return this.executableTools("").map((entry) => entry.dto);
     }
     ```
   - Add `listToolsForActor` in its place:
     ```typescript
     /** Returns only tools executable by this actor (via resolveActiveModules). */
     listToolsForActor(actorUserId: string): AiAssistantToolDto[] {
       return this.executableTools(actorUserId).map((entry) => entry.dto);
     }
     ```

4. - [ ] Update `packages/chat/src/mcp-transport.ts` — the `tools/list` handler at line 95:
   - The current code at lines 68–73 verifies the token but DISCARDS the return value of `deps.tokens.verify(token)`. Replace it so the identity is captured into a binding:
     ```typescript
     // Replaces the current lines 68-73 (which call deps.tokens.verify(token) and
     // discard the result inside a try/catch):
     const token = auth.slice(7);
     let identity: ReturnType<typeof deps.tokens.verify>;
     try {
       identity = deps.tokens.verify(token);
     } catch {
       return reply.code(401).send(jsonRpcError(null, -32600, "Invalid or expired session token"));
     }
     ```
   - Update the `tools/list` handler to use `identity.actorUserId` (previously line 95–101):
     ```typescript
     if (method === "tools/list") {
       return reply.code(200).send({
         jsonrpc: "2.0",
         id,
         result: { tools: deps.gateway.listToolsForActor(identity.actorUserId).map(dtoToMcpTool) }
       });
     }
     ```
   - The `tools/call` handler already passes `token` to `gateway.callTool` — no change needed there.

5. - [ ] Update `tests/integration/mcp-gateway.test.ts` line 63 — replace the `listTools()` call with `listToolsForActor(ids.userA)`:

   ```typescript
   it("lists only tools that have an execute handler", () => {
     const names = gateway.listToolsForActor(ids.userA).map((tool) => tool.name);
     expect(names).toContain("example.read");
     expect(names).toContain("example.write");
     expect(names).toContain("example.destroy");
     expect(names).not.toContain("example.declaration-only");
   });
   ```

6. - [ ] Update the existing `tools/list` test in `tests/integration/chat-mcp-transport.test.ts` (lines 131–145) — add `allowedToolNames: null` to its `tokens.mint` call (handled in Task 2) and keep its existing assertions. Then ADD a new **actor-dependent transport-level** test that fails if the transport passes a blank/wrong actor to `listToolsForActor`. The shared `app`/`gateway` (built in `beforeAll` with the actor-independent `resolveActiveModules: () => [exampleToolModule]`, lines 60–71) cannot prove scoping, so build a LOCAL gateway + app whose modules are actor-dependent:

   ```typescript
   it("tools/list is actor-scoped at the transport level — userB token yields an empty list", async () => {
     const scopedTokens = new SessionTokenRegistry();
     const scopedGateway = new AssistantToolGateway({
       resolveActiveModules: (actorUserId) =>
         actorUserId === ids.userA ? [exampleToolModule] : [],
       repository: new AiRepository(),
       runner: new DataContextRunner(appDb),
       tokens: scopedTokens,
       confirmations: new ConfirmationRegistry(),
       notifier: { emit: () => {} },
       confirmTimeoutMs: 2_000
     });
     const scopedApp = Fastify({ logger: false });
     registerMcpTransportRoute(scopedApp, { gateway: scopedGateway, tokens: scopedTokens });
     await scopedApp.ready();
     try {
       const callList = async (actorUserId: string) => {
         const token = scopedTokens.mint({
           actorUserId,
           chatSessionId: randomUUID(),
           allowedToolNames: null
         });
         const res = await scopedApp.inject({
           method: "POST",
           url: "/api/mcp",
           headers: { authorization: `Bearer ${token}` },
           body: { jsonrpc: "2.0", id: 1, method: "tools/list" }
         });
         expect(res.statusCode).toBe(200);
         return res
           .json<{ result: { tools: { name: string }[] } }>()
           .result.tools.map((t) => t.name);
       };

       const aNames = await callList(ids.userA);
       const bNames = await callList(ids.userB);

       expect(aNames).toContain("example.read");
       expect(aNames).toContain("example.write");
       expect(aNames).not.toContain("example.declaration-only");
       expect(bNames).toEqual([]); // userB has no active modules -> tools/list is empty
     } finally {
       await scopedApp.close();
     }
   });
   ```

   (`Fastify`, `registerMcpTransportRoute`, `SessionTokenRegistry`, `AssistantToolGateway`, `AiRepository`, `DataContextRunner`, `ConfirmationRegistry`, `appDb`, `ids` are all already imported / in scope — see lines 1–18 and the `beforeAll` at lines 50–73.)

7. - [ ] Verify `listTools` has no remaining call sites:

   ```bash
   grep -rn "\.listTools()" packages/ tests/ --include="*.ts"
   ```

   Expected: zero results.

8. - [ ] Run typecheck and then the MCP-related integration suites:

   ```bash
   pnpm typecheck && vitest run tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts
   ```

   Expected: zero type errors, all tests green.

9. - [ ] Commit:
   ```bash
   git add packages/ai/src/gateway/gateway.ts packages/chat/src/mcp-transport.ts tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts
   git commit -m "feat(ai/gateway): replace listTools() with actor-scoped listToolsForActor() — delete unscoped method (#172)"
   ```

---

## Task 4: Capture the per-session allowlist in the MCP token mint

The **only production `tokens.mint` call** is `packages/chat/src/routes.ts:93`, inside the `mcpTokenLifecycle.mint` closure (`token: tokens!.mint({ actorUserId, chatSessionId: actorUserId })`). The MCP transport (`mcp-transport.ts`) does NOT mint tokens — it only verifies them. There are **no** other production mint sites; every other `mint` call is in test code (handled in Task 2 with `allowedToolNames: null`). This task replaces the temporary `null` added in Task 2 with the actor's captured tool set.

**Files:**

- Modify: `packages/chat/src/routes.ts` (line 93, the `mcpTokenLifecycle.mint` closure — replace the temporary `allowedToolNames: null` with a captured set; the `gateway` instance is in scope at line 73 of the same file)
- Modify: `tests/integration/chat-mcp-transport.test.ts` (add the allowlist-enforcement transport test)

### Steps

1. - [ ] Confirm the single production mint site (no discovery hunt needed — it is `packages/chat/src/routes.ts:93`):

   ```bash
   grep -rn "tokens\.mint\|\.mint(" packages/ apps/ --include="*.ts" | grep -v "test\|spec\|\.test\."
   ```

   Expected: exactly one hit — `packages/chat/src/routes.ts:93`. (If any other production hit appears, it must also receive an `allowedToolNames` value before this task is complete; none is expected today.)

2. - [ ] At `packages/chat/src/routes.ts:93`, inside the `mcpTokenLifecycle.mint` closure, capture the actor's current tool set as the session allowlist. The `gateway` binding is in scope from line 73. Replace the temporary-null mint from Task 2:

   ```typescript
   mint: (actorUserId: string) => {
     // Capture the actor's current executable tool set as the per-session allowlist.
     // Bare tool names (e.g. "example.read") — see step 3 on name format.
     const allowedToolNames = new Set(
       gateway!.listToolsForActor(actorUserId).map((tool) => tool.name)
     );
     return {
       token: tokens!.mint({ actorUserId, chatSessionId: actorUserId, allowedToolNames }),
       mcpServerUrl
     };
   },
   ```

   (Task 4 depends on Task 3's `listToolsForActor` already existing — keep this task ordered after Task 3.)

3. - [ ] **Tool name format (closes the #119 spec requirement to "state explicitly which format the set uses").** Verify and record — both in the PR description and a code comment at the Set construction — that the allowlist stores **bare** tool names (e.g. `"example.read"`), exactly as returned by `listToolsForActor(...).name` and exactly as the MCP transport receives them in `tools/call` `params.name`. The `mcp__jarvis__<name>` prefix is a client-side CLI convention (`--allowedTools`) that never reaches the server, so **no name transform is applied** — the allowlist `Set`, `tools/list` names, and `tools/call` `params.name` all use the same bare names. (No other production mint sites exist to handle; all remaining mints are tests set to `allowedToolNames: null` in Task 2.)

4. - [ ] Run typecheck to confirm all `mint` call sites now satisfy the updated `SessionIdentity`:

   ```bash
   pnpm typecheck
   ```

   Expected: zero errors.

5. - [ ] Add an integration test to `tests/integration/chat-mcp-transport.test.ts` that exercises the allowlist enforcement via the MCP transport (not just the gateway directly):

   ```typescript
   it("tools/call returns an error when tool is not in the session allowlist", async () => {
     // Mint a token with a restricted allowlist that excludes example.read
     const token = tokens.mint({
       actorUserId: ids.userA,
       chatSessionId: randomUUID(),
       allowedToolNames: new Set(["example.write"])
     });
     const res = await app.inject({
       method: "POST",
       url: "/api/mcp",
       headers: { authorization: `Bearer ${token}` },
       body: {
         jsonrpc: "2.0",
         id: 99,
         method: "tools/call",
         params: { name: "example.read", arguments: { value: "blocked" } }
       }
     });
     expect(res.statusCode).toBe(200); // MCP always 200
     const body = res.json<{ result: { isError: boolean; content: { text: string }[] } }>();
     expect(body.result.isError).toBe(true);
     expect(body.result.content[0]!.text).toContain("not in session allowlist");
     expect(exampleToolCalls).toHaveLength(0);
   });
   ```

6. - [ ] Run the chat-mcp-transport integration suite:

   ```bash
   vitest run tests/integration/chat-mcp-transport.test.ts
   ```

   Expected: all tests green including the new allowlist test.

7. - [ ] Commit:
   ```bash
   git add packages/chat/src/routes.ts tests/integration/chat-mcp-transport.test.ts
   git commit -m "feat(chat): capture per-session tool allowlist in MCP token mint (#119)"
   ```

---

## Task 5: Add `validateToolInput` + HTTP 400 mapping on the REST tool invoke route

**Files:**

- Modify: `packages/ai/src/routes.ts` (the `POST /api/ai/assistant-tools/:name/invoke` handler spans lines 379–473; the `execute` call to wrap is at lines 452–458; `handleRouteError` is at lines 814–839)
- Test: `tests/integration/ai-tools.test.ts`

### Steps

1. - [ ] Write a failing test first. Add a new `it` block inside `describe("AI read-only assistant tool execution foundation", ...)` in `tests/integration/ai-tools.test.ts`, after the existing test at line 371 (the read-only-no-action-record test ends at line 371):

   ```typescript
   it("returns HTTP 400 (not 500/200) when REST tool input violates the tool's inputSchema", async () => {
     // The Fastify route schema (invokeAiAssistantToolRequestSchema, ai-api.ts) and
     // parseInvokeAssistantToolBody both reject a NON-OBJECT input with 400 BEFORE the
     // handler runs — so a non-object payload can never reach validateToolInput.
     // To exercise the NEW guard we must send a valid JSON OBJECT that still violates
     // the TOOL's inputSchema. tasks.list declares listId: { type: "string" }
     // (packages/tasks/src/manifest.ts:243). Passing listId: 123 (a number) fails the
     // type check in validateToolInput -> "Field listId must be a string".
     // (Do NOT use `priority`, type "integer": validateToolInput's JSON_TYPE_OF has no
     // "integer" entry — input-validation.ts:10-16 — so an integer-typed field passes
     // silently and would not trigger the error.)
     const response = await server.inject({
       method: "POST",
       url: "/api/ai/assistant-tools/tasks.list/invoke",
       headers: userAHeaders(),
       payload: {
         input: { listId: 123 }
       }
     });
     expect(response.statusCode).toBe(400);
     const body = response.json<{ error: string }>();
     expect(body.error).toMatch(/Field listId must be a string/);
   });
   ```

   Pre-fix this returns 200 and executes the tool with unvalidated input (the real #132 bug); post-fix it returns 400 with the validation message.

2. - [ ] Run the test to confirm it fails (currently returns 200 — the tool executes the unvalidated input):

   ```bash
   vitest run tests/integration/ai-tools.test.ts
   ```

   Expected: the new test fails — it currently returns 200 (the tool executes with `listId: 123` unvalidated) instead of the expected 400.

3. - [ ] Edit `packages/ai/src/routes.ts` — import `validateToolInput` and `ToolInputValidationError` from the gateway. The existing `@jarv1s/ai` re-export block is at lines 62–64 (`findAssistantToolFromManifests`, `listAssistantToolsFromManifests` from `./assistant-tools.js`); add the new import immediately after it:

   ```typescript
   import {
     findAssistantToolFromManifests,
     listAssistantToolsFromManifests
   } from "./assistant-tools.js";
   import { validateToolInput, ToolInputValidationError } from "./gateway/input-validation.js";
   ```

   Note: the import path uses `.js` extension (ESM convention).

4. - [ ] In the `POST /api/ai/assistant-tools/:name/invoke` handler, add `validateToolInput` before the `manifestTool.execute!` call. The current code at lines 452–458:

   ```typescript
   const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
     manifestTool.execute!(scopedDb, body.input ?? {}, {
       actorUserId: accessContext.actorUserId,
       requestId: accessContext.requestId ?? "",
       chatSessionId: ""
     }).then((r) => r.data ?? {})
   );
   ```

   Replace with:

   ```typescript
   // Validate caller-supplied input before execution.
   // Invariant: validateToolInput gates every caller-supplied-input execute call on REST paths.
   const validatedInput = validateToolInput(manifestTool.inputSchema, body.input ?? {});
   const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
     manifestTool.execute!(scopedDb, validatedInput, {
       actorUserId: accessContext.actorUserId,
       requestId: accessContext.requestId ?? "",
       chatSessionId: ""
     }).then((r) => r.data ?? {})
   );
   ```

5. - [ ] Add a `ToolInputValidationError` branch to `handleRouteError` at line 814. Insert before the closing `throw error` (currently line 838):

   ```typescript
   function handleRouteError(error: unknown, reply: FastifyReply) {
     if (error instanceof HttpError) {
       return reply.code(error.statusCode).send({ error: error.message });
     }

     if (error instanceof ToolInputValidationError) {
       return reply.code(400).send({ error: error.message });
     }

     if (error instanceof Error) {
       if (error.message === "Session is missing or expired") {
         return reply.code(401).send({ error: error.message });
       }
       if (error.message === "Invalid bearer token") {
         return reply.code(401).send({ error: error.message });
       }
       if (error.message === "Workspace context is unavailable") {
         return reply.code(403).send({ error: error.message });
       }
       if (
         error.message.includes("foreign key") ||
         error.message.includes("violates row-level security policy") ||
         error.message.includes("duplicate key")
       ) {
         return reply.code(400).send({ error: "AI configuration request is invalid" });
       }
     }

     throw error;
   }
   ```

6. - [ ] Run the ai-tools integration suite to confirm the new test passes and no existing test regressed:

   ```bash
   vitest run tests/integration/ai-tools.test.ts
   ```

   Expected: all tests green, including the new HTTP 400 validation test.

7. - [ ] Acceptance grep — confirm `ToolInputValidationError` is handled before the generic Error path:

   ```bash
   grep -n "ToolInputValidationError\|handleRouteError" packages/ai/src/routes.ts
   ```

   Expected: `ToolInputValidationError` import visible, and it appears inside `handleRouteError` before the `instanceof Error` check.

8. - [ ] Commit:
   ```bash
   git add packages/ai/src/routes.ts
   git commit -m "fix(ai/routes): validateToolInput on REST read-tool path, map ToolInputValidationError to HTTP 400 (#132)"
   ```

---

## Task 6: Thread real `actorUserId` and `requestId` into briefings `ToolContext`

**Files:**

- Modify: `packages/briefings/src/repository.ts` (lines 259–267, the `manifestTool.execute` call inside `generateSummary`)
- Test: `tests/integration/briefings.test.ts` (the new test uses the `JarvisModuleManifest` type, which is NOT currently imported in this file — add `import type { JarvisModuleManifest } from "@jarv1s/module-sdk";` to the imports)

### Steps

1. - [ ] Confirm the blank `ToolContext` fields are at the expected lines:

   ```bash
   grep -n 'actorUserId.*""\|requestId.*""' packages/briefings/src/repository.ts
   ```

   Expected: lines 263 and 264 show `actorUserId: ""` and `requestId: ""`.

2. - [ ] Write a failing test. First add the manifest type import to the top of `tests/integration/briefings.test.ts` (it is not currently imported):

   ```typescript
   import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
   ```

   Then, in `tests/integration/briefings.test.ts`, add a test that directly calls `BriefingsRepository.generateRun` and verifies the `ToolContext` passed to the tool's execute handler is non-blank. Since `generateSummary` is a module-private function, we test via the worker path. Add inside the existing `describe` block:

   ```typescript
   it("briefing tool execute receives a non-empty actorUserId and requestId in ToolContext", async () => {
     // The exampleToolModule fixture records ctx.actorUserId on each call.
     // We use the existing BriefingsRepository with the example module to check
     // that the ToolContext is non-blank after the fix.
     const capturedContexts: { actorUserId: string; requestId: string }[] = [];
     const capturingManifest: JarvisModuleManifest = {
       id: "ctx-check",
       name: "CtxCheck",
       version: "0.0.0",
       publisher: "test",
       lifecycle: "optional",
       compatibility: { jarv1s: "*" },
       assistantTools: [
         {
           name: "ctx-check.read",
           description: "Captures ToolContext for assertion.",
           permissionId: "ctx-check.view",
           risk: "read" as const,
           execute: async (_db, _input, ctx) => {
             capturedContexts.push({ actorUserId: ctx.actorUserId, requestId: ctx.requestId });
             return { data: {} };
           }
         }
       ]
     };
     // Create a briefing definition for userA with the ctx-check tool
     const def = await dataContext.withDataContext(
       { actorUserId: ids.userA, requestId: "r:briefing-ctx-test" },
       (scopedDb) =>
         repository.createDefinition(scopedDb, {
           title: "ToolContext check",
           selectedToolNames: ["ctx-check.read"]
         })
     );
     // generateRun calls generateSummary which calls manifestTool.execute
     const run = await dataContext.withDataContext(
       { actorUserId: ids.userA, requestId: "r:briefing-ctx-run" },
       (scopedDb) =>
         repository.generateRun(scopedDb, def.id, {
           moduleManifests: [capturingManifest],
           runKind: "manual",
           runId: "ctx-check-run-01"
         })
     );
     expect(run).toBeDefined();
     expect(capturedContexts).toHaveLength(1);
     expect(capturedContexts[0]!.actorUserId).toBe(ids.userA);
     expect(capturedContexts[0]!.requestId).not.toBe("");
     // Direct generateRun (no jobId) -> requestId is `briefing:<runId>`.
     expect(capturedContexts[0]!.requestId).toMatch(/^briefing:|^pgboss:/);
   });
   ```

3. - [ ] Run the test to confirm it fails (currently `actorUserId` is `""`):

   ```bash
   vitest run tests/integration/briefings.test.ts
   ```

   Expected: the new test fails — `actorUserId` is `""`.

4. - [ ] Edit `packages/briefings/src/repository.ts`. The `generateSummary` function signature (line 215) already receives `definition: BriefingDefinition`. `definition.owner_user_id` is on the record. Also, `generateSummary` is called from `generateRun` (line 173) which is called from within a `withDataContext` session — there is no `job.id` in this path; `job.id` is available only in the pg-boss worker (`packages/briefings/src/jobs.ts` line 73). The worker passes a `runId` in `GenerateBriefingRunInput`. Use `runId` for `requestId` when available, falling back to `randomUUID()`:

   Update the `generateSummary` function signature to also accept the job ID. The cleanest approach is to add an optional `jobId` to `GenerateBriefingRunInput`:

   ```typescript
   export interface GenerateBriefingRunInput {
     readonly moduleManifests: readonly JarvisModuleManifest[];
     readonly runKind: BriefingRunKind;
     readonly runId?: string;
     /**
      * pg-boss job ID when this run is triggered by a worker job.
      * Used to form the requestId in ToolContext so execution is traceable.
      */
     readonly jobId?: string;
   }
   ```

   Then update the `generateSummary` call in `generateRun` (line 173) to pass `input` through unchanged (it already carries `jobId` if set by the worker).

   Update the `manifestTool.execute` call inside `generateSummary` (lines 259–267):

   ```typescript
   try {
     const toolResult = await manifestTool.execute(
       scopedDb,
       // Hard-coded empty input — briefings always run tools with no caller-supplied input.
       // validateToolInput is intentionally NOT called here; {} is not caller-supplied input.
       {},
       {
         actorUserId: definition.owner_user_id,
         requestId: input.jobId ? `pgboss:${input.jobId}` : `briefing:${input.runId ?? randomUUID()}`,
         chatSessionId: ""
       }
     );
   ```

5. - [ ] Update `packages/briefings/src/jobs.ts` to pass `jobId` in the `GenerateBriefingRunInput`. In the worker handler (lines 76–80):

   ```typescript
   const run = await repository.generateRun(scopedDb, job.data.definitionId, {
     moduleManifests: options.moduleManifests,
     runKind: job.data.runKind,
     runId: job.data.briefingRunId,
     jobId: job.id
   });
   ```

6. - [ ] Run the briefings integration test suite:

   ```bash
   vitest run tests/integration/briefings.test.ts
   ```

   Expected: all tests green, including the new `ToolContext` check test.

7. - [ ] Acceptance grep — confirm no remaining blank `actorUserId` or `requestId` in the briefings package non-test code:

   ```bash
   grep -n 'actorUserId.*""\|requestId.*""' packages/briefings/src/repository.ts packages/briefings/src/jobs.ts
   ```

   Expected: zero results.

8. - [ ] Commit:
   ```bash
   git add packages/briefings/src/repository.ts packages/briefings/src/jobs.ts tests/integration/briefings.test.ts
   git commit -m "fix(briefings): thread actorUserId and requestId into ToolContext in generateSummary (#148)"
   ```

---

## Task 7: Hard-invariant verification greps and `pnpm verify:foundation`

**Files:**

- No source file changes — this is the verification gate.
- Test: all suites run via `pnpm verify:foundation`

### Steps

1. - [ ] Acceptance grep — `ToolContext.actorUserId` is never empty string in non-test code. The spec invariant is **zero non-test hits**. The only pre-fix hit under `packages/` was `packages/briefings/src/repository.ts:263` (fixed in Task 6):

   ```bash
   grep -rn 'actorUserId: ""' packages/ --include="*.ts" | grep -v -E '\.test\.|/tests/|__tests__|/fixtures/'
   ```

   Expected: zero results. (If a future test file under `packages/` legitimately uses a blank actor, the `grep -v` filter excludes it — only non-test hits fail the gate.)

2. - [ ] Acceptance grep — `listTools()` no longer exists anywhere in production code:

   ```bash
   grep -rn "\.listTools()" packages/ apps/ --include="*.ts"
   ```

   Expected: zero results.

3. - [ ] Acceptance grep — `validateToolInput` is called before every `execute!` on the REST tool invoke path:

   ```bash
   grep -n "validateToolInput\|manifestTool\.execute" packages/ai/src/routes.ts
   ```

   Expected: `validateToolInput` appears on the line immediately before `manifestTool.execute!`; both are in the same handler block.

4. - [ ] Acceptance grep — `ToolInputValidationError` is handled in `handleRouteError` (not just imported):

   ```bash
   grep -n "ToolInputValidationError" packages/ai/src/routes.ts
   ```

   Expected: at least two hits — one import and one `instanceof` check inside `handleRouteError`.

5. - [ ] Acceptance grep — briefings job passes `jobId` to `generateRun`:

   ```bash
   grep -n "jobId" packages/briefings/src/jobs.ts packages/briefings/src/repository.ts
   ```

   Expected: `jobId: job.id` in `jobs.ts`; `jobId` field in `GenerateBriefingRunInput` and `requestId` construction in `repository.ts`.

6. - [ ] Acceptance grep — no hardcoded provider or model (provider-agnostic AI invariant unchanged):

   ```bash
   grep -rn "anthropic\|claude-\|gpt-\|gemini-" packages/ai/src/gateway/ --include="*.ts"
   ```

   Expected: zero results.

7. - [ ] Run the full verification gate:

   ```bash
   pnpm verify:foundation
   ```

   Expected: lint, format:check, check:file-size, typecheck, db:migrate, and test:integration all green.

8. - [ ] Run the AI-specific integration suites individually for a clean signal:

   ```bash
   vitest run tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/ai-tools.test.ts tests/integration/briefings.test.ts
   ```

   Expected: all tests pass.

9. - [ ] Final commit (if any lint/format corrections were needed; otherwise this step is a no-op):
   ```bash
   git add packages/ai/src/gateway/session-tokens.ts packages/ai/src/gateway/gateway.ts packages/ai/src/routes.ts packages/chat/src/routes.ts packages/chat/src/mcp-transport.ts packages/briefings/src/repository.ts packages/briefings/src/jobs.ts
   git commit -m "chore(audit-slice-f): verify:foundation green — AI tool-path hardening complete"
   ```
