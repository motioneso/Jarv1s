# Job Search — search progress + whole-board read (handoff)

**Branch** `feat/job-search` · **Commit** `6ec06a94` · **Epic** #1280 · **Status** code-complete and
live-proven on dev; not merged.

## What was wrong and what shipped

Ben reported two defects in one sitting. Both are fixed and proven in a real browser.

1. **"I just see 25 roles still and that hasn't changed."** The board only ever read the first page,
   so the header count was the page size, not the board. It now pages the whole board (172 rows on
   the live board) and the header matches the rendered rows.
2. **"The button pushed over to the left … shouldn't it also be disabled while it is searching?"**
   Search now holds its position when the status line appears, is disabled for the duration of a run,
   and the notice reads "Searching… new roles will appear below."

## The one thing worth reading before you touch this

Every module read tool in the app shares **one 60-requests-per-minute budget**
(`AI_TOOLS_MAX`, `packages/ai/src/routes.ts:12`). A full board read is one request per 25 rows, so
two overlapping reads is fourteen requests in a second — and a 429 mid-read silently drops a whole
page. `board.tsx` therefore has an `inFlightRef` with **two** readers, and the split is load-bearing:

- `refreshRows()` **joins** a read already running — mount, window focus, search poll. None of them
  has a write to confirm.
- `fetchMatches()` **always forces** a fresh read — Save, Pass, retry. A write path must not join, or
  it gets a read that began before its own write and `reconcileHidden` raises a false
  "A dismissal didn't go through".

React's **development double-mount** was half the duplication; fixing only the focus refetch left the
offsets doubled. Full detail in memory: `board-read-overlaps-burn-the-rate-limit`.

## Verification actually run

- Live browser proof `$SP/prove-paging.mjs` → `RESULT=PASS`, `EXIT=0`. Header 172 == 172 rendered
  rows; page offsets `0,25,50,75,100,125,150` (previously each one twice); button unmoved and disabled
  at 15 s / 45 s / 90 s into a real crawl; no console errors beyond the pre-auth 401.
- Full gate: **3928 unit + 1824 integration passing.** The only red is the known pre-existing
  cluster-global finance role condition (`jarvis_mod_finance_install` cannot be dropped) — see memory
  `pg-roles-are-cluster-global`.
- `tests/integration/job-search-store.test.ts` 14/14, including a cross-owner RLS case on
  `countMatches`.

## Next actions

1. **Ben: go e2e.** Dev is up — `http://100.64.98.99:5197`, sign in as `ben@ben.com`. Open the job
   board, check the header count against the rows, press Search now.
2. Open a PR for `feat/job-search` once Ben has signed off on the live pass.

## Flags for Ben (nothing here blocks the e2e)

1. The **real fix is platform-side**: module UI reads pay both a 16k-char LLM prompt-budget tax and
   the shared 60/min AI-tools limit on data that never enters a prompt. Paging, the count tool and the
   in-flight join are module-side workarounds. A browser-consumer data route separate from the
   assistant-tool route needs its own spec.
2. `MAX_TICKS = 60` caps a watched run at 6 minutes. On a large board that can expire before scoring
   finishes; it reports the honest `still-running` rather than a false finish.
3. The saved-résumé record still has no filename field.
4. Crawl duration (~197 s) is host AI latency, not a job-search defect.
5. Merging `origin/main` into `feat/job-search` would clear the two finance role failures but carries
   migration-number-collision risk — Ben's call.

## Environment notes

Dev API 3097, web 5197. Redeploy is five steps and skipping any one of them leaves the old bundle
live: build (`pnpm build:external:job-search`) → restage → **restart the API** → **re-enable** →
restart the worker. Scratchpad helpers (`install-module-package.py`, `run-store-int.sh`,
`run-gate-js.sh`, `prove-paging.mjs`) are scratchpad-only and never committed.
