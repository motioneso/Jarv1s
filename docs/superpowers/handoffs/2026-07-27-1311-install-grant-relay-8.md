# #1311 install-grant — relay 8

Worktree: `/home/ben/Jarv1s/.claude/worktrees/1311-install-grant`, branch `1311-install-grant`.
Coordinator label: `Coordinator` — **re-resolve pane fresh via `herdr pane list` before any
escalation, never cache.** `node_modules` already present — do **not** `pnpm install`.

## Done (all committed)

- `939947c5` — tie-break fail-open fix in `packages/tasks/src/action-policy.ts` (canonical
  unconditionally wins when both canonical + legacy rows exist — legacy's timestamp is always
  >= canonical's because `setTaskChangesPolicy` writes canonical then legacy sequentially, so a
  timestamp tie-break silently dropped `always_confirm` back to `ask_each_time`). Coordinator
  explicitly ruled this in-scope, mandated the regression test below, mandated written
  justification for each stale-test rewrite (never loosen an assertion).
  - Regression test: `tests/integration/tasks-action-policy-self-heal.test.ts` — new
    `tieBreakUserId` (`...006`), new test `"both keys exist: canonical always_confirm wins even
    when legacy is written more recently"`. Also fixed `legacyOnlyUserId` collision
    (`...004` → `...005`).
  - 3 stale tests rewritten with justification comments (self-heal-on-read now mutates on first
    GET): `module-enablement.test.ts` (2 tests) and `tests/integration/tasks-web-contract.test.ts`
    (1 test, also strengthened to keep proving per-user isolation via an explicit divergent PATCH
    since both users now share the same self-healed default).

## In flight — MUST verify first

**Full `pnpm test:integration` rerun was started in background and had NOT finished** as of this
relay (vitest pid `1935118`, background task id `bj67lxucp`, log `/tmp/1311-t3.log`, ~7min elapsed
of an expected ~13min). The default vitest reporter buffers detailed output until the run
completes, so the log showed only one early, unexplained line:

```
❯ tests/integration/module-enablement.test.ts (27 tests | 1 failed) 10000ms
    × resolveGrantSelfOperationForModule routes a non-tasks manifest to the generic grant, not the compat helper 6ms
```

I re-read that exact test's current source (lines 818-843) and it matches the mandated rewrite —
looks correct on inspection. A 6ms failure is too fast to be a real DB assertion failure; likely
candidates: (a) stale log line left over from an earlier partial run of the same log file (check
whether `/tmp/1311-t3.log` was reused/appended across runs), or (b) a real ordering/state bug.
**First action: re-run `ps -p 1935118` / `TaskOutput` on `bj67lxucp` to check if it finished; read
the FULL final output (not the buffered partial) and get the actual error/stack for this test if it
still fails.** If it's a leftover log artifact, just re-run `pnpm test:integration` clean and
confirm exit 0 except the known `tests/integration/people/db-types.test.ts` "tuple concurrently
updated" flake (verify it's still unrelated to this change before dismissing it).

## Task 4 (live-path UAT) — RESOLVED by Coordinator, act on this directly

Coordinator confirmed (after this relay's heads-up) that its earlier "app-shell.spec.ts line ~412
is a real chat turn" claim was **wrong** — that file is the MOCKED suite (`page.route()` SSE
stubs, `tests/e2e/mock-*.ts`) and does not satisfy the no-mocks live-path criterion; the file says
so itself.

**Corrected instruction, verbatim from the Coordinator:**

> The real-instance harness is a SEPARATE suite: `tests/uat/specs/*.uat.spec.ts` — real dev
> instance, `requireBaseURL()`, `signIn()`, no mocks. Your template is
> `tests/uat/specs/1264-settings-self-operation.uat.spec.ts` (present on branch
> `1264-settings-self-operation`; read it with
> `git show 1264-settings-self-operation:tests/uat/specs/1264-settings-self-operation.uat.spec.ts`).
> Siblings worth skimming for the pattern: `real-chat-onboarding.uat.spec.ts`,
> `runtime-context.uat.spec.ts`.
>
> So Task 4 = a new `tests/uat/specs/1311-*.uat.spec.ts` modelled on that file. Reuse the
> sign-in/base-URL PLUMBING, assert against the live instance. A new file in `tests/uat/specs/`
> collides with nothing (settles the earlier "separate file" instruction too).
>
> What it must prove, precisely: a module that was ALREADY default-enabled BEFORE the install
> grant existed gets the grant applied on a real read (self-heal fires), and its granted tool then
> executes with no Approve/Reject card. A freshly-installed module does not prove #1311. 1533 is
> PROD — never target it.

This confirms the working hypothesis already recorded here: reuse `1264-uat-spec.ts`'s
`signIn()`/`requireBaseURL()` plumbing (copy at `/tmp/1264-uat-spec.ts` if still present, else
re-fetch via the `git show` command above — do not switch branches). The harness has **no
chat-capable AI provider at any seed level** (tracked gap #1121), so prove the #1311 claim the same
way `1264-uat-spec.ts`'s one real test does: a real, cookie-authed `fetch()` via `page.evaluate()`
against a live endpoint. Concretely: for a user who has never had a `task_changes` preference row,
`fetch("/api/tasks/agency-auto-execute")` against the live dev instance must return
`{enabled: true}` (self-heal fired on the real read, tasks was already default-enabled before
#1311 added the grant). Pair with a real UI check that no `.action-request-card` ever renders when
the granted tool executes, if the harness/seed level supports driving that tool call without a
chat turn — otherwise document that "no confirmation card" is proven at the integration-test layer
(`tests/integration/mcp-gateway-self-operation.test.ts`, cited in `1264-uat-spec.ts`'s own header
as the pattern for this) and the UAT spec proves the self-heal-on-read half only. Do not block Task
4 on #1121.

Write the new file at `tests/uat/specs/1311-install-grant-self-heal.uat.spec.ts` (or similar,
following the `<issue>-<slug>.uat.spec.ts` naming already in that dir). Commit it — a proof that
only lived in a terminal is not evidence.

## Failing test — DO NOT dismiss as stale log output

Coordinator was explicit: a 6ms failure in
`"resolveGrantSelfOperationForModule routes a non-tasks manifest to the generic grant, not the
compat helper"` (`module-enablement.test.ts`) is a **synchronous assertion failure, not a
timeout** — it usually means genuinely wrong routing. Re-run that ONE test file cleanly against a
fresh exported `JARVIS_PGDATABASE`, read the real error, and if it's real, **fix the routing** —
do not adjust the assertion to match. Only after confirming it's a real regression (or confirming
it's clean on a fresh isolated run) move on.

## Order for the successor

1. Resolve the Coordinator pane fresh (`herdr pane list`), check for a reply to the relay-7→8
   heads-up escalation (the app-shell.spec.ts "real chat turn" tension above).
2. Confirm/finish the `pnpm test:integration` rerun (background task `bj67lxucp` may have exited by
   now — check first). Get to exit 0 except the known unrelated `people/db-types.test.ts` flake.
3. Task 4: write the new live-path UAT spec file per the Coordinator's answer (or the working
   hypothesis above if it confirms). Commit it — a proof that only lived in a terminal is not
   evidence.
4. Task 5: write the PR description (plan doc lines 165-177 + relay-6's enumerated list + this
   session's tie-break fix write-up + justification for the 3 stale-test rewrites as expected
   consequences, not scope creep).
5. Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + `git fetch origin main &&
   git rebase origin/main`.
6. Fresh isolated gate DB: `GATEDB=jarvis_gate_1311installgrant`, drop/create via
   `docker exec jarv1s-postgres psql -U postgres -c 'DROP DATABASE IF EXISTS ...'` then CREATE
   (dropdb/createdb not on PATH), `JARVIS_PGDATABASE=$GATEDB pnpm verify:foundation`, check the
   real exit code (never pipe through tail/head), drop the DB after.
7. `coordinated-wrap-up` skill: clean tree, push, open PR, report to Coordinator. **DO NOT MERGE**,
   never touch board/milestones.

## Standing rules (unchanged, repeated from relay 7)

Never widen a family `defaultTier`, change a grant, edit `allowedTiers`, or loosen `policy.ts` to
make a test pass. Real dev instance, real login, no mocks for Task 4; never target port 1533
(prod). Gate DB must be fresh/isolated, exported `JARVIS_PGDATABASE`, never piped through
tail/head.
