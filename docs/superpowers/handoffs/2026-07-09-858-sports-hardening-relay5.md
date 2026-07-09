# Relay 5 — 858-sports-hardening (context 70%, half the plan built)

Same branch/worktree/coordinator as relay.md–relay4.md (not repeated). Plan already approved
verbatim by coordinator in relay4.md — **no re-approval needed, do not re-message asking for
approval.** Coordinator confirmed again mid-round-5: "noting 4 relays with zero code commits so
far... please proceed straight into TDD Task 1 now" — that objection is now moot, 3 of 6 tasks are
committed.

## Status: Tasks 1-3 of 6 DONE and committed. Tasks 4-6 + final gate remain.

Plan: `docs/superpowers/plans/2026-07-09-858-sports-hardening.md` (commit `ee9ec1c4`) — read it in
full, it has complete diffs/tests for every remaining task, no placeholders.

**Committed this round (verify with `git log --oneline -5`):**
1. `b6190b27` — 858b: `DEFAULT_FETCH_TIMEOUT_MS` + timeout in `createHostPinnedFetch`
   (`packages/datasets/src/host-pinning.ts`, `index.ts`, test file). Green.
2. `ada987ae` — 858b: threaded `fetchTimeoutMs` through `DatasetClientDeps`
   (`packages/datasets/src/client.ts`, test file). Green.
3. `24b8e621` — 858a: all 7 web-layer `key={}`/id-cap swaps in
   `packages/sports/src/web/sports-news.tsx` + regression test in
   `tests/unit/sports-newsband.test.tsx`. Green.

**858b (fetch timeout) is now FULLY DONE** — both its tasks landed. Only 858a's 3 service-layer
fixes remain (Tasks 4/5/6 in the plan), all in `packages/sports/src/sports-service.ts`.

## Next steps for successor

1. `[ -d node_modules ] || pnpm install` (already present — skip).
2. Read this doc in full. Read the plan doc's Task 4/5/6 sections in full (each has complete
   failing-test code + exact diff, verified line-accurate against this repo in rounds 3-4).
3. Continue TDD, one task per commit, in order:
   - **Task 4** — `topStoryIds`→`topStoryUrls` in `sports-service.ts:300,342`. New
     `describe("id→url story keying (#858)")` block in `tests/unit/sports-service.test.ts`.
   - **Task 5** — feature-body splice by url, `sports-service.ts:376-384`. Same describe block,
     new `it`.
   - **Task 6** — `rankTopStories`'s `pickedIds`→`pickedUrls`, `sports-service.ts:773-801`. Same
     describe block, new `it`.
   - Each: write test → run → confirm RED for the stated reason → implement the plan's exact diff
     → run → confirm GREEN (full file, no regressions) → `git add` only that task's explicit files
     (never `-A`) → commit with the plan's exact message.
4. **Final gate:** `pnpm test:unit` (full suite, no regressions) → pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) → `git fetch origin main && git rebase
   origin/main`.
5. `coordinated-wrap-up` — PR body MUST cite Tasks 4/5/6 by line reference (coordinator's
   condition) and state the 858b default timeout (15s) + rationale (shared path every connector
   runs through, not just fast ESPN JSON — see plan's Global Constraints section for exact wording
   to reuse).
6. Message coordinator (resolve `Coordinator` fresh via `herdr pane list` by label — do not trust
   any pane id/number from any prior handoff doc) with the PR link + evidence. Do not merge, move
   the board, or close the issue yourself.

## Bootstrap for successor (herdr-handoff)

Same worktree/branch. Bootstrap: "continue 858-sports-hardening; `[ -d node_modules ] ||
pnpm install`; read `docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay5.md` IN FULL,
then resume via `coordinated-build` starting at 'Next steps for successor' step 3 — Tasks 1-3 of 6
are committed (`b6190b27`, `ada987ae`, `24b8e621`), plan already approved, go straight to TDD Task
4, no need to re-ask coordinator."
