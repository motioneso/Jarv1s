# #990 News settings dogfood hardening — relay handoff 3

**Worktree/branch:** this worktree, `ux/990-news-settings-build`
**Plan (approved, amended):** `docs/superpowers/plans/2026-07-12-news-settings-dogfood-hardening.md`
**Coordinator:** label `UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973`
(re-resolve pane fresh via `herdr pane list` before messaging — never reuse a pane_id)

## Status

**Plan APPROVED by UX Coordinator, with one required change already applied.** Coordinator's
approval (verbatim): "Proceed with the four tasks, preserving the clean #981 rebase and existing
safe copy. Task 4 must include one focused Playwright path using the same local stateful mock
that proves existing Retry validation queues the owner-wide revalidation and exposes queued/error
feedback, as the approved spec explicitly requires. Do not add a new unit suite or change
retryRow/shared revalidation code; this is acceptance coverage only. Create/edit/remove
round-trip remains required. No other fork."

Task 4 amended: added a third Playwright test — "retry validation queues owner-wide
revalidation and surfaces queued/error feedback" — reusing the existing `**/api/news/revalidation`
mock pattern (first click → 202 queued, second click → 500 error, via a call counter in the
route handler local to that test). Asserts the queued text ("Revalidation queued — statuses
update after the next check.") and error text ("Could not queue revalidation. Try again.")
exactly as rendered by the untouched, shared `retryRow`/`revalidateMutation` in `index.tsx`.
`retryRow`/`revalidateMutation`/`triggerNewsRevalidation` are NOT modified — read-only reference.
Step 2 expected count updated 2→3 tests; Step 4 commit message updated. **Zero product code
written — plan doc only.**

## Next concrete step for successor

1. Implement task-by-task via `superpowers:test-driven-development` (NOT
   subagent-driven-development / executing-plans — both disabled for this build). Tasks 1-4 in
   plan order: PATCH client wrapper → section-kicker renames → `describe-topics.tsx` extraction →
   e2e spec (3 tests: round-trip, cancel/validation-failure, retry-validation feedback).
2. Stage explicit file paths only, never `git add -A`. Run the pre-push trio + rebase before
   every push. Close out via `coordinated-wrap-up` — never merge directly, never touch
   `docs/coordination/`.
3. Plan is already approved — do not re-send for approval unless you deviate from it. If you hit
   a fork not covered by the plan, stop and ask the coordinator; the approval said "no other
   fork."

## Reminders carried forward (still true)

- Do not edit: News routes/repository/policy/jobs, `packages/shared/*`, SQL, module-registry
  wiring, `#899` capture files, `#906` feedback controls, Settings shell files
  (`apps/web/src/shell/*`, `apps/web/src/settings/settings-personal-data-panes.tsx`), anything
  under `docs/coordination/`.
- No jsdom/`@testing-library/react` in this repo's unit harness. Edit-mode load/cancel is proven
  via pure exported helpers, not simulated clicks; the Playwright e2e spec is the only place real
  click-through is proven.
- `topicCreateErrorMessage()` and `PrereqGate()` move into the new `describe-topics.tsx` (bodies
  verbatim) so `index.tsx` only imports from it — avoids a circular import.
- `retryRow`/`revalidateMutation` in `index.tsx` (~lines 274, 330-354) stay untouched; the new e2e
  test targets them by rendered text, not role, since neither status span carries an ARIA role.
