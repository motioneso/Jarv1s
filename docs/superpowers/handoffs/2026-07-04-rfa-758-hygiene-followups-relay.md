# RFA-758 Hygiene Follow-ups — Relay Handoff

**Branch/worktree:** `rfa-758-hygiene-followups` at `/home/ben/Jarv1s/.claude/worktrees/rfa-758-hygiene-followups` (already checked out, don't re-clone).

**Coordinator:** Herdr pane label `Coordinator` (resolve fresh via `herdr pane list` — do not trust any pane number written anywhere). Coordinator **already approved** the full plan and all 3 flagged judgment calls on 2026-07-04. No further plan approval needed — proceed straight to build + wrap-up.

**Plan doc (read this in full before doing anything):** `docs/superpowers/plans/2026-07-04-rfa-758-hygiene-followups.md` — fully written, contains exact code/steps for every remaining task. No further research/grounding needed; execute it.

**Source of truth:** GitHub issue #758 (the handoff doc for this slug never existed in this worktree — issue body was substituted, already reflected in the plan).

## Done (commits already on branch, do not redo)

- Task 1 (#677, IMAP creds cleared on connect success) — commit `0b33623f`.
- Task 2 (#751, muted priority sources now excluded not just capped) — commit `d6223bdd`. Touched `packages/priority/src/scoring.ts`, `tests/unit/priority-scoring.test.ts`, `tests/unit/chat-priority-consumer.test.ts`. All tests green (22 passed) at time of commit.

## Remaining tasks — execute in this order

Each is fully detailed in the plan doc under the matching heading. Follow TDD: write/update test first, watch it fail, implement, watch it pass, commit (stage only the task's files, never `git add -A`, trailer `Co-Authored-By: Claude <noreply@anthropic.com>`).

1. **Task 3 (#753)** — plan section "Quiet-hours time inputs no longer PUT invalid/empty values". Add `isValidQuietHoursTime` helper to `apps/web/src/settings/settings-personal-data-panes.tsx`, guard the two time-input `onChange` handlers, add test to `tests/unit/settings-quiet-hours-pane.test.tsx`. **Caution:** the plan flags re-confirming exact current line numbers/JSX for the two `<input type="time">` handlers before editing — read the file fresh first.
2. **Task 4 (#712)** — plan section "Remove dead MemoryPanel CSS and dead token alias". Update `tests/unit/unstyled-surfaces-css.test.ts` selectors first, then delete `apps/web/src/styles/kit-chat.css` lines 926-984 and `apps/web/src/styles/tokens.css` line 245 (`--provisional-opacity`). Re-verify line numbers are still accurate before deleting (files may have shifted).
3. **Task 5 (#752)** — plan section "Delete orphaned settings-data-source-model.ts". Re-run the grep check in the plan before deleting (defense against drift). Do NOT touch `packages/email/src/manifest.ts`'s `email.capture-tasks` — that's a deferred/documented-only item, already approved as no-code-change.
4. **Task 8 (#691)** — plan section "Add is-active styling coverage for sports team picker". Export `SearchResults`/`CompetitionGroup` from `packages/sports/src/settings/index.tsx` (add `export` keyword only, no signature change), add 3 tests to `tests/unit/settings-sports-pane.test.tsx`. Check the exact `SportsFollowDto` field names against existing fixtures in that test file before finalizing the new test fixtures.
5. **Task 9 — full gate + PR.** Plan section "Full gate and PR":
   - `pnpm format:check && pnpm lint && pnpm typecheck`
   - `git fetch origin main && git rebase origin/main`
   - `pnpm verify:foundation` (record exit code)
   - Push, open PR titled `chore: hygiene follow-ups from 2026-07-04 adversarial PR review (#758)`.
   - PR body: summarize items #677/#751/#753/#712/#752/#691 fixed, plus a **Deferred** section (verbatim content already drafted in the plan doc's Task 6/7) covering #749, #678, and the `email.capture-tasks` toggle from #752 — all three were explicitly approved by the Coordinator as documented-only, no code change.
   - Whether to write `Closes #758` in the PR body: **ask the Coordinator first** — deferred items may mean the issue should stay open or get re-filed narrower; don't assume.
6. **Wrap-up.** Once PR is open and gate is green, invoke `coordinated-wrap-up` to report the PR + verified evidence to the Coordinator, then stop. Do not merge, touch the board, or close the issue — that's the Coordinator's job.

## Task-tracking

Recreate a TaskList (TaskCreate/TaskUpdate) mirroring: Task 1 ✅, Task 2 ✅, Task 3 pending, Task 4 pending, Task 5 pending, Task 8 pending, Task 9 pending.

## Conventions to keep following

- Caveman-mode terse messages to the Coordinator (`herdr-pane-message` skill) — full technical accuracy, no filler.
- Before any `herdr pane run`/message, re-resolve the Coordinator pane via a fresh `herdr pane list` — pane numbers reflow.
- Escalate any real blocker (failing invariant, ambiguous requirement, flaky gate) immediately rather than spinning.
- Relay again at ~80-100k tokens or immediately on seeing a compaction summary — don't wait for a felt %.
