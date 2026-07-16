# Relay — #1002 Coming-soon G2 build

- Spec: `docs/superpowers/specs/2026-07-15-1002-coming-soon-inventory.md`
- Plan: `docs/superpowers/plans/2026-07-15-1002-coming-soon-inventory.md`
- Handoff: `docs/coordination/handoff-1002-coming-soon-g2.md` (read this in full — locked scope + bans)
- Branch: `ux/1002-coming-soon-build`, worktree: this one (do NOT `pnpm install`, already done)
- Coordinator label: `UX Coordinator` (resolve fresh by label + session id, never a `…-N` number)
- Build already approved by coordinator: "APPROVED: execute only approved Tasks 2-5 TDD, serial,
  preserving #1050 exports and run-specific bans. Tasks 6-8 remain coordinator-owned; do not start
  #988. Report blocker or coordinated-wrap-up evidence."

## Done (committed `2f7f2bd4`)

- Task 2 complete: `packages/settings-ui/src/index.tsx` — `ComingSoon(props: {issue: number})`
  renders `Coming soon · #{props.issue}`; `Row`'s `coming?: boolean` replaced by
  `comingIssue?: number`. Deleted unreferenced `apps/web/src/shell/coming-soon.tsx`.
- `tests/unit/coming-soon-inventory.test.ts` created with Task 2 assertions (green) + Task 3
  assertions already written (red — call sites not yet updated).
- #1050 exports at top of `packages/settings-ui/src/index.tsx` (lines 5-10: `PrioritySettings` etc)
  were NOT touched — preserve them.

## Next: finish Task 3 (call sites), then Tasks 4-5

Tasks 2-5 must land together in one lane per the handoff's atomic-lane note — don't run full
`pnpm typecheck` as a per-task gate until Task 3's call sites are fixed (Row/ComingSoon consumers
are currently broken by the Task 2 contract change; that's expected and intentional).

1. **Task 3** — `apps/web/src/settings/settings-audit-pane.tsx` line ~195-200: change
   `<Row name="Export instance data" ... coming />` → `comingIssue={1069}`; `<Row name="Backup &
   restore" ... coming />` → `comingIssue={1070}`. `apps/web/src/settings/settings-module-subviews.tsx`
   line ~469: `<Row name="Push" ... coming />` → `comingIssue={743}` (also trim the now-redundant
   "Tracked in #743" from its `desc` per plan Task 3 step 3). Run:
   `pnpm exec vitest run tests/unit/coming-soon-inventory.test.ts && pnpm typecheck` — must be
   green before moving on. Commit these 2 files (test file already committed).

2. **Task 4** — `apps/web/src/onboarding/google-connector-step.tsx`: remove `SOON_PROVIDERS` const
   (lines ~63-66) and its render branch (`{SOON_PROVIDERS.map(...)}` around line 603); remove now-
   unused `Clock` import if nothing else uses it (check — `Clock` IS still used elsewhere, e.g.
   shell import removed already, but confirm in this file). Change "Connect another account or
   preview upcoming services." (line ~522) to truthful copy, e.g. "Connect another account." Update
   `tests/e2e/onboarding.spec.ts` (lines 150-183): the `Outlook`/`Microsoft 365`/`Soon` assertions
   at lines 182-183 must become "absent" assertions instead. Extend
   `tests/unit/coming-soon-inventory.test.ts` per plan Task 4 step 4 (scan onboarding TSX for
   `Coming soon`/standalone `Soon` markers without a nearby `#<number>`). Run vitest + playwright
   (`pnpm exec playwright test tests/e2e/onboarding.spec.ts`) + typecheck, green, commit these 3
   paths.

3. **Task 5** — `apps/web/src/settings/delete-account.tsx` line ~191-193: replace
   `Data export isn't available yet — download anything you want to keep first.` with
   `Export your data above before deleting your account.` (verified: `DataExport` already renders
   above `DeleteAccount` in `apps/web/src/settings/settings-personal-panes.tsx` lines 319/321 — no
   reorder needed, just copy). Add a failing-then-passing assertion to
   `tests/unit/settings-personal-panes.test.tsx` per plan step 1. Run the two named vitest files +
   typecheck, green, commit these 2 files.

4. Then Task 6 (integration — this build agent's job per plan, it's M1/read-only verification):
   run the full commands listed in plan Task 6 (`pnpm verify:foundation`,
   `pnpm audit:release-hardening`, the full vitest/playwright list). All must exit 0.

5. Pre-push trio + rebase (`pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`), then invoke **`coordinated-wrap-up`** — PR
   only, no merge, no board/issue mutation, report PR + evidence to `UX Coordinator`. Tasks 7-8
   (live UAT, #1002 inventory update) are coordinator-owned — do not attempt them.

## Run-specific bans (from handoff, still binding)

- Stage explicit paths only; never `git add -A`/`git add .` (note: `.claude/context-meter.log` shows
  modified in `git status` — it's a hook artifact, not ours; leave it unstaged).
- Never touch `docs/coordination/`, boards, milestones, issue state, or merge.
- No secrets/credentials/export contents/confirmation values in docs or logs.
