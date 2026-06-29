# Build Handoff — ui-polish

**Spec:** Bug fixes / style alignment only — no spec required (no new feature or module).

**GitHub issues:** #480, #512 — fix both in one PR.
**Risk tier:** `routine` (isolated UI-layer changes, no schema/auth/secret surface)
**Worktree:** ~/Jarv1s/.claude/worktrees/ui-polish **Branch:** ui-polish (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Coordinator session id:** `f8a5b8f7-a287-4665-b480-0f46dc52bed2`
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately.

## What to build

Two UI polish fixes found during live release testing.

### #480 — Today page: remove persistent medication nudge

The Today page shows a persistent medication nudge card when medication has not been logged. This nudge is noisy and should be removed.

**Required:**
- Remove the persistent medication nudge card from the Today page that appears solely because no medication has been logged for the day.
- Medication logging affordance itself must stay wherever it exists today — only the persistent nudge is removed.
- A day with no medication log must not produce the persistent nudge. Other Today-page cards and reminders are unchanged.

### #512 — Chat approve/reject buttons: spacing and instructional text

The approve/reject buttons in chat have two issues (screenshot in the issue):
1. No spacing between the buttons — they run together visually.
2. The instructional text above the buttons looks like system/debug text, not user-friendly copy.

**Required:**
- Add appropriate spacing between the approve and reject buttons.
- Rework or remove the instructional text above. If a tip/hint is kept, it should use a collapse/disclosure pattern (per Ben's comment on the issue) rather than the current always-visible treatment. Follow existing `jds-*` design system patterns.
- Do not change the behavior of the approve/reject flow itself — only styling and copy.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Find the Today page medication nudge component and the chat approve/reject component by searching the `apps/web/src/` tree.
3. Invoke `coordinated-build`, write the plan, escalate to Coordinator for approval, then build.

## Your compact

- Both fixes in one PR titled `fix(ui): remove Today medication nudge, fix chat approve/reject button spacing and text (#480 #512)`.
- Run `pnpm format:check && pnpm lint && pnpm typecheck`; record exit codes in wrap-up.
- Check `apps/web/src/styles/tokens.css` for any color values — never introduce raw CSS colors outside that file.
- Work only in this worktree. `git add` only your changed files.
- Never touch the project board, milestones, or merge.
- Escalate to `Coordinator` on: plan ready, blocker, design fork outside spec, done.

## Collision notes

- No other agent touches `apps/web/` this run — you own it exclusively.
- No migrations needed.
