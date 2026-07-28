# #1311 install-grant — relay 9

Worktree: `/home/ben/Jarv1s/.claude/worktrees/1311-install-grant`, branch `1311-install-grant`.
HEAD: `89d0eb40`. `node_modules` present — do **not** `pnpm install`.

Coordinator label `Coordinator`. **Identity rule (learned hard this relay): pane `w…-N` numbers
reflow on reap and are NOT reliable identity — a stale reflowed number caused a phantom
duplicate-agent scare last relay.** Resolve the Coordinator fresh via `herdr pane list` by
**label `Coordinator` + `agent_session.value`** every time, never cache/reuse a pane id across
messages. Same rule applies to identifying yourself: your own session id is in your scratchpad
path (`/tmp/claude-1000/.../<session-id>/scratchpad`) — quote that, not a pane number, if asked.

## Done (all committed, ends at 89d0eb40)

- `939947c5` — tie-break fail-open fix (`packages/tasks/src/action-policy.ts`).
- `86d68fb1` — relay-8 doc update carrying Coordinator's Task 4 pointer + failing-test ruling.
- `89d0eb40` — **this relay's fix**, Coordinator-approved: replaced the mutating
  `getResolvedTaskChangesPolicy()` postcondition probe in
  `tests/integration/module-enablement.test.ts` (~line 844, "routes a non-tasks manifest to the
  generic grant") with a raw-storage read (`prefs.getWithMetadata`), matching the precondition.
  Root cause: that getter unconditionally self-heals neither-row users to `trusted_auto` on ANY
  call (Task 3's `healInstallGrantAndReread`), so it could never observe "no row written"
  regardless of routing correctness — an invalid probe, not a routing bug.
  Coordinator independently verified this before granting sign-off; routing itself
  (`resolveGrantSelfOperationForModule`) was NOT touched. Verified green on a fresh isolated
  `JARVIS_PGDATABASE=jarvis_1311_singlefile` (dropped after): 27/27 pass in that file.

**Full `pnpm test:integration` was last run clean apart from this one fix** (background run that
surfaced the failure has completed; the single-file rerun above confirms the fix). A full suite
rerun has NOT been done since this commit — recommend one more full `pnpm test:integration` pass
before the gate, on a fresh `JARVIS_PGDATABASE`, to confirm no other interaction. Known unrelated
flake: `tests/integration/people/db-types.test.ts` "tuple concurrently updated".

## Order for the successor (per Coordinator's explicit instruction this relay)

1. **Task 4** — write `tests/uat/specs/1311-install-grant.uat.spec.ts` (new file, real dev
   instance, no mocks). Template: `tests/uat/specs/1264-settings-self-operation.uat.spec.ts`
   (read via `git show 1264-settings-self-operation:tests/uat/specs/1264-settings-self-operation.uat.spec.ts`
   — do not switch branches). Siblings for pattern: `real-chat-onboarding.uat.spec.ts`,
   `runtime-context.uat.spec.ts`. Reuse `requireBaseURL()` / `signIn()` plumbing only.
   Harness has **no chat-capable AI provider** (#1121, out of scope) — prove the #1311 claim via
   a real cookie-authed `fetch("/api/tasks/agency-auto-execute")` through `page.evaluate()`: for a
   user who never had a `task_changes` row, expect `{enabled: true}` (self-heal fired on real
   read). If the harness/seed level can drive the granted tool without a chat turn, also assert no
   `.action-request-card` renders; otherwise document that half is proven at the integration layer
   (`tests/integration/mcp-gateway-self-operation.test.ts`, cited in the 1264 spec's own header)
   and the UAT spec proves the self-heal-on-read half only. **1533 is PROD — never target it.**
   Commit the file.
2. **Task 5** — PR description: plan doc lines 165-177 + relay-6's enumerated list + tie-break fix
   write-up + this relay's test-probe fix (state it as a correction, not scope creep — Coordinator
   verified it independently).
3. Pre-push trio + rebase:
   `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
4. Fresh isolated gate DB: `GATEDB=jarvis_gate_1311installgrant`,
   `docker exec jarv1s-postgres psql -U postgres -c 'DROP DATABASE IF EXISTS ...'` then `CREATE
   DATABASE ...` (dropdb/createdb not on PATH), `JARVIS_PGDATABASE=$GATEDB pnpm verify:foundation`,
   check the **real exit code** (never pipe through tail/head), drop the DB after.
5. `coordinated-wrap-up` skill: clean tree, push, open PR, report to Coordinator with evidence.
   **DO NOT MERGE**, never touch board/milestones.

## Standing rules (unchanged)

Never widen a family `defaultTier`, change a grant, edit `allowedTiers`, or loosen `policy.ts` to
make a test pass. Real dev instance, real login, no mocks for Task 4. Gate DB must be
fresh/isolated, exported `JARVIS_PGDATABASE`, never piped through tail/head.
