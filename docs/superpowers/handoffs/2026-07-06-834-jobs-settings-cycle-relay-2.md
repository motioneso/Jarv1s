# Relay 2 — #834 jobs↔settings↔proactive-monitoring dependency cycle

**Trigger:** context-meter 70% warning. Relaying per `coordinated-build` step 3.

**Spec:** `docs/superpowers/specs/2026-07-04-module-web-registry.md`
**Plan (approved):** `docs/superpowers/plans/2026-07-06-jobs-settings-cycle.md`
**Prior handoff (superseded):** `docs/superpowers/handoffs/2026-07-06-834-jobs-settings-cycle-relay.md`
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/834-jobs-settings-cycle`
**Branch:** `834-jobs-settings-cycle`
**Coordinator:** label `Coordinator` — re-resolve pane fresh via `herdr pane list`, never reuse a
`w…-N` from this doc. Just sent it a status update (unprompted check-in after 40+ min silence) —
no reply needed unless it flags something.
**This build session (to be reaped):** id `f6bbc908-36f7-475b-afbb-930b3da9882e`, label `dep-cycle-2`.

## Status: Tasks 1–3 done and committed. Task 4 (verify) in progress, one open item.

Commits on this branch (all green individually):
1. `ad19d0ad` — test(check-package-deps): pure `detectDependencyCycles` + 5 unit tests
2. `58cc398c` — feat(check-package-deps): wire cycle check into `main()`; manually confirmed RED
   on live cycle (`@jarv1s/jobs -> @jarv1s/settings -> @jarv1s/jobs` and the 3-cycle through
   `proactive-monitoring`) before fixing
3. `018e5b59` — fix(jobs): inline `SETTINGS_MODULE_ID` literal in `upgrade-notify.ts`, drop
   `@jarv1s/settings` from `packages/jobs/package.json`, `pnpm-lock.yaml` updated

All 3 tasks match the plan exactly, no deviation. `pnpm check:package-deps` is green, `pnpm install`
shows no cyclic-workspace-dependency warning.

## Task 4 (verification) — what's been done, what's left

- `pnpm lint / format:check / check:file-size / check:design-tokens / check:no-ambient-dates /
  check:package-deps / typecheck / test:unit` — **all green** (test:unit: 272 files, 1850 passed).
  (format:check initially failed on `scripts/check-package-deps.ts` and the plan doc — fixed with
  `pnpm prettier --write` on both, not yet committed — see "Uncommitted" below.)
- `pnpm db:migrate` — green (135 migrations current, no new ones — this run touches no SQL).
- `pnpm test:integration` against the **default shared `jarv1s` DB** was badly red (relation
  `app.schema_migrations` does not exist, pg-boss errors, ~50 files failing) — root-caused to
  **multi-agent PG contention**: `herdr pane list` showed 3 other sessions concurrently `working`
  in worktrees `832-datasets-host-pinning`, `837-sports-postmerge-cleanup`,
  `835-scanner-reserved-paths`, none with a `JARVIS_PGDATABASE` override, all hitting the same
  default `jarv1s` database on the shared `jarv1s-postgres` container. This matches the
  `multi-agent-pg-contention` memory pattern exactly — **not a regression from this branch's
  change** (the change touches zero DB/migration code).
- **Isolated to my own DB** to get a clean read: created `jarv1s_fix834` (precedent: `jarv1s_fix800`
  etc. already existed from other agents), ran `JARVIS_PGDATABASE=jarv1s_fix834 pnpm db:migrate`
  (clean, 135 applied) then `pnpm test:integration` **3 times**:
  - Run 1: 1 file failed (`calendar-delete.test.ts`, `tuple concurrently updated` DDL race) — passed
    clean in isolation on retry.
  - Run 2: 2 different failures (`tasks-rename-recurrence.test.ts`, `auth-settings.test.ts`).
  - Run 3: 1 different failure (`wellness-export-format.test.ts`).
  - **Different file(s) fail each run** — classic pre-existing test-infra flake signature (DDL
    races in `resetFoundationDatabase` / lingering pg-boss worker teardown), not caused by my
    change. None of the failing files are anywhere near `packages/jobs`, `packages/settings`,
    `packages/proactive-monitoring`, or `scripts/check-package-deps.ts` (my collision-note scope).
    `fileParallelism: false` is already set in `vitest.config.ts`, so it isn't cross-file
    parallelism inside one run — likely async teardown (pg-boss workers/timers) bleeding across
    files.

## What's left for the successor

1. **Commit the prettier fix** (currently uncommitted, formatting-only, no logic change):
   `git add scripts/check-package-deps.ts docs/superpowers/plans/2026-07-06-jobs-settings-cycle.md`
   — pick a small commit message, e.g. `chore: fix formatting for #834 gate + plan doc`. (Verify
   `git diff --stat` first — should show only whitespace/formatting hunks in these two files.)
2. Decide how much more test:integration flake-chasing is worth it. My read: this is genuinely
   pre-existing, out of scope, and not worth spinning on further — record the evidence above
   (3 runs, different file each time, none in scope) in the `coordinated-wrap-up` report rather
   than trying to make test:integration deterministically green (that's a separate, unscoped fix).
   If you want one more confirmation run, use `JARVIS_PGDATABASE=jarv1s_fix834` (already migrated,
   still yours — no other agent knows about it) so you're not re-hit by cross-agent contention.
3. Re-run `pnpm install` once more after the prettier commit just to reconfirm no cyclic warning
   (last confirmed clean, shouldn't change, but cheap to check).
4. **Do NOT drop `jarv1s_fix834`** — leave it; it's a normal fixture DB like the others already in
   the cluster (`jarv1s_fix740` etc.), no cleanup instruction has been given for those.
5. Proceed straight to **`coordinated-wrap-up`**: pre-push trio (`format:check && lint &&
   typecheck`) + fetch/rebase on `origin/main`, push, open PR, report to Coordinator with:
   - PR link
   - the verify:foundation breakdown above (all gates green except the known-flaky, out-of-scope
     test:integration signature — name the 3 runs' differing failures as evidence it's not a
     regression)
   - confirmation `pnpm install` shows no cyclic-dependency warning

## Collision / bans (unchanged)

Own `packages/jobs`, `packages/settings`, `packages/proactive-monitoring`,
`scripts/check-package-deps.ts`, `tests/unit/`. `git add` explicit paths only, never `-A`. Never
touch `docs/coordination/`, the board, or merge — that's the Coordinator's job via
`coordinated-wrap-up`.
