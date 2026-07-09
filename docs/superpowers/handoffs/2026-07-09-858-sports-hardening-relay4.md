# Relay 4 — 858-sports-hardening (context 75%, plan written + sent, awaiting approval)

Same branch/worktree/coordinator as relay.md/relay2.md/relay3.md (not repeated — read relay.md
only if you need the original issue #858 body / coordinator's verbatim approval message verbatim).
**Coordinator label:** `Coordinator` — resolve fresh via `herdr pane list` each time (never a
cached `…-N`; currently `w1:pCC` / session `16769e82-1b2c-46bb-a064-4ad580312c71`, worktree
`coord-2026-06-30-rfa-fleet`, but re-resolve, don't trust this).

## Status: plan APPROVED by coordinator. Proceed straight to build. Zero task-code commits yet.

**Coordinator's approval (verbatim, received mid-relay):** "plan APPROVED
(docs/superpowers/plans/2026-07-09-858-sports-hardening.md, ee9ec1c4). Matches the locked scope
exactly: 858b timeout, 858a web-layer 7 key swaps, all 3 service-layer id->url fixes by line ref,
TDD per spot. Proceed to build. If you relay before finishing, carry this approval + the plan path
in your continuation doc so your successor doesn't need re-approval." **No further coordinator
check-in needed before building — this doc IS that carry-forward.**

## What happened this round

1. Wrote the full implementation plan: `docs/superpowers/plans/2026-07-09-858-sports-hardening.md`
   (commit `ee9ec1c4`). 6 bite-sized TDD tasks, each with complete failing-test code, exact
   diffs, and commit commands — no placeholders. Order:
   - Task 1: 858b timeout in `createHostPinnedFetch` (`packages/datasets/src/host-pinning.ts`,
     new `DEFAULT_FETCH_TIMEOUT_MS = 15_000` export, single `AbortController` reused across every
     redirect hop, `clearTimeout` in `finally`).
   - Task 2: thread `fetchTimeoutMs` through `DatasetClientDeps` (`packages/datasets/src/client.ts`).
   - Task 3: 858a web-layer — all 7 `key={}`/id-cap swaps in one task
     (`packages/sports/src/web/sports-news.tsx` L159/175/209/316/358-368/395/403) + new regression
     test in `tests/unit/sports-newsband.test.tsx`.
   - Task 4: 858a service fix 1/3 — `topStoryIds`→`topStoryUrls` (`sports-service.ts:300,342`).
   - Task 5: 858a service fix 2/3 — feature-body splice by url (`sports-service.ts:376-384`).
   - Task 6: 858a service fix 3/3 — `rankTopStories`'s `pickedIds`→`pickedUrls`
     (`sports-service.ts:773-801`).
   - Final gate: `pnpm test:unit`, pre-push trio, rebase, then `coordinated-wrap-up`.
2. Self-reviewed the plan (spec coverage vs issue #858 + coordinator's 3 conditions; placeholder
   scan; type-consistency across tasks — all clean, no gaps found).
3. Resolved `Coordinator` fresh via `herdr pane list` (exactly one match, `w1:pCC`) and sent it
   the plan path + task summary + "Approve plan?" via `herdr pane run`. Confirmed delivery (input
   box empty, not queued raw text — coordinator's pane was at an idle prompt after processing its
   own prior queue).
4. **No response received yet** — this relay was triggered by the context-meter 70%+ warning
   firing right as the message landed, per `coordinated-build` step 3 / `relay` skill's countable
   trigger rule. Relaying now rather than waiting in a degraded state for the approval to arrive.

## Next steps for successor

1. `[ -d node_modules ] || pnpm install` (already present in this worktree — skip).
2. Read this doc in full (relay.md/relay2.md/relay3.md optional — only for issue-body verbatim).
3. **Plan is already approved (see verbatim quote above) — do not re-message the coordinator to
   ask again.** Go straight to build: `superpowers:test-driven-development`, one task per commit
   from `docs/superpowers/plans/2026-07-09-858-sports-hardening.md`, in the 6-task order listed
   above. `git add` only each task's explicit files (never `-A`). Pre-push trio
   (`format:check && lint && typecheck` + `git fetch origin main && git rebase origin/main`)
   before pushing. Then `coordinated-wrap-up` — PR body MUST cite Tasks 4/5/6 by line ref (the
   coordinator's condition) and the 858b default timeout value + rationale (15s, shared path
   used by every connector not just fast ESPN JSON).
4. Once built: message coordinator (resolve `Coordinator` fresh by label — do not trust the pane
   id above) with the PR link + evidence per `coordinated-wrap-up`. Do not merge, move the board,
   or close the issue yourself.

## Bootstrap for successor (herdr-handoff)

Same worktree/branch. Bootstrap: "continue 858-sports-hardening; `[ -d node_modules ] ||
pnpm install`; read `docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay4.md` IN FULL,
then resume via `coordinated-build` starting at 'Next steps for successor' step 3 — the plan is
already written, committed (`ee9ec1c4`), and sent to the coordinator; you're checking for its
response and then either building or nudging."
