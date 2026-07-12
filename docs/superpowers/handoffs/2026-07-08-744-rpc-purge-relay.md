# Relay continuation — PR #865 cycle-4 fix (purgeTranscripts RPC verb)

Predecessor (Fable, pane label `Fable-865`, session `f6b2a4ca…`) relayed at the 70% context
warning BEFORE writing any code. Grounding is complete; this doc carries it so you don't
re-read everything. No code commits exist for this fix yet — branch tip is `8210ad7d`.

## Read first (in this order)

1. Addendum handoff (lives in the COORDINATOR's worktree, not this one):
   `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/docs/coordination/handoffs/2026-07-08-744-fable-rpc-purge-fix.md`
2. Base handoff (this worktree, untracked — leave it untracked):
   `docs/coordination/handoffs/2026-07-08-744-private-chat-mode.md`
3. QA cycle #3 verdict: last comment on PR #865 (`gh pr view 865 --json comments --jq '.comments[-1].body'`).

Then follow `coordinated-build` (skill) — plan gate is satisfied by the addendum's Task list
(coordinator-authored); predecessor already notified the coordinator of the relay.

## The defect (from QA #3, verified in code)

`chat-session-manager.ts:894` (`cleanupPrivateSession`, live branch) calls
`session.engine.purgeTranscripts?.()`. `ChatEngineRpcClient`
(`packages/chat/src/live/chat-engine-rpc-client.ts:773-828`) does NOT implement it and
`RpcConnection` has no purge verb → silent no-op on the prod RPC deploy
(`infra/docker-compose.prod.yml:66`). `deleteThread` at `:908` then removes the incognito row,
so the boot-time orphan sweep can never reclaim the transcript. Masked in CI because
`tests/unit/chat-session-manager-private.test.ts` uses a `FakeEngine` that DOES implement
`purgeTranscripts` (line ~25).

## Grounded design (follow existing verb pattern exactly)

Server-side purge already exists: `CliChatEngineImpl.purgeTranscripts()`
(`packages/chat/src/live/cli-chat-engine.ts:341` — anthropic: `rm -rf transcriptDir`; else
`rm -f` resolved transcript path). The RPC plumbing around it is what's missing. Four files:

1. **`packages/chat/src/live/rpc-contract.ts`** — add `"purgeTranscripts"` to the `RpcMethod`
   union (per-session, sessionKey required — group with `kill`); add
   `RpcPurgeTranscriptsParams = Record<string, never>` and
   `RpcPurgeTranscriptsResult { ok: true }` mirroring kill/interrupt.
2. **`packages/chat/src/live/chat-engine-rpc-client.ts`** —
   `RpcConnection.purgeTranscripts(sessionKey)` → `this.call("purgeTranscripts", sessionKey, {})`;
   add the verb to the `callTimeoutMs` turn-verb switch (same class as `kill`; decide whether to
   also add to `resetActivityDeadline`'s turnVerbs set — kill is there);
   `ChatEngineRpcClient.purgeTranscripts()` → `this.conn.purgeTranscripts(this.sessionKey)`.
3. **`packages/cli-runner/src/connection.ts`** — `invoke()` case `"purgeTranscripts"`:
   `requireSessionKey`, `await host.purgeTranscripts(key)`, return `{ ok: true }`.
4. **`packages/cli-runner/src/engine-host.ts`** — `purgeTranscripts(sessionKey)`: sanitize key,
   `enqueue` per-key (like submit/kill); engine present → `engine.purgeTranscripts()`.
   **Open decision:** no-engine case. `kill` handles engine-less by mux-name + neutral-dir
   removal, but transcripts live under homeBase, not neutralDir. Options: throw
   `NotLaunchedError` (client maps to retryable 503 — but manager may then delete the thread row
   anyway → same leak) vs best-effort no-op. READ `chat-session-manager.ts` ~850–930 first to see
   how purge errors are handled before `deleteThread`; the invariant is: the incognito row must
   NOT be deleted if the purge didn't happen. If the manager doesn't already order it that way,
   that ordering is part of this fix. Escalate to coordinator only if it's a genuine fork.

## Regression test (task 2 — required)

Must exercise the REAL RPC path, not FakeEngine: real `serveConnection` (cli-runner) wired to a
real/instrumented `CliChatEngineHost` + real `RpcConnection`/`ChatEngineRpcClient` over a temp
socket, asserting a private-session end actually invokes the engine purge server-side. Find the
existing RPC round-trip tests to model on: `grep -rln "serveConnection\|RpcConnection" tests/
packages/*/tests` (predecessor did not get to this — locate before planning the test). Note
`RpcConnection.assertSocketUnderRunDir` is `protected` specifically so a test subclass can bind a
temp socket. Also check `tests/integration` foundation list traps (memory: foundation.test.ts
asserts full migration list — no migration expected here, so likely irrelevant).

## Optional (task 3, non-blocking)

`packages/chat/src/live/private-transcript-cleanup.ts:16,73` — engine-less Codex purge matches
per-USER cwd (neutralDir) rather than per-session. Cheap to include if time permits. QA #3 also
suggested a comment on migration `0146`'s SECURITY DEFINER noting system-wide-read intent.

## Bans / constraints (unchanged, from both handoff docs)

- Do NOT touch Gemini / agy-print / codex-exec purge paths — that's issue #868, out of scope.
- `git add` explicit paths only; never touch `docs/coordination/`, board, milestones, merge.
- Security tier: adversarial QA + Ben sign-off; treat any residual-trace path as blocking.
- Gate: `pnpm verify:foundation` + `pnpm audit:release-hardening`; pre-push trio
  (`pnpm format:check && pnpm lint && pnpm typecheck`) + `git fetch origin main && git rebase origin/main`.
- Wrap-up: `coordinated-wrap-up` conventions; push; report to coordinator (label `Coordinator`,
  resolve fresh via `herdr pane list`, exactly one pane) for QA cycle #4. Caveman-terse comms.
- Reap request: after you confirm you're driving, ask the coordinator to reap the predecessor
  pane (label `Fable-865`, session `f6b2a4ca-5a9d-4e73-8077-544a6b2a318e`) — resolve fresh, never
  by pane number.

## Successor #2 delta (2026-07-08) — grounding COMPLETE, design settled, no code yet

Successor #2 (session `bf11eeff…`) finished all grounding, resolved the §"Open decision", then
hit the 70% meter (compaction inflated its start) before writing code. Successor #3: skip all
re-reading except what you edit; implement directly from this settled design. Branch tip
`33f24b56` (docs-only).

**Key finding — engine-less is the NORMAL path, not an edge:** `host.kill()` DELETES the engine
from the server map (`engine-host.ts:316-331`, delete at :323) and the manager kills BEFORE
purging (`chat-session-manager.ts:882-911`). So over RPC, purge always arrives engine-less.

**Settled design:**

1. `rpc-contract.ts`: add `"purgeTranscripts"` to `RpcMethod` (union at :145-158, group with
   kill); `RpcPurgeTranscriptsParams = Record<string, never>`; `RpcPurgeTranscriptsResult
   { ok: true }` (kill shapes at :298-303).
2. `chat-engine-rpc-client.ts`: `RpcConnection.purgeTranscripts(sessionKey)` (verb methods
   :260-282); add to BOTH the `callTimeoutMs` turn-verb case (:236-256) AND
   `resetActivityDeadline` turnVerbs set (:292-305) — kill is in both;
   `ChatEngineRpcClient.purgeTranscripts()` → `this.conn.purgeTranscripts(this.sessionKey)`
   (class :773-828).
3. cli-runner `connection.ts`: `case "purgeTranscripts"` in `invoke()` (:187-290) mirroring kill
   (:218-222): `requireSessionKey` → `await host.purgeTranscripts(key)` → `{ ok: true }`.
4. `engine-host.ts`: `purgeTranscripts(sessionKey)` — sanitize key, per-key `enqueue`
   (:111-123); engine present → `engine.purgeTranscripts()`; engine ABSENT (normal case) →
   `purgePrivateTranscripts(this.deps.io, this.deps.neutralBase, key, this.deps.homeBase)`
   (deps already carry all three). Do NOT throw NotLaunchedError — engine-less purge must work.
5. **Export gap:** `purgePrivateTranscripts` is NOT exported from `packages/chat/src/live/index.ts`
   (grep-verified) — add the export so cli-runner can import from `@jarv1s/chat/live`.
6. **Manager ordering fix (REQUIRED, both branches of `cleanupPrivateSession` :882-911):** gate
   `deleteThread` (:908-910) on purge SUCCESS. On purge failure: still `sessions.delete` + clear
   detach timer + revoke MCP token (else `sweepOrphanedPrivateThreads` :913-919 skips rows where
   `sessions.has(key)` — row stuck forever), but do NOT deleteThread — boot sweep retries.
   Currently purge errors are swallowed (:894 `?.()` + catch) — that swallow is part of the bug.
   Also treat `purgeTranscripts` being undefined on the engine as failure, not success —
   optional-chain silent no-op is the exact defect class.
7. Rejected QA's alternative (call api-side purge in the live branch): on split topology,
   `rm -rf` of nonexistent paths falsely succeeds → row deleted, transcripts survive. RPC verb
   result is the authoritative signal. Leave `runtime.ts:397` unconditional api-side dep wiring
   as-is (serves the manager's engine-less branch; defense in depth).

**Cleanup call sites** (for the ordering fix + tests): endPrivateSession :662 (callers :648,
:764), reconcile :797, detach timer :869, boot sweep :917. Manager dep sig :155.

**Not yet done:** locate RPC round-trip test models
(`grep -rln "serveConnection\|RpcConnection" tests/ packages/*/tests`) → TDD per §Regression
test; then optional task 3; then gate/wrap-up per §Bans.

## Successor #3 delta (2026-07-08) — test models located, still no code

Successor #3 (session `4e095edd…`, pane `Fable-865-r3`) resumed from a COMPACTED transcript and
hit the 70% meter immediately (compaction summary alone ≈70% of context — same trap as #2).
**Successor #4: you MUST be a FRESH spawn, and you must write code FIRST, reads only for files
you are editing.** Everything below is verified — do not re-verify.

**Test models (both grounded in full):**

- `tests/unit/cli-runner-server.test.ts` — `makeFakeIo()` (fake TmuxIo; live-mux Set;
  `removedDirs` array records every `rm` target — this is your purge assertion), `makeHost(io)`,
  `FakeChannel implements ByteChannel` with `feed()`/`decodeAll()`, `authenticate(channel)`
  drives the §3.6 hello (`hmacClient(nonce) = HMAC(secret, HELLO_PROOF_TAG_CLIENT + nonce)`),
  `serveConnection(channel, { host, bootId, secret })`.
- `tests/unit/chat-rpc-client.test.ts` — `startFakeServer(socketPath, secret, opts)` real
  `net.createServer` Unix socket; `tmpSocket()` = mkdtemp + `cli-runner.sock`;
  `class TestConn extends RpcConnection { protected async assertSocketUnderRunDir() {} }` to
  relax the /run/jarv1s guard for temp sockets.
- **Regression-test shape:** combine them — `net.createServer((sock) =>
  serveConnection(sock, { host: makeHost(fakeIo), bootId, secret }))` on a `tmpSocket()`, client
  = `TestConn` + `ChatEngineRpcClient`; call `kill` then `purgeTranscripts` (engine-less normal
  path) and assert `fakeIo.removedDirs` contains the anthropic transcript-glob dir.

**Manager test grounding (task: ordering fix):** `tests/unit/chat-session-manager-private.test.ts`
— `FakeEngine` :6-29 (has `purged` flag — the CI mask), `privateDeps()` :31-54. Add cases:
(a) `purgeTranscripts` REJECTS → `deleteThread` NOT called, but `sessions` map cleared + detach
timer cleared + `revokeMcpToken` still called; (b) engine WITHOUT `purgeTranscripts` (delete the
method off a FakeEngine instance) → treated as FAILURE → no `deleteThread`; (c) engine-less
branch: `deps.purgePrivateTranscripts` rejects → no `deleteThread`; (d) existing happy paths stay
green. Manager dep sig confirmed at `chat-session-manager.ts:155`
(`purgePrivateTranscripts?: (sessionKey: string) => Promise<void>`).

**Contract/client shapes confirmed** exactly as §Settled design describes (kill shapes
rpc-contract.ts:298-303; timeout switch + `resetActivityDeadline` turnVerbs + verb methods +
`ChatEngineRpcClient` all match the cited lines). `purgePrivateTranscripts`
(private-transcript-cleanup.ts) keeps its local non-exported `sanitizeSessionKey`/
`deriveNeutralDir` → `export * from "./private-transcript-cleanup.js"` in
`packages/chat/src/live/public.ts` is collision-safe (verified). The `./live` subpath maps to
`src/live/public.ts`, NOT index.ts — the export goes in **public.ts**.

**Task list to recreate:** (1) purge RPC verb across the 4 files + public.ts export; (2) manager
ordering fix; (3) real-RPC regression test (TDD: write it first). Then pre-push trio + rebase +
`pnpm verify:foundation` + `pnpm audit:release-hardening` → coordinated-wrap-up → report for QA
cycle #4.
