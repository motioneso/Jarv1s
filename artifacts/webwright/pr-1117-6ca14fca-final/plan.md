# Critical Points — PR #1117 exact-head live UAT

PR head under test: `6ca14fcad8bec023c98e699000a2384657232843` ("fix(settings): memoize
Activity since to stabilize query key")

Prior RED at `4d2d17ba418b9140a7ea307398fe9e447bd06446`: CP5 root-caused live to
`sinceForRange()` recomputing an unmemoized `Date.now()`-based `since` on every render for
non-"today" ranges, embedded raw into the `useQuery` key — every render (including the one
triggered by the 3s AbortController firing) minted a brand-new query key before the aborted
query's `isError` could ever be observed, so "Activity unavailable." never rendered
(self-sustaining abort→remount→refetch loop). See prior worktree's
`artifacts/webwright/pr-1117-4d2d17ba-final/UAT_HANDOFF.md` (read-only reference).

This exact head's commit (`6ca14fca`) memoizes `since` with `useMemo` keyed on `range`,
directly targeting that root cause. This run re-verifies the full CP1-CP8 walkthrough on
this exact head, with particular scrutiny on CP5 (the fix under test) and CP6 (retry
recovery), which were never reached in the prior RED session.

- [x] CP1: Fresh owner signup (bare seed, no pre-existing owner) completes end-to-end on this
      exact head and reaches the app (not stuck on an onboarding step).
      Evidence: `final_runs/run_1/screenshots/final_execution_02_post_signup.png` (Welcome
      step, in progress, not error) + log `step 1 action: CP1 post-signup URL=.../`.
- [x] CP2: Onboarding Finish -> visible "Go to settings" control lands on `/settings`, not
      `/today`.
      Evidence: `final_runs/run_1/screenshots/final_execution_04_onboarding_finish.png`
      ("Go to settings" button visible) + log `CP2 clicked 'Go to settings', landed
      URL=.../settings`.
- [x] CP3: Settings module paths are reachable (Appearance, Activity panes render from the
      nav).
      Evidence: `final_runs/run_1/screenshots/final_execution_06_settings_appearance.png`
      (Appearance pane rendered, nav highlighted).
- [x] CP4: Activity pane on a normal (fast) backend response loads without showing a false
      error.
      Evidence: `final_runs/run_1/screenshots/final_execution_07_activity_fast_load.png`
      ("No Jarvis actions in this period.", no error/loading state).
- [x] CP5: Activity pane on a backend response delayed past 3s shows the truthful recovery
      state ("Activity unavailable." + "Try again") promptly after the 3s client-side abort —
      not stuck on "Loading..." through retry backoff or an abort/remount/refetch loop (the
      exact regression this HEAD's commit fixes).
      Evidence: `final_runs/run_1/screenshots/final_execution_08_activity_delayed_error.png`
      (unambiguous "Activity unavailable." + "Try again" button) + log `CP5 truthful error
      shown after 3.64s`. Prior session's RED (same CP, prior head) never reached this state;
      this head's `useMemo` fix resolves it live.
- [x] CP6: Clicking "Try again" against a normal (fast) backend recovers Activity to a loaded
      state (proves the memoization fix only stabilized the query key, not manual recovery).
      Evidence: `final_runs/run_1/screenshots/final_execution_09_activity_recovered.png`
      ("No Jarvis actions in this period." — error fully cleared, real empty-state content).
- [x] CP7: Narrow (390x844) Today masthead stacks readably with wrapped multi-word lines --
      not a one-word-per-line collapsed column -- and has no horizontal overflow.
      Evidence: `final_runs/run_1/screenshots/final_execution_10_today_narrow.png` ("ALL
      CLEAR" / "TODAY" wrapped, column layout) + log `scrollWidth=390 viewportWidth=390`.
- [x] CP8: Desktop Today sanity: authenticated content renders normally (no regression from
      the Activity-only code change).
      Evidence: `final_runs/run_1/screenshots/final_execution_11_today_desktop_sanity.png`
      (masthead, agenda, wellness, sports desk all rendering).

## Result: GREEN — all 8 CPs pass on exact head `6ca14fca`, `final_runs/run_1`.

Each CP is independently verifiable from a screenshot and/or a `final_script_log.txt` line.
