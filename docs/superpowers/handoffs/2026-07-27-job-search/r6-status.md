# Round-6 status — applied vs not applied

Plan: `docs/superpowers/plans/2026-07-26-job-search-module.md`.
Round-6 verdict: `$SP/codex-r6-verdict.txt` — NOT LOCKED, 6 BLOCKER / 5 MAJOR / 1 MINOR.
Halted mid-round on Ben's instruction (2026-07-26): the plan is too detailed and the detail is what
keeps generating review surface. No round 7 was started.

File state at halt: **0 NUL bytes, 390818 bytes, 27 `### Task` headings, prettier exit 0**,
uncommitted, and the only file in the repo I touched.

Every constraint below — applied or not — is carried in `$SP/rulings-ledger.md`. The unapplied ones
must survive the rewrite **as constraints**, not as code.

## Applied (5 of 12)

| #   | Sev     | Plan section                  | What landed                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCKER | Task 2e (lanes) + Task 2      | `WorkerLane` is now `"queue" \| "tool" \| "briefing"`; the briefing invoker is named as the third caller in Task 2e's files + caller list; production-wiring test asserts `{lane: "briefing"}` and not `queue`.                                                                                                                                                                                         |
| 2   | BLOCKER | Task 2 Step 8                 | Removed the false "inherits enabled-status and package-hash verification for free". New `apps/worker/src/external-module-invoke.ts` → `createVerifiedExternalModuleInvoker`; `createExternalModuleJobHandler` is rewritten onto it; briefing adapter is a thin caller. Four integration tests, asserted on composed briefing output because `collectExternalBriefingContributions` swallows rejections. |
| 3   | BLOCKER | Task 2b Step 3b (migration)   | Migration now also grants `jarvis_worker_runtime` UPDATE on `app.notifications` + DELETE on `app.notification_reads`, with `notifications_update_worker` / `notification_reads_delete_worker` policies. Return-to-unread test retitled and required to run under a real worker data context.                                                                                                            |
| 4   | BLOCKER | Task 13 Step 6b (`setResume`) | Replaced the `FOR UPDATE` one-shot with a bounded retry (`ON CONFLICT DO NOTHING RETURNING`, 5 attempts); missing profile throws immediately and is distinguished from contention. Store test case 5 rewritten to fail a `FOR UPDATE`-only implementation, plus a nonexistent-profile sub-case.                                                                                                         |
| 5a  | BLOCKER | Task 15 (the Task 15 half)    | Added `handlers/matches.ts` + its test file, two `assistantTools` manifest entries (`job-search.matches.list` read, `job-search.match.dismiss` write), a third queue `job-search.match-state` (`allowManualRun: true`), new Step 12b with handler sketches and five unit tests, and two new Step 13 manifest assertions.                                                                                |

## Not applied (7 of 12)

| #   | Sev     | Plan section                  | The constraint that must survive                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5b  | BLOCKER | Task 20                       | Task 20 never calls the match tools. It must read via `invokeTool("job-search.matches.list", {profileId, limit})` and dismiss via `runQueue("job-search.match-state", "match.set-state", {matchId, state})`, and define loading / error / refetch. Dismiss is asynchronous (queue), so the board needs optimistic hide + reconcile on the next poll.                                                                                                                          |
| 6   | BLOCKER | Task 22 Steps 1, 4            | The e2e harness does not exist. No `pnpm dev:instance` script; `playwright.config.ts:19` starts only the web app. The shown command also starts the instance before setting the worker vars and applies `JARVIS_E2E_MODULE_FETCH_BASE` only to the Playwright process — the worker can never see either variable. Name a real checked-in harness that starts DB, API, worker, web, fixture server and module install, and pass both vars into the worker **before it boots**. |
| 7   | MAJOR   | Task 18 Step 1                | The file hoists a mock for `use-profiles.ts` and then claims to test the real hook in the same file — those cases exercise the mock. Real-hook cases belong in `job-search-use-profiles.test.tsx` where only `api.ts` is mocked; keep the `use-profiles.ts` mock exclusively in the `Root` branch tests.                                                                                                                                                                      |
| 8   | MAJOR   | Task 18 (enqueue)             | Keying the first-crawl latch by profile id only survives one mounted lifetime. Remount, navigation, StrictMode, or reload re-enqueues. Persist it under `actorScopeKey + profileId` in module-local storage; test refetch, unmount/remount, StrictMode, and profile switching. Manual "Search now" must bypass the bootstrap latch.                                                                                                                                           |
| 9   | MAJOR   | Task 15 (`runScore`)          | `notify.post` is called on every pass with `newMatchCount`. Because keyed refreshes deliberately return the notification to unread, a pass with zero newly scored postings resurrects the badge. Post only when the current invocation's `scored > 0`, and count only matches created during that invocation. Test: mark read → run a no-new-results pass → assert still read.                                                                                                |
| 10  | MAJOR   | Task 15 (sweep)               | The cursor advances for every profile while AI budget remains, even past the invocation deadline; later profiles return `"deadline"` unserved and the cursor skips them, possibly wrapping. Check the clock before each profile, stop at the deadline, have `runProfileStages` report deadline exhaustion explicitly, and persist the cursor at the first profile **not started**.                                                                                            |
| 11  | MAJOR   | Task 14 (per-portal deadline) | `deadlineAt` is only checked between page fetches, so one in-flight request can consume the whole invocation and starve later portals — the "overruns only its own share" claim is false. Either add a generic serializable host-clamped `timeoutMs` to `ModuleFetchRequest` set from the portal's remaining slice, or drop the hard-isolation claim. Test: a fetch stalling beyond the portal slice but under the invocation ceiling, and prove the next portal still runs.  |
| 12  | MINOR   | Task 5                        | `FailureKind` gained `"deadline"` but the "every kind has a summary" table still tests the original four. Add `"deadline"` and assert `disabled === false`, `retryAt` preserved, and that the summary does not describe the portal as broken.                                                                                                                                                                                                                                 |

## Earlier rounds

**No leftovers.** Rounds 1 (27 findings), 2 (16), 3 (16), 4 (12) and 5 (13) were each applied in
full before the next round ran; each round's prompt states this and the following round did not
re-raise them. Round 6 is the only partial round.

Two carry-forward notes that are not round-6 findings:

- **Round 6 understated one thing.** Its #5 asks Task 20 to "explicitly call these tools". A `write`
  tool cannot be called from the browser at all — `packages/ai/src/routes.ts:645-668` creates a
  pending assistant action and returns **403 `blockedReason: "confirmation_required"`** before
  `execute`. So dismiss must go through `runQueue`, not `invokeTool`. The stronger fix is what was
  applied in 5a.
- **One memory was stale and has been corrected**, not deleted:
  `~/.claude/projects/-home-ben-Jarv1s/memory/dev-instance-cli-1258.md` asserted a `pnpm dev:instance`
  CLI that `package.json` does not have since the 2026-07-26 reset. This is the same fact round 6's
  #6 depends on.
