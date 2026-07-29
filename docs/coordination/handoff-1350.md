# Handoff — task #1350 (cli-runner must honour execution_mode)

- **Issue:** #1350 (read it in full — it contains the complete diagnosis; do not re-derive it).
- **Parent epic:** #1238. Blocks #1240. Related: #1347 (logging half).
- **Worktree:** `~/Jarv1s/.claude/worktrees/oneshot-1350` · **Branch:** `task/1350-runner-oneshot`
- **Tier:** sensitive (cli-runner, live chat path) — matched e2e-UAT + live-path proof on the PR.
- **Coordinator:** label `Coordinator`, session `43e5f5e2-0deb-4ab5-9237-436e8795b611`.

## Why this is urgent

**Prod chat is completely down right now.** Every `/api/chat/turn` 503s. Ben has explicitly asked
for the non-interactive engine — the multiplexer has been unstable and is being retired from the
default path.

## The defect in one paragraph

`createRealEngineFactory` (`packages/chat/src/live/runtime.ts:96-105`) selects
`ClaudePrintChatEngine` / `AgyPrintChatEngine` when `executionMode === "non_interactive"`. Prod sets
`JARVIS_CLI_RUNNER_SOCKET`, so `selectEngineFactory` (`runtime.ts:184`) takes the RPC fork and the
**cli-runner** builds the engine instead — `packages/cli-runner/src/engine-host.ts:229` always
constructs `CliChatEngineImpl` (tmux). `params.executionMode` crosses the wire and is consulted only
at `cli-chat-engine.ts:826`, which is `openai-compatible`-only. So anthropic and google get the
interactive engine in every containerized deploy regardless of the DB. #1239's flip is a no-op in
prod.

## Scope

1. Extract engine selection into ONE shared helper; call it from both composition roots
   (`runtime.ts` and `engine-host.ts`) so they cannot drift again.
2. Honour `params.executionMode` in `engine-host.launchOnce` for anthropic + google.
3. Regression test **at the RPC seam** — existing coverage only exercises the in-process factory,
   which is exactly why a fully-wired one-shot engine sat unreachable in prod. Assert an RPC launch
   with `non_interactive` builds a print engine and creates **no** tmux session.
4. A failed launch must leave no `jarv1s-live-*` session behind (`killMuxSessionByName` at
   `engine-host.ts:291` is not taking effect; a leftover session makes every later launch fail with
   tmux `duplicate session`).
5. Log a non-secret reason code runner-side when a launch fails. `CliChatUnavailableError` carries
   the cause via `redactCause` and both sides discard it before any log
   (`mapRpcError`, `chat-engine-rpc-client.ts:179`), which is why this took hours to find.

## Already ruled out — do not re-probe

CLI health (claude 2.1.183, node 24.18.0, tmux 3.3a; a manual tmux launch renders fine), disk (66G
free), inodes (23%), pids (70/76970), fds (~25/1048576), `JARVIS_CLI_PER_USER_UID=0`, and the
§4.1.0a gate (`JARVIS_CLI_RUNNER_SINGLE_USER=0`; parsed `=== "1"` at `main.ts:54` — the gate is OFF,
so no orphan session can block admission). Migrations 0172/0173 are applied and every prod provider
row is already `non_interactive`.

## Rules

- **Do not touch `docs/coordination/`** beyond reading this file. No board/milestone edits, no merge.
- **Never `git add -A` / `git add .`** — stage explicit paths. No repo-wide `pnpm format`.
- **Never edit an applied migration.** No DB change is needed here; prod data is already correct.
- Gate: `export JARVIS_PGDATABASE=jarvis_gate_1350` (freshly DROP/CREATEd) and use
  `scripts/run-gate.sh` — never a hand-rolled wait loop. `dropdb`/`createdb` are not on PATH; use
  `docker exec jarv1s-postgres psql -U postgres -c '...'` (`-U postgres`, never `-U jarv1s`).
- **Prod is off-limits.** `1533` and `10.252` and `jarv1s-prod-*` are PROD; do not touch them.
  Prove the fix on dev.
- Report back to the `Coordinator` label when the PR is open with live-path proof posted on it.
  Tag escalations `[SECURITY]` / `[DESIGN-FORK]` / `[CRIT]`.

Follow the `coordinated-build` skill.
