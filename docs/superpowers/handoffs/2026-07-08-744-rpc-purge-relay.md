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
