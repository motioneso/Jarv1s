# #990 News settings dogfood hardening — relay handoff 4

**Worktree/branch:** this worktree, `ux/990-news-settings-build`
**Plan (approved):** `docs/superpowers/plans/2026-07-12-news-settings-dogfood-hardening.md`
**Coordinator:** label `UX Coordinator` (re-resolve pane fresh via `herdr pane list` — never
reuse a pane_id)

## Status

Tasks 1-2 DONE and committed (`bf9300f8` client wrapper, `eacd1644` section-kicker renames).
Task 3 IN PROGRESS, mid-TDD-cycle, RED just verified — do not redo Steps 1-2.

**Uncommitted right now:** `tests/unit/news-settings-pane.test.tsx` — Step 1 done (import block
swapped to pull `topicCreateErrorMessage` + 3 new pure-helper fns from
`../../packages/news/src/settings/describe-topics.js` instead of `index.js`; new
`describe("describe-topics pure helpers (#990)")` block added after the existing "add-flow
error/candidate helpers" block). Step 2 confirmed: suite fails with
`Cannot find module '.../describe-topics.js'` — expected RED, do not treat as a bug.

## Next concrete step for successor

Resume at plan Task 3, **Step 3** ("Create `describe-topics.tsx`") — copy the component verbatim
from the plan doc (lines ~289-597), then Steps 4-10 in order: re-run suite (pure helpers pass,
rest stale until index.tsx updated) → Step 5 update `index.tsx` (remove local `PrereqGate`/
`topicCreateErrorMessage`, remove topic state/mutations, swap in `<DescribeTopics>`) → Step 6 add
3 new render-based unit tests → Step 7 full suite green → Step 8 CSS → Step 9
`pnpm typecheck && pnpm check:file-size` → Step 10 commit. Then Task 4 (e2e spec, verbatim in
plan lines ~741-1092) unchanged from plan.

Continue via `superpowers:test-driven-development` (subagent-driven-development/executing-plans
disabled for this build). Stage explicit paths only, never `git add -A`. Pre-push trio + rebase
before every push. Close out via `coordinated-wrap-up` — never merge directly, never touch
`docs/coordination/`.

## Reminders carried forward (still true)

- Do not edit: News routes/repository/policy/jobs, `packages/shared/*`, SQL, module-registry
  wiring, `#899` capture files, `#906` feedback controls, Settings shell files, anything under
  `docs/coordination/`.
- No jsdom/testing-library; edit-mode load/cancel proven via pure exported helpers, live
  click-through only in Task 4's Playwright spec.
- Plan already approved with one required change (3rd e2e test for retry-validation feedback,
  reusing existing shared `retryRow`/`revalidateMutation` read-only). Do not re-send for
  approval unless deviating; "no other fork" per coordinator.
