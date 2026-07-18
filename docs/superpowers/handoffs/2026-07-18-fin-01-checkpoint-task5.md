# FIN-01 checkpoint — Tasks 2–5 done, resume at Task 6 (2026-07-18)

Successor directive for the finance epic #1144 autonomous run. Worktree
`~/Jarv1s/.claude/worktrees/finance-module`, branch `worktree-finance-module`
(node_modules installed — do NOT `pnpm install`; do NOT merge PR #1151; all
finance commits are unpushed).

## Read these first (in order)

1. `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md`
   — THE execution source. Resume at **Task 6** (heading "### Task 6", ~line
   504). Execute with superpowers:executing-plans: TDD, one commit per task,
   plan's verbatim commit messages, explicit `git add <paths>`, prettier
   before commit, no subagent fan-out.
2. `docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md` —
   D1–D7 + KV/key design.
3. `docs/superpowers/handoffs/2026-07-18-fin-01-02-plan-and-build.md` —
   guardrails, gate recipe, issue map.
4. `memory_smart_search "FIN-01 checkpoint"` — session decisions (list below).

## State

- Commits (on top of origin `ae3f5c69`): `27a0eb43` Task 2 build wiring,
  `e32585fd` Task 3 domain keys/records, `e32b3016` docs pointer, `f87dac9a`
  Task 4 Plaid adapter, `e72070de` Task 5 connect handlers.
- 31 finance unit tests green across 5 suites
  (`tests/unit/external-module-finance-*.test.ts`). Nothing pushed, no PR yet.
- Task tracker: Tasks 2–5 completed; Task 6 (sync reducer + sync.run) next,
  then Task 7 (accounts.list + integration + gate `jarvis_fin01_gate` + PR
  #1146), then FIN-02 Tasks 8–13, then FIN-03/04/05.

## Decisions made this session (binding, not in the plan text)

- `WorkerPorts` (worker/ports.ts) now has `plaid: ((env, creds) =>
  PlaidClient) | null` factory and `creds: CredsPort`; the raw `fetch` port
  was REMOVED. Build clients via `buildPlaid(ports)` pattern (see
  handlers/connect.ts).
- `InputError` (worker/validate.ts) has a two-arg `(code, message)` form;
  one-arg keeps code `"invalid_input"`. Codes in use: `needs_config`,
  `token_read_failed`.
- `ModuleWorkerContext` exposes NO admin flag (verified in
  packages/module-sdk/src/worker.ts) → `isAdmin` stays false; connect.start's
  `environment` override is dropped for everyone until the SDK adds one.
- Plaid `client_user_id` = minted `randomUUID` persisted at user-scoped
  `NS.settings` key `"client-user-id"` (worker never sees the Jarvis user id).
- connect.start auto-reauths the FIRST item with status `reauth-required`
  (manifest inputSchema `additionalProperties:false` forbids an itemId param);
  missing token entry on reauth → `InputError("token_read_failed")`.
- linkTokenGet maps session status EXPIRED → "expired"; poll marks those
  abandoned. 30-min abandonment uses `ports.now()` vs `createdAt`.
- auth-port.ts is the ONLY file touching ctx.auth (slots
  finance.plaid-client-id / -secret instance, finance.plaid-tokens user).
- Instance environment read: `ctx.kv.get("instance", NS.settings, "plaid")`
  → `{ environment }`, anything else → production (wired in worker/index.ts).

## Task 6 pointers

Reducer `src/domain/reduce.ts` is PURE; `toRecord(tx)` owns the single
dollars→cents conversion (`Math.round(amount * 100)`, spending-positive).
`sync.run` shares one handler between queue `finance.sync-run` and tool
`finance.sync.run-now` (D3); queue input is `{actorUserId, jobKind,
idempotencyKey, params}` (D6) — see job-search run.ts:262 for the pattern.
Cursor persists ONLY after its page's chunks are written; D5 guard identical
to Task 5 (`completePublicToken` in handlers/connect.ts is the reference).
Per-item PlaidError → ItemRecord.status `error` (+`lastError`=code),
`ITEM_LOGIN_REQUIRED` → `reauth-required`, never abort the run.

## House rules

Why-comments citing issue ids; file-size ≤1000 lines; release-note summary
line in every commit body; `memory_save` (project `"jarv1s"`) after traps/
decisions/state shifts; checkpoint + fresh handoff before context exhausts.
