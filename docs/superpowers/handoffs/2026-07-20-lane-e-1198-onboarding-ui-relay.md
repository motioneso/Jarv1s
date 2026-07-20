# Lane E #1198 onboarding UI relay

## Scope

- Approved plan: `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`
- Branch: `feat/1198-onboarding-ui`
- Worktree: `~/Jarv1s/.claude/worktrees/lane-e-1198`
- Active supervisor: pane label `Coord 1193 Supervisor 4`
- Risk/verification: DB-less only. Do not run `verify:foundation`, create a DB, push, or open a PR without explicit supervisor grant.

## Completed

- Rebased branch onto `origin/main` `ad11d979` before implementation.
- Plan commit after rebase: `0dc32429`.
- Task 1 green commit: `5e16e2da` (`feat(job-search): add onboarding reset and resume import`).
  - Confirm-gated `onboarding.reset`.
  - Actor-scoped PDF/DOCX `resume.import-attachment`.
  - Reset preserves revisions, active pointers, and monitors.
  - Import reuses manual resume intake for byte-identical persistence.
  - Manifest has 18 tools.
  - Focused evidence: 73/73 tests passed.

## In progress: Task 2

TDD RED was observed because onboarding modules did not exist. These Task 2 files are currently uncommitted:

- `tests/unit/job-search-web-onboarding.test.tsx`
- `external-modules/job-search/src/web/screens/onboarding/model.ts`
- `external-modules/job-search/src/web/screens/onboarding/controls.tsx`
- `external-modules/job-search/src/web/styles.ts`

Production files were added, but GREEN has not been run. Resume with:

```bash
pnpm prettier --write \
  external-modules/job-search/src/web/screens/onboarding/model.ts \
  external-modules/job-search/src/web/screens/onboarding/controls.tsx \
  external-modules/job-search/src/web/styles.ts \
  tests/unit/job-search-web-onboarding.test.tsx

pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
```

Fix production implementation, not tests, until GREEN. Then run `pnpm check:design-tokens`, inspect diff, and commit Task 2 by staging only its explicit paths.

## Approved fork rulings

1. Mid-profile reload restores durable checkpoint only. Profile restarts at Titles with approved active fields prefilled. Keep one-write batching and pure sub-step derivation. Exact sub-step restoration moved to issue #1213; no Lane E scope change.
2. Reset overwrites only `NS.onboarding` with `{schemaVersion:1, step:resume_intake, completed:{}}` through `saveOnboardingState`; preserve revisions, active pointers, and monitors.
3. Each enabled Greenhouse/Lever/Ashby source requires a board token or URL. Use adapter `configHint` as helper text. Exactly one of `query.board`/`query.url`; server remains authoritative validator. Disable CTA while any enabled source lacks config.

## Remaining work

- Finish Task 2 GREEN and focused commit.
- Execute approved plan Tasks 3-5 with RED -> minimal GREEN -> focused commit per task.
- Stage explicit paths only; never `git add -A`.
- Run only DB-less checks authorized by plan/supervisor.
- At Task 5 Step 4, send gate-ready report with commit list and command evidence to exactly one pane labeled `Coord 1193 Supervisor 4` after resolving it with `herdr pane list`.
- Stop before push or PR until supervisor explicitly grants both.

## Relay reason

Compaction summary appeared after Task 2 files were added. Coordinated-build requires immediate relay at that tripwire. Successor should skip install when `node_modules` exists, read this relay in full, read only current plan sections as needed, and resume via `coordinated-build`.
