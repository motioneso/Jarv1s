# Build Handoff - rfa-733-quiet-hours-settings-persistence

**Spec (approved):** docs/superpowers/specs/2026-07-04-quiet-hours-settings-persistence.md
**GitHub issue:** #733
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-733-quiet-hours-settings-persistence **Branch:** rfa-733-quiet-hours-settings-persistence off `origin/main@ec6b8569`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2d17-354b-7d40-a2e7-115384f1b579`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` only if `node_modules` is missing: `[ -d node_modules ] || pnpm install`.
3. Read the spec above IN FULL.
4. Verify the spec against the actual branch BEFORE planning. #732 just landed at `ec6b8569`; confirm
   Settings > General quiet-hours state still matches the spec and that no new owner/API already
   satisfies it.
5. Invoke `coordinated-build`: write the plan -> escalate it to the coordinator for approval -> on
   approval, build TDD/green -> run focused verification and the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) -> close out with `coordinated-wrap-up`.

## Compact Rules

- Work only in this worktree/branch. Do not touch `docs/coordination/`, project board, milestones,
  or merge state.
- Stage only your files; never use broad `git add -A`.
- No code before coordinator approval of your implementation plan.
- Honor CLAUDE.md hard invariants. This is sensitive-tier: owner-scoped settings only; no secrets,
  no RLS bypass, no private data in logs/job payloads.
- Preserve overnight quiet-hours windows such as `22:00` to `07:00`.
- Preserve existing non-urgent notification deferral semantics from #250.
- Escalate blockers, drift, plan-ready, relay, or done to `Coordinator` via Herdr. Resolve the
  coordinator by label each time; do not trust stale pane numbers.

## Collision Notes

- Builds after #732 / PR #752. Do not reintroduce Data sources ownership for Email/Calendar
  behaviors.
- Keep scope to quiet-hours settings persistence and existing notification deferral semantics.
- #735 and later settings-chain items are still held; do not pre-build module notification
  preferences or truthful chat settings.
