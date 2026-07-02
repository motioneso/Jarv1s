# Handoff — #669 Wellness Dogfood Fixes

Issue: https://github.com/motioneso/Jarv1s/issues/669
Coordinator: `Coordinator`
Branch/worktree: `coord/669-wellness-dogfood` at `~/Jarv1s/.claude/worktrees/669-wellness-dogfood`

## Scope

Small dogfood lane approved by Ben without a separate spec/plan. Keep the change to these two `/wellness` feedback items:

1. Replace or remove the topbar subtitle text `PRIVATE` at `.workspace-area > .topbar > .topbar-titles > .topbar-subtitle`.
2. Fix the Wellness `Export` button flow: the modal opens, but the export action does not complete an export.

## Constraints

- Use `coordinated-build`.
- Do not touch `docs/coordination/`; coordinator-only.
- Do not run repo-wide format or broad staging.
- Do not use `git add .` or `git add -A`.
- Preserve unrelated work and leave `.claude/context-meter.log` unstaged if present.
- Keep implementation narrow; no redesign of Wellness.

## Expected Verification

- Add or update focused tests where practical for the export behavior and text change.
- Run the narrow relevant tests first, then the repo's expected type/lint check for touched frontend/API surfaces.
- Wrap up via `coordinated-wrap-up`: push branch, open PR, and report PR URL plus exact verification evidence to the coordinator.
