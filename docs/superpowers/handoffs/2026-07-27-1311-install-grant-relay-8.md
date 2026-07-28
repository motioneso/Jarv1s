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

## Open tension on Task 4 (live-path UAT) — flagged to Coordinator, awaiting reply

Coordinator's last message called `tests/e2e/app-shell.spec.ts` line ~412 (`"granted-tier settings
tool executes with no Approve/Reject card (#1264)"`, branch `1264-settings-self-operation`) "a real
chat turn." I read that file (via `git show 1264-settings-self-operation:tests/e2e/app-shell.spec.ts`,
without switching branches — copy at `/tmp/app-shell-1264.ts` if still present, else re-fetch the
same way) and it uses `mockApi()` / `page.route()` to mock `/api/chat/stream` and
`/api/chat/action-requests/*/resolve` — not a real dev-instance call. The file's own header comment
(lines ~403-411) explicitly states this test does NOT by itself satisfy a "real dev instance"
criterion. I flagged this discrepancy to the Coordinator in the relay heads-up message but have
**not yet received a reply** — check for one before proceeding.

Also read `tests/uat/specs/1264-settings-self-operation.uat.spec.ts` (copy at
`/tmp/1264-uat-spec.ts`) — the actual real-dev-instance harness. Pattern: `requireBaseURL()` reads
`JARVIS_UAT_BASE_URL`; `signIn(page)` does real login via `getByLabel("Email"/"Password")` +
`form.auth-form`'s Sign in button + onboarding skip-if-shown. **Known hard limitation: this harness
has NO chat-capable AI provider at any seed level** (confirmed by that file's own header and
sibling specs) — it cannot script a real chat turn to a model reply/tool call (tracked gap: #1121).
Its one real test does a cookie-authed `fetch()` against a live API endpoint via
`page.evaluate()`, no chat turn involved.

**Working hypothesis for Task 4** (not yet confirmed with Coordinator): write a NEW spec file
(not appended to `app-shell.spec.ts` — that file is being extended by #1276, which rebases behind
#1311 in merge order #1311→#1276→#1273, so two branches touching one file buys a pointless
conflict). Reuse the *login* pattern from `1264-uat-spec.ts`'s `signIn()`/`requireBaseURL()`
(real dev instance, real login, no mocks) — NOT the mocked SSE pattern from `app-shell.spec.ts`.
Since the harness can't drive a real chat turn, prove the #1311-specific claim at the API layer
instead: a module that's already default-enabled (tasks) — for a user who has never had a
`task_changes` preference row — gets `{enabled: true}` (self-heal fired) on a real, cookie-authed
`fetch("/api/tasks/agency-auto-execute")` against the live dev instance, mirroring the pattern in
`1264-uat-spec.ts`'s one real test. If a real UI assertion of "no confirmation card" is also
required, that needs either the harness's chat gap closed (out of scope, #1121) or a tool call
driven directly via API + a UI check that no `.action-request-card` renders — needs Coordinator
confirmation before choosing.

**Do not guess further on this — get the Coordinator's answer first** (my heads-up message is
already sent; check for a reply, and if none, ping again with the two concrete options above and
ask it to pick).

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
