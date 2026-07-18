# FIN-01 checkpoint — resume at plan Task 2, Step 3 (build wiring)

Pointer handoff for the successor session working epic #1144 in the harness-owned worktree
`~/Jarv1s/.claude/worktrees/finance-module` (branch `worktree-finance-module`, node_modules
installed — do NOT `pnpm install`, do NOT remove the worktree). Autonomous run; Ben
pre-approved automation to completion. Do NOT merge PR #1151 (FIN-00).

## Read these first (in order)

1. `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md` — THE execution
   source (13 tasks). Execute inline with `superpowers:executing-plans` (TDD, one commit per
   task, NO subagent fan-out — Ben token-budget preference).
2. `docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md` — locked D1–D7.
3. `docs/superpowers/handoffs/2026-07-18-fin-01-02-plan-and-build.md` — original scope,
   guardrails (Plaid creds/tokens secrecy, PR recipe, gate recipe), epic continuation
   FIN-03 (#1148) → FIN-04 (#1149) → FIN-05 (#1150).

## State at checkpoint

- Task 1 (spec amend) committed `9d38dfac`. Plan committed `1c7d2ed2`.
- Task 2 is MID-FLIGHT, checkpointed as WIP commit `63943e69` (unpushed):
  manifest test (`tests/unit/external-module-finance-manifest.test.ts`, ran RED as expected),
  `external-modules/finance/{jarvis.module.json,package.json,tsconfig.json}`, and
  `src/{domain/{errors,kv-port,index},adapters/{types,index},worker/{validate,wrap,ports,registry,index}}.ts`.
  **Finish Task 2, then `git commit --amend`** into the plan's verbatim Task 2 message
  (safe: 63943e69 is not pushed).

## Remaining for Task 2 (plan Steps 3–6)

1. **Build-script trap (unresolved):** `scripts/build-external-module.ts` builds
   `src/web/index.ts` unconditionally (~lines 32–44, no existsSync guard). FIN-01 is
   worker-only → `build:external:finance` would throw. Fix: add an `existsSync` guard to the
   shared script (FIN-02 reuses it when web lands). Keep job-search's build green.
2. Add root `package.json` script
   `"build:external:finance": "tsx scripts/build-external-module.ts external-modules/finance"`.
3. Write `tests/unit/external-module-finance-bundle.test.ts` mirroring
   `tests/unit/external-module-job-search-bundle.test.ts` but **worker bundle only** (no
   dist/web assertions): boots under plain node without node_modules → contract v1;
   undeclared handler → -32601 handler_not_found; declared handler (empty input on
   `finance.accounts.list`) → currently `{status:"not-implemented"}`; bundle contains no
   provider identifiers.
4. `pnpm build:external:finance && pnpm exec vitest run tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts` → both PASS.
5. Prettier the touched files, `git add` explicit paths only (never `-A`), amend-commit.

## Corrections already applied to the plan (trust code over plan JSON)

- Schedule `jobKind` = schedule name `finance.sync-sweep` (job-reconciler.ts:134), NOT the
  plan's `"sync.run"` — manifest + test already corrected.
- Queue `paramsSchema` (later tasks) uses wrapper `{type:"object",fields:{...}}`.
- FIN-01 queues declare no paramsSchema (fail-closed).
- Worker stubs in `src/worker/index.ts`: tokens/settings/isAdmin are placeholders; Task 5's
  `auth-port.ts` is the ONLY code allowed to touch `ctx.auth` (D5 clobber guard lives there).

## Then

Tasks 3–7 (FIN-01 → gate `jarvis_fin01_gate` → PR #1146 "Part of #1144, closes #1146",
stacked on #1151), Tasks 8–13 (FIN-02 → PR #1147), then FIN-03/04/05 per-slice
spec-delta → plan → build → PR. `memory_save` (project "jarv1s") immediately after
non-obvious decisions/traps/state shifts.
