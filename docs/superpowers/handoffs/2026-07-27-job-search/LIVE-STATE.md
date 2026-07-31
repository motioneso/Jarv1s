# Job Search — live state (updated 2026-07-28)

Pointer doc. Nothing here is a recap; each line tells you where to look.

Branch `feat/job-search`, worktree `~/Jarv1s/.claude/worktrees/job-search`.
Last verified live on the dev instance at commit `2493b3da`.

## Where it stands

Epic #1280. The module is installed, running, and **proven live end to end** against the real model
and a real crawl — not mocked:

1. Onboarding interview — typed answers, model replies, criteria persisted. Writes land through
   Approve/Reject cards; nothing persists until Approve is clicked.
2. Activation — the profile leaves `in_conversation` for `active` once `wantNarrative` is set.
3. Crawl — 81 postings for one profile (Duolingo, Netflix, Gusto, Runway, Ashby, Discord, Patreon).
4. Scoring — `AI_CALL_BUDGET = 8` per pass by design; the scheduled sweep continues (observed
   8 → 14 scored across two passes).
5. Board — 25 roles, sortable, with Dismiss.
6. Detail panel — opens from the role title; the Want reasoning is specific to the typed want
   narrative and honest about what it cannot know.

## Landed commits

- `14abc59b` — board and match inspector usable end to end (layout, host `jds-table`,
  selected-row marking, scroll-into-view)
- `a1548f23` — search runs actually produce scored matches
- `9e37f6a9` — Fit and Want render as a bar, not just a number
- `a53893b7` — the setup screen is centred and sized to its own content (it had been pinned to the
  top of an empty page, in a card twice as wide as the text inside it)
- `2493b3da` — approval cards say "Needs your approval" / "Approved", not `SET` / `SET-ENABLED`

## Known defects, in priority order

1. **Fit is `0` on every row** — onboarding activates without a résumé, and `domain/score.ts` tells
   the model to return `fit: 0` when no résumé exists. The detail panel says "Fit is not knowable";
   the table prints `0` and sorts on it (`FIT ▼` is the default sort). Needs a profile-level résumé
   signal so the cell can render `—`, or a hard résumé gate on activation. Analysis in agentmemory
   `job-search-fit-zero-without-resume`.
2. **Stale banner** — "Searching for new roles — they'll appear below as they're scored" stays up
   after the crawl has finished.
3. **Company names are raw source slugs** — `spikelabs`, `apartment-list`, `revv-hq`, `lilly`.
   Reads as scraped data rather than a product.
4. **The sidebar background stops partway down** a long board page, leaving a black void beneath.
5. **`Dismiss` repeats on all 25 rows**, making the action column the loudest thing on the page.
6. **Park Press reconciliation still outstanding** — Claude Design project
   `Jarvis — Park Press Design System`, `projectId 0501fab4-7c60-457d-9a46-b717d55e16c9`.
   `get_file` elides anything over ~4KB, so `ui_kits/job-search-onboarding/JobsOnboarding.jsx`
   (23.5KB) and `design_handoff_job_search_onboarding/README.md` (13.5KB) are unread. The mockup's
   mono eyebrows are superseded — mono was retired 2026-07-08.

## Operational notes

- **A dead queue consumer looks exactly like a hash problem.** A poison job (crawl for a deleted
  profile) left the worker no longer consuming `job-search.*`; later jobs sat in pg-boss `created`
  forever, with matching hashes and a live worker process. Restarting the worker fixed it instantly.
  See agentmemory `module-queue-consumer-dies-after-repeated-failures`.
- **Never use `locator("textarea").first()` in a drive** — the Agentation dev overlay owns the first
  textarea on the page and the send silently does nothing. Use
  `getByRole("textbox", { name: "Message Jarvis" })` and `{ name: "Send", exact: true }`.
- **Pace a drive on the typing indicator**, not a fixed sleep: sending while a turn is in flight
  returns `409 A chat turn is already in progress` and the answer is lost with nothing on screen to
  say so. Wait for `.assistant-surface__typing` to clear.
- Board rows are not clickable; only the role title (`.jds-table__rowlink`) is.

## Not yet run

`pnpm verify:foundation` has not been run this session — format, lint and integration are unproven
on `a53893b7` and `2493b3da`. `pnpm typecheck` passes. Run the gate with a fresh exported gate DB
and no concurrent edits.
