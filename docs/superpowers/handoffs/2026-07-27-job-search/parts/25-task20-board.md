### Task 20: Board, inspector, settings, and degraded states

The screen a profile shows once it has criteria: the two-axis match table, the per-match inspector,
and the per-profile settings. These are the states that decide whether the thing is usable.

**Depends on:** Task 15 (`job-search.matches.list` read tool, the `job-search.match-state` manual
queue, `job-search.crawl-run`), Task 16 (`job-search.portal.set-enabled`,
`job-search.profile.set-briefing-detail`), Task 18 (`invokeTool`, `runQueue`, `RunOutcome`).

**Files**

- Create: `external-modules/job-search/src/web/screens/{board.tsx,inspector.tsx,settings.tsx}`
- Test: `tests/unit/job-search-web-board.test.tsx`
- Test: `tests/unit/job-search-web-settings.test.tsx`

**Transport — reads and writes take different routes, and this is forced.** The board's data comes
from `invokeTool("job-search.matches.list", {profileId, limit})`, which works from the browser only
because that tool is `risk: "read"`. Every write on this screen is a write tool and would 403 at
`packages/ai/src/routes.ts:645-668` with `blockedReason: "confirmation_required"`, so dismissing a
match goes through the manual-run route instead:
`runQueue("job-search.match-state", "match.set-state", {matchId, state})`. `limit` is required by
the tool and has no default, so the board passes one explicitly.

That split has a consequence the screen has to absorb: **`runQueue` returns "queued", not "done".**
A dismiss is therefore optimistic — hide the row immediately, then reconcile against the next
`matches.list` result, and restore the row with a plain message if it comes back still `new`. A
board that waited for the write to land would appear frozen; a board that hid the row and never
reconciled would silently lie after a failed job.

**Board states.** `loading` (an authored skeleton, not an empty table), `error` (the message plus a
retry that re-invokes `matches.list`), `empty` (a real state, distinct from both), and `ready`.
Refetch happens on window focus and after any `runQueue` resolves.

**Constraints**

- **Fit and Want are separate sortable columns and are never combined.** No element renders a
  blended number, and settings offers no weighting control — a slider would smuggle in exactly the
  number the design forbids.
- **Unscored rows are visible, not absent.** A crawled-but-unscored posting renders `—` in both
  columns with a "Not read yet" flag, and sorts last under any active sort. The inspector explains
  that the queue is backed up and the posting has not been dropped.
- **Degraded portals render `cause.summary` and `cause.nextAction` verbatim.** The component must
  not compose its own failure sentence — the causes are authored in Task 5 precisely so the copy is
  written once, in one voice, by someone who knows what actually broke.
- **A disabled portal renders as disabled with its cause, not as an error.** A portal the module
  turned off itself (`login_required`) must say why it went off; otherwise the user re-enables it
  forever and it keeps failing.
- **"Search now" bypasses Task 18's enqueue latch.** It is an explicit user action; a deliberate
  re-run must not be swallowed by a stored record of an automatic one.
- **Briefing detail is exactly `"count" | "top" | "full"`** — the union Task 16 defines and
  `buildBriefingContribution` switches on. Do not invent a fourth level or rename these. It is
  stored on the profile row as `briefing_detail` with the check constraint from Task 4's schema,
  **not** in module KV, so it exports and deletes with the rest of the profile and a stale KV value
  can never disagree with a deleted profile.
- Tokens only; `pnpm check:design-tokens` fails on a literal, and `pnpm check:file-size` caps every
  source file at 1000 lines — split by screen before it bites.

**Tests** (`tests/unit/job-search-web-board.test.tsx`)

1. **The board reads through `invokeTool("job-search.matches.list", …)` with a `profileId` and an
   explicit `limit`.** Asserted on the transport. A board fed from a prop would pass every render
   test and show nothing in production.
2. **Fit and Want are separately sortable** — sorting by one does not reorder the other's values.
3. **Unscored rows render `—` in both columns with the "Not read yet" flag**, and their inspector
   says the posting is queued rather than dropped.
4. **Unscored rows sort last regardless of the active sort**, ascending and descending both.
5. **A row outside the stated frame renders its flag** — the reserved recall slice is visible as
   such, not silently mixed into the ranking.
6. **No element anywhere renders a combined score** — assert the rendered text against
   `/\boverall\b|\bcombined\b/i`. Cheap structural guard on the one thing the design forbids.
7. **A degraded portal renders `cause.summary` and `cause.nextAction` verbatim** — assert the exact
   authored strings, so a component that paraphrases fails.
8. **A disabled portal renders as disabled with its cause, not as an error state.**
9. **"Search now" enqueues a real crawl** — asserts
   `runQueue("job-search.crawl-run", "crawl.run", {profileId})`, not local state. There is no other
   way to start a crawl on demand: handlers have no enqueue port and the schedule only reaches
   `crawl.sweep`.
10. **"Search now" fires even when the profile's enqueue latch is already set** — mount with the
    latch present in module-local storage and assert the call still happens.
11. **Each `RunOutcome` renders its own state** — `queued` → searching; `already-queued` → "Already
    searching", calm and not an error; `disabled` → a plain explanation that manual runs are off;
    `error` → the message with the button still usable. A button that fires and then looks identical
    is the failure this case exists to catch.
12. **Dismiss enqueues `runQueue("job-search.match-state", "match.set-state", {matchId, state:
"dismissed"})` and hides the row immediately** — asserted on the call and on the row's absence.
13. **A dismissed match that comes back `new` on the next `matches.list` is restored with a plain
    message.** This is the case that keeps the optimistic hide honest; without it the board lies
    whenever the job fails.
14. **`matches.list` rejecting renders the error state with a retry that re-invokes it** — assert
    the second call. A board that renders an empty table on a failed fetch tells the user they have
    no matches when the truth is that nothing was asked.
15. **Zero matches renders the authored empty state, distinct from both loading and error.**

**Tests** (`tests/unit/job-search-web-settings.test.tsx`)

1. **Lists every portal with its state and turns one off through
   `job-search.portal.set-enabled`** — asserted on the tool call. A toggle that only flips a
   `useState` is the failure this test exists to catch.
2. **A self-disabled portal shows its cause rather than presenting it as a user choice**, verbatim
   from `cause.summary`.
3. **Offers exactly the three briefing detail levels and persists the choice** through
   `job-search.profile.set-briefing-detail` — asserted on the call, and asserted that no fourth
   option is offered.
4. **Renders no combined score and no scoring controls** — Fit and Want are not user-weightable.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-board.test.tsx \
  tests/unit/job-search-web-settings.test.tsx \
  && pnpm check:design-tokens && pnpm check:file-size && pnpm check:external-modules   # exit 0
```

---
