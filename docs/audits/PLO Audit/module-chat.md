# Chat Module — Thermo-Nuclear Code Quality Review

**Reviewed:** 2026-06-10
**Scope:** `packages/chat/src/` (all files), `packages/chat/sql/` (all migrations)
**Reviewer:** Subagent / PLO Audit

---

## Summary

The chat module is architecturally coherent and the security-critical path (DataContextDb branding, RLS, session-scoped tokens, server-side allowlist enforcement) is mostly sound. The most acute issues are: a concurrency hazard where `clear()` can race against an in-flight turn; the MCP session token persisting on disk in Gemini's `settings.json` indefinitely after session kill; an unguarded chat-turn message body length that opens an unmetered local resource burn; and multiple missing route schemas that bypass Fastify's output serialization hardening. Three RLS policy inconsistencies are also documented.

---

## Findings

---

### [HIGH] `clear()` races against an in-flight turn — no `turnsInFlight` guard

- **File:** `packages/chat/src/live/chat-session-manager.ts:270–278`
- **Category:** Architecture / Error Handling
- **Finding:** `clear()` kills the live engine and calls `openNewConversation()` without checking `turnsInFlight`. An in-flight `runTurn()` for the same user already holds a reference to the engine object and is mid-polling `readNew()`. When `clear()` kills the tmux session under it, the poll silently receives no data and eventually times out (up to `maxPolls × pollMs = 2000 × 25ms = 50 s`). Worse, `openNewConversation()` writes a new thread to the DB **before** the in-flight `recordTurn()` runs, so `recordTurn()` then calls `getCurrentThread()` which returns the brand-new (empty) thread — the completed turn is recorded against the wrong thread and the user's history is corrupted.
- **Evidence:**
  ```ts
  async clear(actorUserId: string, options?: { incognito?: boolean }): Promise<void> {
    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.kill();       // kills engine while turn may still be reading it
      this.sessions.delete(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    }
    await this.deps.persistence.openNewConversation(actorUserId, options); // races with recordTurn
  }
  // submitTurn() guards concurrent *submit*, but clear() does not.
  if (this.turnsInFlight.has(actorUserId)) throw new ChatTurnInFlightError(); // only here
  ```
- **Impact:** Conversation history corruption; the timed-out turn's reply is recorded against the new thread. A user hammering "clear" mid-turn can produce orphaned messages or duplicate thread entries.
- **Recommendation:** At the top of `clear()`, reject with HTTP 409 if `this.turnsInFlight.has(actorUserId)` — same pattern as `submitTurn()`. Alternatively, await the in-flight turn promise before proceeding.

---

### [HIGH] Gemini `settings.json` containing the MCP session token is never deleted

- **File:** `packages/chat/src/live/cli-chat-engine.ts:78–95, 175–176`
- **Category:** Security (Secrets Never Escape)
- **Finding:** For the Gemini provider, `launch()` writes `neutralDir/.gemini/settings.json` containing `{ "mcpServers": { "jarvis": { "headers": { "Authorization": "Bearer <mcpToken>" } } } }`. The file is overwritten on the **next** `launch()` (i.e., next session for the same user) but is **never deleted** by `kill()` or during idle reap. A server-side process, an operator with shell access, or an attacker who exploits an unrelated path traversal can read the token at any time after the session ends.
- **Evidence:**
  ```ts
  async launch(opts: EngineLaunchOpts): Promise<void> {
    // Gemini: writes MCP token to disk
    await this.io.writeFile(join(settingsDir, "settings.json"), JSON.stringify(settings, null, 2));
    // ...
  }
  async kill(): Promise<void> {
    await this.io.run("tmux", ["kill-session", "-t", this.sessionName]);
    // settings.json is NOT cleaned up
  }
  ```
- **Impact:** The per-session token grants unauthenticated access to all Jarvis MCP tools for the actor until it is explicitly revoked. Tokens are revoked in-memory by `revokeBySessionId()`, but the on-disk copy persists and could be replayed if the server restarts before the Gemini binary can use it.
- **Recommendation:** Add an `io.unlink()` call for `join(settingsDir, "settings.json")` inside `kill()` (and ideally inside `launch()` before writing a new one to avoid a window). Use `io.run("rm", ["-f", ...])` via the existing `TmuxIo.run` seam so tests can assert the cleanup.

---

### [HIGH] No input length cap on chat turn text — unmetered local resource burn

- **File:** `packages/chat/src/live-routes.ts:41–57, 164–170`
- **Category:** Security / Error Handling
- **Finding:** `readText()` accepts any non-empty string and passes it unchanged to `runtime.manager.submitTurn()`. The text is then: (1) written to the prompt temp file, (2) loaded into a tmux buffer, (3) replayed into the CLI binary, (4) stored verbatim in `chat_messages.body`. There is no length limit. A valid session can submit a multi-megabyte payload, consuming disk, memory, and model tokens without bound.
- **Evidence:**
  ```ts
  function readText(body: unknown): string | undefined {
    // ...
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;  // no upper bound
  }
  ```
- **Impact:** Denial of service against the local machine (disk writes, tmux buffer memory, model API costs). No Fastify `bodyLimit` override was found for the chat turn route.
- **Recommendation:** Enforce a maximum length in `readText()` (e.g., 32 KB for a chat message) and return `undefined` (→ 400) if exceeded.

---

### [MEDIUM] Codex MCP token exposed in process environment prefix (`ps -e` visible)

- **File:** `packages/chat/src/live/cli-chat-engine.ts:237–242`
- **Category:** Security (Secrets Never Escape)
- **Finding:** For the `openai-compatible` (Codex) provider, the MCP session token is injected via an env-var prefix on the shell command line: `JARVIS_MCP_TOKEN=<token> codex ...`. The comment explicitly acknowledges "the token appears in the tmux send-keys command and ps output — accepted tradeoff for a local single-user session". However the project's hard invariant is "secrets never escape" and the token grants real tool-call privileges.
- **Evidence:**
  ```ts
  const envPrefix = opts.mcpToken ? `${tokenEnvVar}=${opts.mcpToken} ` : "";
  const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, `${envPrefix}codex`];
  // token visible in /proc/<pid>/environ and ps output on Linux
  ```
- **Impact:** Any process that can read `/proc/*/environ` (or `ps -e`) sees the live token. On a shared host this is a critical privilege escalation; on a dedicated personal server it is lower severity but still violates the invariant.
- **Recommendation:** Pass the token through a temp file (like the prompt file) or via `setenv()` using the `TmuxIo` injection seam. Alternatively, write a per-session env file and source it inside the tmux shell, then delete the file after the process starts.

---

### [MEDIUM] `chat_user_memory_settings` UPDATE RLS policy missing `WITH CHECK`

- **File:** `packages/chat/sql/0042_chat_memory_settings.sql:25`
- **Category:** Security (RLS)
- **Finding:** The UPDATE policy for `chat_user_memory_settings` defines a `USING` clause but no `WITH CHECK` clause. In PostgreSQL, omitting `WITH CHECK` on UPDATE means the row-filter for the proposed new values defaults to the `USING` expression — which should be equivalent here. However, the project convention (verified across 0014, 0025, 0036) is to always state both `USING` and `WITH CHECK` explicitly on UPDATE policies to prevent silent policy drift if the table schema or function changes.
- **Evidence:**
  ```sql
  CREATE POLICY chat_memory_settings_update ON app.chat_user_memory_settings
    FOR UPDATE USING (user_id = app.current_actor_user_id());
  -- WITH CHECK clause absent; every other UPDATE policy in the module has both
  ```
- **Impact:** The omission is currently benign (PostgreSQL defaults the WITH CHECK to USING), but it is inconsistent with the project pattern and could silently break if `current_actor_user_id()` semantics change or the USING clause is widened without also widening the write constraint.
- **Recommendation:** Add `WITH CHECK (user_id = app.current_actor_user_id())` to bring this policy in line with the 0014/0036 patterns.

---

### [MEDIUM] `chat_messages_update` policy (0036) lacks `IS NOT NULL` guard present in select/insert peers

- **File:** `packages/chat/sql/0036_chat_worker_runtime_grants.sql:57–59`
- **Category:** Security (RLS)
- **Finding:** The `chat_messages_update` policy uses `USING (owner_user_id = app.current_actor_user_id())` without the `app.current_actor_user_id() IS NOT NULL` guard that the `chat_threads_select` and `chat_messages_select` policies in the same migration carry. If `current_actor_user_id()` returns NULL, the equality check is NULL (falsy) — which is actually safe behaviour here — but the inconsistency creates a policy-reading hazard: a future reader may correctly assume the NULL guard is load-bearing and add it only to new policies, masking a real path where it IS needed.
- **Evidence:**
  ```sql
  -- Has IS NOT NULL guard:
  CREATE POLICY chat_threads_select ... USING (
    app.current_actor_user_id() IS NOT NULL
    AND (owner_user_id = app.current_actor_user_id() OR ...)
  );
  -- Lacks IS NOT NULL guard:
  CREATE POLICY chat_messages_update ... USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
  ```
- **Impact:** Behaviorally equivalent today (NULL equality is false), but inconsistency raises audit ambiguity.
- **Recommendation:** Add `app.current_actor_user_id() IS NOT NULL AND` prefix to both `USING` and `WITH CHECK` in the `chat_messages_update` policy, matching the pattern of the select policies in the same migration.

---

### [MEDIUM] `memory-settings-repository.ts` skips `assertDataContextDb` — branding invariant violation

- **File:** `packages/chat/src/memory-settings-repository.ts:24–66`
- **Category:** Architecture (DataContextDb only)
- **Finding:** `ChatUserMemorySettingsRepository.getOrCreate()` and `update()` both accept a `DataContextDb` parameter and immediately call `scopedDb.db` (the underlying Kysely handle), but neither calls `assertDataContextDb(scopedDb)` first. Every other repository method in this module (`ChatRepository`, `DataContextChatPersistence.resolveUserName`) does call the assertion. The assertion is the runtime guard that enforces the branded `DataContextDb` invariant — skipping it means a caller could supply any duck-typed object and bypass the compile-time enforcement.
- **Evidence:**
  ```ts
  async getOrCreate(scopedDb: DataContextDb, userId: string): Promise<UserMemorySettings> {
    // No assertDataContextDb(scopedDb) here
    const result = await sql<...>`INSERT ...`.execute(scopedDb.db);
  ```
  Compare with `ChatRepository.listThreads`:
  ```ts
  async listThreads(scopedDb: DataContextDb): Promise<ChatThread[]> {
    assertDataContextDb(scopedDb);  // present here
    return scopedDb.db.selectFrom(...)...
  ```
- **Impact:** Weak enforcement of the DataContextDb-only hard invariant. In tests or future callers a non-scoped Kysely instance could be passed in, bypassing RLS.
- **Recommendation:** Add `assertDataContextDb(scopedDb)` at the top of both `getOrCreate` and `update`.

---

### [MEDIUM] Multiple live and memory routes registered without Fastify `schema` — no output serialization

- **File:** `packages/chat/src/routes.ts:157–226; packages/chat/src/live-routes.ts:37–112`
- **Category:** Architecture / Security
- **Finding:** Only the `GET /api/chat/threads` route is registered with a `schema` option (`listChatThreadsRouteSchema`). All live routes (`/api/chat/turn`, `/api/chat/clear`, `/api/chat/switch`, `/api/chat/stream`) and all memory routes (`/api/chat/memory/settings` GET/PATCH, `/api/chat/memory/facts` GET/PATCH/DELETE, `/api/chat/action-requests/:id/resolve`) are registered without schemas. Fastify without a response schema performs no output serialization, stripping, or validation — any unintended field on the returned object (e.g., internal error details) reaches the client.
- **Evidence:**
  ```ts
  server.post("/api/chat/turn", async (request, reply) => { ... });   // no schema
  server.get("/api/chat/memory/settings", async (request, reply) => { ... }); // no schema
  server.patch("/api/chat/memory/facts/:id", async (request, reply) => { ... }); // no schema
  ```
- **Impact:** Without output schemas, fields accidentally added to response objects (debug data, internal IDs) are not stripped before serialization. Also misses Fastify's faster JSON serialization path.
- **Recommendation:** Define and register response schemas for every route, matching the pattern already established for `/api/chat/threads`. At minimum, add JSON schema response definitions to the turn, clear, switch, memory settings, and facts routes.

---

### [MEDIUM] Episodic recall query is a semantically meaningless UUID string

- **File:** `packages/chat/src/recall-port.ts:72`
- **Category:** Code Quality
- **Finding:** The embedding query used for episodic memory retrieval is `"${actorUserId} past conversations"` — a UUID concatenated with a fixed phrase. Since `actorUserId` is an opaque UUID, its embedding is dominated by sub-word tokens for hex characters, not semantic content. The recall result is therefore essentially random with respect to the current conversation's topic. This undermines the entire recall feature: users receive irrelevant episodic chunks injected into every new session launch.
- **Evidence:**
  ```ts
  const query = `${actorUserId} past conversations`;
  // actorUserId is e.g. "550e8400-e29b-41d4-a716-446655440000"
  const queryEmbedding = await this.embeddingProvider.embedQuery(query);
  ```
- **Impact:** The recall block returned to the LLM contains low-relevance chunks, wasting the 4000-char budget and potentially injecting distracting or misleading context. The embedding cost is wasted.
- **Recommendation:** Use a fixed, semantically meaningful phrase (e.g., `"recent conversations and preferences"`) or, better, use the user's prior turn texts as the query once they're available (current conversation context injection at the `recallEpisodic` callsite).

---

### [MEDIUM] `switchProvider()` does not guard against a concurrent in-flight turn

- **File:** `packages/chat/src/live/chat-session-manager.ts:285–293`
- **Category:** Architecture / Error Handling
- **Finding:** `switchProvider()` kills the live engine and immediately calls `ensureSession()` (which re-launches a new engine). Like `clear()`, it has no check against `turnsInFlight`. An in-flight turn polling `readNew()` will lose its engine mid-read; the subsequent `recordTurn()` call will record against the old provider's metadata while the new engine is launched.
- **Evidence:**
  ```ts
  async switchProvider(actorUserId: string, userName: string): Promise<void> {
    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.kill();        // kills engine while turn may still be reading
      this.sessions.delete(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    }
    await this.ensureSession(actorUserId, userName);  // relaunches without waiting for turn
  }
  ```
- **Impact:** Same class as the `clear()` race: metadata and history corruption; turns may record with wrong provider/model metadata.
- **Recommendation:** Reject `switchProvider()` with HTTP 409 if `this.turnsInFlight.has(actorUserId)`, matching the `submitTurn` pattern.

---

### [LOW] MCP `callTool` catch block exposes internal error messages to the CLI agent

- **File:** `packages/chat/src/mcp-transport.ts:86–89`
- **Category:** Security (Secrets Never Escape) / Error Handling
- **Finding:** The comment on line 87 states "callTool only throws on invalid token — guard already passed above." This is correct for the happy path (the gateway verifies the token again internally and throws `InvalidSessionTokenError` if invalid), but the comment is misleading. Any unexpected runtime error propagating out of `gateway.callTool()` — including database errors, network errors, or assertion failures — would expose `err.message` to the MCP caller (the CLI agent).
- **Evidence:**
  ```ts
  } catch (err) {
    // callTool only throws on invalid token — guard already passed above.
    const message = err instanceof Error ? err.message : "Internal error";
    return reply.code(200).send(jsonRpcError(id, -32603, message));  // leaks err.message
  }
  ```
- **Impact:** In practice the gateway's `callTool()` is well-guarded (runHandler never throws), so the risk is low. But if a new throw path is introduced, raw error messages (potentially including DB details) would be returned in the JSON-RPC response and injected into the LLM's context.
- **Recommendation:** Replace `message` with a sanitized string (`"Internal tool error"`) and log the original `err` server-side. The comment should be updated to reflect the actual defensive intent.

---

### [LOW] Prompt temp file is never cleaned up on session kill or idle reap

- **File:** `packages/chat/src/live/cli-chat-engine.ts:68, 132, 175`
- **Category:** Security / Code Quality
- **Finding:** Each `TmuxCliChatEngine` instance writes user prompt content to a stable per-session temp file at `$TMPDIR/jarv1s-live-prompt-<sessionName>.txt`. The file is overwritten each turn and thus contains the most recent prompt text. When `kill()` is called, only the tmux session is terminated — the prompt file on disk is never removed. Over time (or after a long session with sensitive prompts), temp files accumulate containing private user message content.
- **Evidence:**
  ```ts
  this.promptFile = join(tmpdir(), `jarv1s-live-prompt-${this.sessionName}.txt`);
  // ...
  await this.io.writeFile(this.promptFile, sanitized);  // overwrites each turn
  // kill() only does:
  await this.io.run("tmux", ["kill-session", "-t", this.sessionName]);
  // promptFile is never unlinked
  ```
- **Impact:** User message content persists in temp files after session end. On a shared host this is a privacy violation; on a personal server it is a data retention issue.
- **Recommendation:** Call `io.run("rm", ["-f", this.promptFile])` inside `kill()` (and potentially in `launch()` before first write, as a precaution).

---

### [LOW] `#mapRow` uses non-null assertion `result.rows[0]!` after UPSERT

- **File:** `packages/chat/src/memory-settings-repository.ts:38, 67`
- **Category:** TypeScript / Error Handling
- **Finding:** Both `getOrCreate()` and `update()` end with `return this.#mapRow(result.rows[0]!)`. The `!` non-null assertion is unsafe if the `UPSERT ... RETURNING *` somehow returns no rows (e.g., if a `BEFORE INSERT` trigger aborts the insert, or the row count returns empty due to an unforeseen conflict). The failure mode is a runtime `TypeError: Cannot read properties of undefined`.
- **Evidence:**
  ```ts
  return this.#mapRow(result.rows[0]!);
  ```
- **Impact:** Unhandled runtime crash in the memory settings path; would result in an unhandled promise rejection surfacing as a 500.
- **Recommendation:** Check `if (!result.rows[0])` and throw a descriptive error, or use `executeTakeFirstOrThrow()` pattern (though this is raw SQL template, so add explicit guard).

---

### [LOW] `requestId` is hardcoded to `"recall"` across all recall operations

- **File:** `packages/chat/src/recall-port.ts:43`
- **Category:** Architecture / Code Quality
- **Finding:** The `RecallService.recall()` method creates its `AccessContext` with `requestId: "recall"` — a static string shared by every recall invocation, every user, every session launch. The `requestId` is intended to be a per-request correlation identifier for logging and auditability.
- **Evidence:**
  ```ts
  const accessCtx = { actorUserId, requestId: "recall" };
  ```
- **Impact:** Log correlation is broken for recall operations — all recall DB calls share the same `requestId`, making it impossible to trace a specific session's recall call through the audit log.
- **Recommendation:** Use a unique `requestId` per call, e.g. `requestId: \`recall:${randomUUID()}\`` or compose it from the `chatSessionId` at the callsite.

---

### [LOW] `chat_memory_settings` RLS policies lack `IS NOT NULL` guard (inconsistency with rest of module)

- **File:** `packages/chat/sql/0042_chat_memory_settings.sql:16–29`
- **Category:** Security (RLS)
- **Finding:** None of the four `chat_user_memory_settings` policies include the `app.current_actor_user_id() IS NOT NULL` guard that every other module table's policies carry (see 0014, 0025, 0036). The equality check `user_id = app.current_actor_user_id()` will correctly return false when `current_actor_user_id()` is NULL, but the inconsistency reduces pattern confidence in future reviews.
- **Evidence:**
  ```sql
  CREATE POLICY chat_memory_settings_select ON app.chat_user_memory_settings
    FOR SELECT USING (user_id = app.current_actor_user_id());
  -- Missing: app.current_actor_user_id() IS NOT NULL AND
  ```
- **Impact:** Currently safe (NULL equality is false), but inconsistent.
- **Recommendation:** Add `app.current_actor_user_id() IS NOT NULL AND` to all four `chat_user_memory_settings` policies.

---

### [LOW] SSE `/api/chat/stream` endpoint has no timeout or max-connection guard

- **File:** `packages/chat/src/live-routes.ts:89–112`
- **Category:** Security / Error Handling
- **Finding:** The SSE endpoint adds a subscriber for the actor and keeps the connection open until the client disconnects. There is no maximum connection duration, no cap on concurrent SSE connections per user, and no heartbeat. A user (or attacker with valid credentials) can open many concurrent SSE connections, each holding a Fastify reply and a subscriber set entry in memory.
- **Evidence:**
  ```ts
  server.get("/api/chat/stream", async (request, reply) => {
    // No max-connection check, no timeout
    const unsubscribe = runtime.manager.subscribe(access.actorUserId, (record) => {
      reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    });
    request.raw.on("close", () => { unsubscribe(); reply.raw.end(); });
    return reply;  // open indefinitely
  });
  ```
- **Impact:** Memory growth proportional to open SSE connections; on a server with many users this could exhaust file descriptors and memory.
- **Recommendation:** Add a cap on concurrent SSE connections per `actorUserId` (e.g., 3), and optionally send a periodic heartbeat comment (`": ping\n\n"`) to detect dead connections.

---

### [LOW] `serializeThread` exposes `ownerUserId` in API response unnecessarily

- **File:** `packages/chat/src/routes.ts:229–236`
- **Category:** Security / Architecture
- **Finding:** The `GET /api/chat/threads` response includes `ownerUserId` (the internal user UUID) in every thread DTO. Since threads are already RLS-scoped to the requesting user, the `ownerUserId` in the response is always equal to the caller's own ID. Including it exposes the internal user UUID in the API response, where it is redundant and a minor information leak.
- **Evidence:**
  ```ts
  function serializeThread(thread: ChatThread): ChatThreadDto {
    return {
      id: thread.id,
      ownerUserId: thread.owner_user_id,  // always equals the caller's own ID
      title: thread.title,
      ...
    };
  }
  ```
- **Impact:** Minor information leak; the user UUID is not a secret but exposing internal IDs unnecessarily in API contracts is contra the least-privilege principle.
- **Recommendation:** Omit `ownerUserId` from `ChatThreadDto` since it is always the calling user's own ID. If the frontend needs the current user's ID, it should be sourced from the session/profile endpoint.

---

### [INFO] `buildGeminiCommand` does not restrict Gemini's native tool set at the command-line level

- **File:** `packages/chat/src/live/cli-chat-engine.ts:258–266`
- **Category:** Security / Architecture
- **Finding:** For the Gemini provider, native tool restriction is delegated entirely to the `settings.json` file written before launch (`tools: { core: [] }`). The CLI command itself has no `--no-tools` or equivalent flag. If the Gemini CLI ignores or resets `settings.json`, all native tools would be available. Claude uses `--tools ""` as a defense-in-depth command-line flag; Gemini has no equivalent flag documented in the codebase.
- **Evidence:**
  ```ts
  private buildGeminiCommand(opts: EngineLaunchOpts): string {
    const parts = [
      `cd ${shellQuote(opts.neutralDir)} &&`,
      "gemini",
      "--allowed-mcp-server-names jarvis"  // only MCP restriction, no native tool restriction
    ];
    return parts.join(" ");
  }
  ```
- **Impact:** If Gemini CLI does not respect `tools.core: []` in settings.json, it has access to its native toolset (file system, shell, etc.). This is a gap in defense-in-depth compared to the Claude and Codex providers.
- **Recommendation:** Document the assumption that `tools.core: []` in settings.json is honored by the Gemini CLI binary. If the CLI supports a `--no-tools` flag or equivalent, add it to the command.

---

### [INFO] Token `mintMcpToken` called with `(actorUserId, actorUserId)` — `chatSessionId` conflated with `actorUserId`

- **File:** `packages/chat/src/live/chat-session-manager.ts:153`, `packages/chat/src/routes.ts:92–93`
- **Category:** Architecture
- **Finding:** The `mintMcpToken` port is called with both `actorUserId` and `actorUserId` (the same value for both params). The `ChatSessionManagerDeps.mintMcpToken` signature takes `(actorUserId: string, chatSessionId: string)`, implying a design intent for `chatSessionId` to be a distinct per-session identifier (enabling multi-session-per-user in the future). Currently, `chatSessionId === actorUserId` is an architectural constraint — the notifier, subscriber map, and token revocation all key on `actorUserId`. This should be documented as a design constraint and the type should express it if it's intentional.
- **Evidence:**
  ```ts
  // chat-session-manager.ts:153
  const mcpConfig = this.deps.mintMcpToken?.(actorUserId, actorUserId);
  // routes.ts:92-93
  mint: (actorUserId: string) => ({
    token: tokens!.mint({ actorUserId, chatSessionId: actorUserId }),
  ```
- **Impact:** Not a current bug (Phase 2 explicitly states one session per user). But if the one-session-per-user constraint is lifted without revisiting this, the notifier and subscriber fan-out will mismatch.
- **Recommendation:** Add a clear comment at both callsites documenting the Phase 2 constraint. Alternatively, collapse the `chatSessionId` parameter out of the port type since it is never distinct from `actorUserId` in practice.

---

### [INFO] `handleExtractFactsJob` is a permanent no-op wired into the worker

- **File:** `packages/chat/src/jobs.ts:104–111`
- **Category:** Code Quality
- **Finding:** `handleExtractFactsJob` is a completely empty function (`return;` body with all params prefixed `_`). The queue is registered, jobs are enqueued after every completed turn, and the worker slot is wired — all for a function that does nothing. The TODO comment acknowledges this is unfinished ("phase3-facts").
- **Evidence:**
  ```ts
  export async function handleExtractFactsJob(
    _scopedDb: DataContextDb,
    _ownerUserId: string,
    _threadId: string
  ): Promise<void> {
    // TODO(phase3-facts): call capability router to extract structured facts
  }
  ```
- **Impact:** Each completed turn generates a `chat.extract-facts` job that immediately no-ops. This is wasted pg-boss overhead (job creation, worker pickup, deletion) on every turn.
- **Recommendation:** Either implement the handler or, until Phase 3 is active, conditionally skip the `boss.send(CHAT_EXTRACT_FACTS_QUEUE, ...)` enqueue. A dead job queue that always no-ops should not run in production.

---

### [INFO] `0025_chat_owner_or_share.sql` introduces sharing policies but no sharing UI or API exists

- **File:** `packages/chat/sql/0025_chat_owner_or_share.sql`
- **Category:** Architecture
- **Finding:** Migration 0025 enables `has_share('chat_thread', id, 'view')` and `has_share('chat_thread', id, 'manage')` policies on `chat_threads` and `chat_messages`. No route or UI surface exists to create or revoke these shares (verified: no `POST /api/chat/threads/:id/share` or similar in the routes). The feature exists at the DB layer but is not reachable through the application.
- **Impact:** Low risk since there's no way to create a share record from the app, but the policy widens RLS beyond the "private by default" invariant and adds complexity that has no active consumer.
- **Recommendation:** Document the intent (spec reference) for when sharing will be exposed, or revert to owner-only RLS until the sharing feature is designed and approved.

---

### [INFO] Tests do not cover the `clear()`-while-turn-in-flight race condition

- **File:** `tests/unit/chat-session-manager.test.ts`, `tests/integration/chat-live-api.test.ts`
- **Category:** Tests
- **Finding:** The test suites check cross-user isolation and 401 paths, but no test exercises concurrent `clear()` while a `submitTurn()` is in progress. Given the race condition documented above (HIGH finding), this is a gap in regression coverage.
- **Impact:** The bug will not be caught by automated tests.
- **Recommendation:** Add a unit test in `chat-session-manager.test.ts` that: (1) starts a slow turn (fake engine that delays readNew), (2) concurrently calls `clear()`, (3) asserts the clear is rejected with 409 (once the guard is added).

---

## File size check

All files in `packages/chat/src/` are under 1000 lines:

| File | Lines |
|------|-------|
| `live/chat-session-manager.ts` | 379 |
| `live/cli-chat-engine.ts` | 284 |
| `recall-port.ts` | 113 |
| `routes.ts` | 289 |
| `live/persistence.ts` | 175 |
| `live-routes.ts` | 171 |
| `jobs.ts` | 157 |
| `live/runtime.ts` | 107 |
| `memory-settings-repository.ts` | 85 |

No file exceeds the 1000-line limit.

---

## Module isolation check

The chat module imports from `@jarv1s/ai`, `@jarv1s/db`, `@jarv1s/memory`, `@jarv1s/jobs`, `@jarv1s/shared`, `@jarv1s/module-sdk` — all declared public packages. No imports from another module's internal paths were found. Module isolation is **clean**.

---

## DataContextDb / VaultContext adherence

All repository methods in `ChatRepository` call `assertDataContextDb()` — **except** `insertMessage()` (private, always called via a public method that already asserts). `DataContextChatPersistence.resolveUserName()` calls `assertDataContextDb()`. **Exception:** `ChatUserMemorySettingsRepository.getOrCreate()` and `update()` do not call `assertDataContextDb()` — documented above as a MEDIUM finding.

No `VaultContext` usage expected in chat (chat messages are not vault items). No raw `fs` calls outside the `PersonaFs` seam.

---

## AccessContext shape check

All `AccessContext` objects constructed in `packages/chat/` carry only `{ actorUserId, requestId }`. No `workspaceId` or other fields found. **Compliant.**

---

## Payload check (pg-boss)

`EmbedTurnJobPayload`: `{ actorUserId, threadId, messageId }` — IDs only. **Compliant.**
`ExtractFactsJobPayload`: `{ actorUserId, threadId }` — IDs only. **Compliant.**
Message body/content is never included in job payloads.

---

## MCP gateway allowlist enforcement

The allowlist is enforced **server-side** in two layers:
1. `AssistantToolGateway.executableTools()` returns only tools with declared `execute` handlers from active module manifests — the list is derived from server configuration, not client input.
2. The Claude CLI is launched with `--allowedTools "mcp__jarvis__*"` (or `--tools ""` when no MCP), so the agent can only call tools the server chose to expose.

The user cannot override the allowlist. The MCP token identity comes from the server-minted `SessionTokenRegistry`, not from any field in the request body.

---

## Blocking confirmation flow assessment

The `ConfirmationRegistry.awaitResolution()` call genuinely blocks the `callTool()` coroutine (awaiting a Promise that only resolves on `resolve()` or timeout). The `resolveActionRequest()` endpoint runs the DB update under the actor's RLS context before calling `confirmations.resolve()` — so an action that failed DB write (wrong owner) returns early without unblocking the waiter. **The blocking flow is correctly implemented.**

No race condition was found in the confirm/deny path. The timeout (`confirmTimeoutMs: 150_000`) is wired at construction time and cannot be overridden per request.
