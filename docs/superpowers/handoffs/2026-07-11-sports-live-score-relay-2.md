# sports-live-score (#963) — relay handoff 2

Relaying at 71% context. Plan doc is DONE. Approval ping was SENT but landing is UNCONFIRMED.
**No code has been written yet** — do not start coding until approval is confirmed.

## State

- Plan: `docs/superpowers/plans/2026-07-11-sports-live-score-strip.md` — complete, 2 TDD tasks
  (Task 1 `FeaturedTeamCard`/sports, Task 2 `TickerTeam`/today), full code/CSS/test diffs
  written out, includes a self-identified addition beyond the original relay
  (`docs/superpowers/handoffs/2026-07-11-sports-live-score-relay.md`, still valid background):
  `hasNextBar` also needs `|| card.status === "live"` (2-story cap for live cards, was 3).
- Sent `herdr pane run w1:pE6 "..."` (Coordinator) requesting approval, reply-to label
  `sports-live-score-2`.
- **Uncertain outcome:** two subsequent bounded reads (`--source recent --lines 12`) of that
  pane showed unrelated, rapidly-changing in-progress text ("One more thing to add...", "I
  resumed the codex agent,") and a different cwd/branch in the status line each time
  (`news-slice2 (feat/news-slice2*)` vs the pane's registered
  `coord-2026-06-30-rfa-fleet` cwd). This strongly suggests **Ben is live at that terminal**
  right now, typing directly. My message was never visible as delivered/queued in either read.
  I stopped sending further keystrokes to avoid corrupting his live input.

## Next steps for successor

1. **Do not resend blindly.** Re-resolve the Coordinator pane fresh via `herdr pane list`
   (label `Coordinator` — pane_id is ephemeral, do not reuse `w1:pE6`). Check `agent_status`
   and whether the buffer looks like a stable idle prompt vs. live human typing before touching
   it.
2. If it looks safe (stable idle, no fresh human text), do ONE bounded read
   (`--source recent --lines 12`) to check whether the original approval message is sitting
   answered/queued. If genuinely never delivered, resend once via `herdr pane run` — don't
   double-send if there's any ambiguity; ask the human (this session's actual user, reachable
   in this same chat) instead.
3. Once approval is confirmed (explicit ack from Coordinator, or the human here says go): build
   Task 1 then Task 2 from the plan doc, TDD, green commits, explicit `git add <path>` only.
4. Then: visual check both themes → pre-push trio + rebase → `coordinated-wrap-up` (push, PR
   "Closes #963", report to coordinator, don't merge/close/move board).

## Bans (unchanged)

Work only in this worktree/branch (`feat/sports-live-score-strip`). `git add` explicit paths
only. Never touch `docs/coordination/`. Never merge. Terse/caveman only to the coordinator;
commit messages/PR bodies stay conventional.
