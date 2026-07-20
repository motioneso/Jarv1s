# Lane E #1198 onboarding UI — Task 4 relay (h)

Same worktree/branch (`feat/1198-onboarding-ui`), don't create a new one. Supervisor: pane label
`Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id from any
doc. No push/PR without explicit supervisor grant. DB-less only: no `verify:foundation`, no DB.

Relay (g) (`...-relay-g.md`) is superseded. Older relays not needed.

## State

HEAD `679f0a62`, clean tree except untracked stale doc (leave alone, not ours):
`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md`.

Commits this run (on top of prior `54da3e34`/`8e6b888a`/`ec1397b8`, kept as-is per supervisor
ruling):
- `f091e0b6` **real bug fix**: `index.tsx` `advanceOnDurableEvent` keyed the pending-confirmation
  set by `record.messageId` on `action_request` but checked `record.actionRequestId` on
  `action_result`. Confirmed via `packages/ai/src/gateway/gateway.ts` +
  `packages/chat/src/gateway-notifier.ts` that real server records only ever populate
  `actionRequestId` on these record kinds — `messageId` was always undefined, so guided
  onboarding's re-bootstrap/phase-advance **never fired in production** after any real
  approve/deny/execute. Now keyed consistently on `actionRequestId`. Also fixes `controls.tsx`
  `SourcesControl` reading `event.currentTarget` inside a deferred `setState` updater (React nulls
  it by dispatch-end) — value now captured synchronously.
- `254c6e7e` fixed 2 of the 4 remaining RED e2e tests, both wrong-premise (not fixture/copy
  mismatches as the supervisor's earlier ruling assumed): denial text only ever renders inside the
  chat drawer's collapsed "Behind the scenes" `<details>` (`ActivityPeek` in
  `apps/web/src/chat/message-row.tsx`) — test now clicks it open first. Boards submit button
  requires **every checked** source to have a valid query, not just the one being filled — test
  now unchecks Lever/Ashby to isolate Greenhouse.
- `679f0a62` updated `tests/unit/job-search-web-onboarding.test.tsx` `advanceOnDurableEvent`
  fixtures (`messageId` → `actionRequestId` on `action_request` records) to match the real fix and
  real production record shape — these tests were unknowingly asserting the old buggy behavior.

**All 10/10 `js1198` e2e tests green.** Full 3-spec Playwright run (`js1198` + `js06-module-surface`
+ `assistant-surface`) **20/20 green**. Full 7-file unit vitest suite **145/145 green**.
`memory_save`d both real bugs (project `jarv1s`, type `bug`) already — don't re-save.

## Supervisor's original ruling — now substantially revised by real findings

Supervisor said (earlier segment): keep 3 existing commits as history, land the 4 RED fixes as
ONE final test commit, and assumed all 4 were test-side fixture/copy mismatches. That premise did
**not** hold — 2 of 4 were real app-code bugs (one is a live production defect: guided onboarding
gets stuck after any real action confirmation). Given the `8e6b888a` precedent (real bug fix kept
as its own commit), this run split real-bug-fix vs. test-only into separate commits (`f091e0b6` vs
`254c6e7e`/`679f0a62`) rather than folding everything into one commit. **Not yet confirmed by the
supervisor** — flag this in your escalation message, but don't block on a reply if everything else
is gate-green; this split follows established repo precedent.

## Next steps

1. Run the remaining Task 5 gate commands (verbatim), all must exit 0:
   ```bash
   pnpm check:design-tokens
   pnpm check:file-size
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```
   (`build:external:job-search`, the 7-file vitest, and the 3-spec Playwright command were already
   run clean this run — no need to re-run unless you touch more files.)
2. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list`, report gate-ready with the
   full commit list (`54da3e34` through `679f0a62`) + command evidence, flagging the commit-split
   deviation from the original ruling above. Or report any blocking gate error verbatim.
3. Wait for explicit supervisor grant before any push/PR — none given yet this run.

## Constraints (unchanged, repeat)

DB-less only (no `verify:foundation`, no DB). No push/PR without explicit supervisor grant. Stage
only your own files when committing (never `git add -A` on the shared worktree). Leave the
untracked stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` alone.
