# #1311 install-grant — relay 10

Worktree: `/home/ben/Jarv1s/.claude/worktrees/1311-install-grant`, branch `1311-install-grant`.
HEAD: `a8696992`. `node_modules` present — do **not** `pnpm install`.

Coordinator label `Coordinator`. **Identity rule: pane `w…-N` numbers reflow on reap — resolve
the Coordinator fresh via `herdr pane list` by label `Coordinator` + `agent_session.value` every
time, never cache a pane id.** Identify yourself by your own session id (scratchpad path), not a
pane number.

## Done (all committed, ends at a8696992)

- `9a8d74ec` — Task 4: `tests/uat/specs/1311-install-grant.uat.spec.ts` (new file, real dev
  instance, no mocks) proving the tasks self-heal-on-read half live via a cookie-authed
  `fetch("/api/tasks/agency-auto-execute")`. Includes a bundled prettier-only formatting fix for 5
  files flagged by `format:check` (pre-existing drift from earlier relays, not logic changes).
  **A `test.fixme("chat dispatches a task_changes tool with no confirmation card (#1121)")`
  documents the chat-driven half is deferred — no chat-capable provider at any UAT seed level.**
  Coordinator has put **two conditions on this fixme** in a mid-turn message this relay that were
  not fully captured before this doc was written — **re-confirm with the Coordinator directly what
  those two conditions are before treating Task 4 as fully closed**, do not guess.
- `a8696992` — **this relay's fix**, Coordinator-approved: extracted
  `packages/chat/src/route-serializers.ts` out of `packages/chat/src/routes.ts`. Earlier #1311
  commits (`362ae925`, `63af893c`, both pre-existing, not this relay's) had pushed `routes.ts` to
  1007 lines, over the repo's 1000-line file-size gate — this is what a **fresh full
  `verify:foundation` run** (the first this lane has done) caught; the gate short-circuits the
  whole pipeline on this failure so nothing after it had ever run. Move-only per Coordinator's 3
  rules: no behavior/signature changes, every importer updated (repo-wide `git grep` swept clean —
  only one other importer, `tests/unit/chat-routes-freshness.test.ts`, fixed), committed separately
  from #1311 behavior work. `routes.ts` now 900 lines. Verified green: `typecheck` EXIT=0, `lint`
  EXIT=0, `format:check` EXIT=0, `check:file-size` clean (`npx tsx scripts/check-file-size.ts` →
  "No checked files exceed 1000 lines").

**NOT yet run since a8696992: a full `verify:foundation` pass.** The gate DB
`jarvis_gate_1311installgrant` exists (created this relay) but its one completed run hit the
file-size failure above (rc=1) before reaching `test:unit`/`test:integration`/UAT. **Re-run the
full gate from scratch** — don't assume anything past `check:file-size` in the pipeline is proven
green yet.

## Order for the successor

1. **Re-verify the pre-push trio + rebase** (cheap, do this first — confirms the extraction commit
   didn't drift): `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`. (`.claude/context-meter.log` may have
   unstaged local telemetry blocking rebase — `git stash push -- .claude/context-meter.log`, rebase,
   `git stash pop`.)
2. **Fresh isolated gate DB, full `verify:foundation`**:
   `GATEDB=jarvis_gate_1311installgrant`;
   `docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS $GATEDB;"`;
   `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE $GATEDB;"`;
   `export JARVIS_PGDATABASE=$GATEDB`. **Launch durably** (survives a relay/pane-reap) —
   `nohup bash -c 'pnpm verify:foundation; echo "### FINAL rc=$?"' > <logfile> 2>&1 & disown`, then
   poll/Monitor the log for the `### FINAL` marker (never trust a bash background-task "completed"
   notification at face value — it only reflects the launcher subshell returning, not the actual
   gate; confirm via the `### FINAL` marker in the log). Never pipe a gate command through
   tail/head. Drop the DB after: `docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE
   IF EXISTS $GATEDB;"`.
3. **Before treating Task 4 as closed**: resolve the Coordinator fresh via `herdr pane list` and
   ask directly what the "two conditions on the fixme" were (see Done section above) — they were
   stated in a mid-turn message this relay but not fully captured in durable state before this
   handoff was written. Apply them to the UAT spec if they require a change.
4. **Task 5** — PR description covering: plan doc Task 5 section + relay-6's enumerated list + the
   tie-break fail-open fix (`939947c5`, rebased hash) + the test-probe fix (`89d0eb40`, rebased
   hash — state as a correction, Coordinator-verified, not scope creep) + Task 4's UAT spec
   (`9a8d74ec`) + this relay's routes.ts extraction (`a8696992`, state clearly as a mechanical
   file-size-gate fix, not a feature change) + the live-path proof (paste actual Playwright output
   from running the UAT spec against a real dev instance — **not yet run this relay**, successor
   must run it and paste real output, not assume the spec passes from reading it).
5. `coordinated-wrap-up` skill: clean tree, green gate (step 2 above), push (after pre-push trio),
   open PR, report to Coordinator with evidence. **DO NOT MERGE**, never touch board/milestones.

## Standing rules (unchanged)

Never widen a family `defaultTier`, change a grant, edit `allowedTiers`, or loosen `policy.ts` to
make a test pass. Real dev instance, real login, no mocks for Task 4. Gate DB must be
fresh/isolated, exported `JARVIS_PGDATABASE`, never piped through tail/head, launched durably
(`nohup ... & disown`) so it survives a relay/pane-reap.
