# Wrap Handoff — #669 Wellness Dogfood

Continue via `coordinated-build`, then `coordinated-wrap-up`.

Issue: https://github.com/motioneso/Jarv1s/issues/669
Branch/worktree: `coord/669-wellness-dogfood` at `~/Jarv1s/.claude/worktrees/669-wellness-dogfood`

## State

Implementation is committed:

- `1914444f` — `fix(wellness): fail stuck export jobs, replace PRIVATE subtitle (#669)`

Touched behavior:

- Replaced/removed the `PRIVATE` Wellness subtitle via `apps/web/src/app-route-metadata.ts`.
- Wrapped `handleWellnessExportJob` so failed Wellness exports mark the data export job failed instead of leaving polling clients stuck on `building`.
- Updated focused integration tests in `tests/integration/wellness-export-job.test.ts`.

Prior agent reported:

- focused typecheck/lint clean for touched files
- `tests/integration/wellness-export-job.test.ts`: 38 focused tests pass

The pane was stopped while starting broader `pnpm lint` due low context. Re-run only necessary final checks, then push/open PR.

## Notes

Tier is `sensitive` because this touches server-side personal-data export job error handling.

Do not stage `docs/coordination/handoffs/2026-07-02-669-wellness-dogfood.md` if it is still untracked in this worktree. Do not use `git add .` or `git add -A`.
