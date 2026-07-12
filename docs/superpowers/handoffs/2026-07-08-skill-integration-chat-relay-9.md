# Relay 9 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, don't
re-request — it's still current, re-verified this relay by full read).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve fresh via `herdr pane list` — do not trust any pane
id/session id printed here beyond this line). As of relay-9: pane `w1:pBB`, session
`7dbdd81d-fe53-43ba-aac2-1a9bb989efc1`. Already notified of this relay AND of the open Task 5/6
question below — check for its reply first.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status: Task 4 done, rebase-recovery done, HEAD `c53f7ab4`, pushed

Tasks 1–4 are fully committed and pushed (`c53f7ab4`). Do not re-touch:
- Task 4 (Skills settings pane) is complete: `settings-skills-pane.tsx` built + wired into
  `settings-page.tsx` (`"skills"` section, `Command` icon — not `Sparkles`, that was a banned-icon
  fix in `c53f7ab4`), TDD test green, verify gate green at commit time.
- A mid-branch rebase onto `origin/main` got the git *tooling* stuck (`rebase --continue` refused
  to proceed despite a genuinely clean index — root cause never identified). Recovered via
  `rebase --quit` + manual `cherry-pick` of the remaining todo commits in order, then
  `git checkout -B 760-skill-integration-chat` to reattach the branch. Verified:
  `git merge-base --is-ancestor origin/main HEAD` → true. Pre-push trio
  (`format:check && lint && typecheck`) green, pushed with `--force-with-lease`. This whole
  incident is resolved and needs no further action — mentioned only so you don't re-diagnose it if
  you see it in `git reflog`. (Saved to agentmemory as a "bug"-type lesson, project `jarv1s`, if you
  want the full diagnostic trail.)
- `packages/chat/sql/0149_chat_skills.sql` is the correct, final migration filename (renamed from
  the stale `0147_chat_skills.sql` per the Coordinator's earlier "GO with 0149" ruling, to resolve a
  real collision with merged PR #870's migrations). `manifest.ts` and `foundation.test.ts` both
  reference `0149` correctly on this branch tip. Don't revisit this.
- `scripts/check-file-size.ts` carries the `packages/db/src/types.ts` exemption — intact post-rebase.

## OPEN QUESTION — escalated to Coordinator, not yet answered as of this relay

Re-read `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` in full this relay
(don't rely on a prior summary of it) to check an earlier Coordinator instruction ("Continue to
Task7 after") against branch reality. Confirmed by direct grep, not assumption:

- **Task 5 — Slash autocomplete + invocation is fully unbuilt.** `apps/web/src/chat/skill-autocomplete.tsx`
  does not exist. `chat-drawer.tsx` and `apps/web/src/today/evening-mode.tsx` have zero "skill"
  references. No commit on the branch touches any of these three files.
- **Task 6 — Gateway boundary regression tests are fully unbuilt.** No test file asserts: (a) a
  skill body instructing a destructive-risk tool call still produces a pending `action_requests`
  row for confirm-gated users; (b) yolo-mode users get identical inherited-posture execution as
  ordinary chat when triggered via a skill; (c) persona file bytes are byte-identical before/after
  a skill invocation.
- The plan's own Goal statement names slash autocomplete and invocation as core, non-optional
  scope: *"...per-skill enable toggle, `/` slash autocomplete in chat inputs (including evening
  interview), and invocation that injects the skill body into that single turn."*
- Task 7's Self-Review checklist (persona-file-touch check, non-deliberate promotion check) can't
  be answered truthfully without Task 5/6 existing.

**The "Continue to Task7 after" instruction was very likely scoped narrowly to the file-size-gate
question in flight at the time, not a deliberate decision to descope Tasks 5/6.** Per
`coordinated-build`'s explicit rule against silently absorbing or skipping scoped plan work, this
was escalated to the Coordinator rather than decided unilaterally. **If the Coordinator has since
replied (check pane `Coordinator` output / your own inbox first), follow that answer and delete
this section from the next relay doc.** If no reply yet, re-send the same question before doing
anything else — do not guess either direction (don't silently build 5/6, and don't silently
wrap up without them).

## If told to proceed with Tasks 5/6, build in this order (from the plan doc — re-read it first,
don't work from this summary alone)

**Task 5 — Slash autocomplete + invocation** (client-side only, no `packages/chat` route changes):
- New `apps/web/src/chat/skill-autocomplete.tsx`: popover triggered on `/` in a chat input, lists
  enabled skills for the active user (reuse `listChatSkills` from `apps/web/src/api/client.ts`,
  already built in Task 4), filter-as-you-type on name.
- Wire into `apps/web/src/chat/chat-drawer.tsx` composer and `apps/web/src/today/evening-mode.tsx`
  interview input.
- Invocation mechanism: selecting a skill prepends/injects that skill's body text into the single
  turn being submitted — client-side string composition only. Confirm (read the routes/turn
  handler in `packages/chat/src` first) that this does NOT touch the persona file and does NOT
  require any gateway/backend change — the plan's intent is turn-scoped injection, not persistent
  state.

**Task 6 — Gateway boundary regression tests** (integration tests only, no gateway code expected
to change):
- Check the `action_requests` INSERT policy trap first — see agentmemory `test-traps` memory
  (`memory_smart_search "jarv1s integration test trap"`) before writing assertions.
- Three required assertions (see Open Question section above for exact wording) — confirm-gated
  pending row, yolo-mode inherited posture, persona-file byte-identity pre/post invocation.

**Task 7** — after 5/6 (or an explicit Coordinator-approved descope): acceptance sweep vs spec,
`pnpm verify:foundation` (real exit code, never piped through `tail`) + full `pnpm test:integration`,
plan's own Self-Review checklist.

## Close out

`coordinated-wrap-up` when Exit Criteria are genuinely met — PR + report to Coordinator only, never
merge/board/close. Flag `security` tier for Opus adversarial QA + Ben sign-off.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio (`format:check && lint && typecheck` + fetch/rebase `origin/main`) before every push.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
- Identify Herdr panes by **label + `agent_session.value`**, never a bare `w…-N` pane id from a
  doc — pane numbers reflow. Re-resolve via `herdr pane list` at read time.
- This relay's predecessor was `Build-760f` (pane `w1:pBE`, session
  `2f634709-a3a5-4850-ba62-18221534941d`) — same lineage as `Build-760e` before it. No collision.
