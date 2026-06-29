# Build Handoff — wellness-fixes

**Specs (approved):**
- `docs/superpowers/specs/2026-06-25-wellness-ai-consent.md` (issue #505)
- `docs/superpowers/specs/2026-06-25-wellness-selective-export.md` (issue #509)

**GitHub issues:** #505, #509 — fix both in one PR.
**Risk tier:** `sensitive` (AI access to private health data with consent gates)
**Worktree:** ~/Jarv1s/.claude/worktrees/wellness-fixes **Branch:** wellness-fixes (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Coordinator session id:** `f8a5b8f7-a287-4665-b480-0f46dc52bed2`
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately.

## What to build

Two wellness module fixes found during live release testing.

### #505 — Jarvis cannot read check-in free-text notes

Jarvis can access structured check-in fields but not the free-text note, which is often the most useful part of the check-in.

**Required:**
- When wellness consent permits Jarvis access, include the free-text check-in note in the AI tool response alongside existing structured fields.
- The consent gate must remain enforced — only expose the note when the existing consent check already passes.
- Read `docs/superpowers/specs/2026-06-25-wellness-ai-consent.md` to understand the consent model before touching any data access path.

### #509 — Wellness export: modal styling broken + action does nothing

The wellness export flow has two issues:

1. **Modal styling** — checkbox treatment looks much larger and visually different from the rest of the product. Align it to the existing design system (`jds-*` primitives, existing settings/modal patterns).
2. **Export action broken** — clicking the export button does nothing. Fix it so the export actually runs and provides visible progress/ready states.

**Required:**
- Fix the modal to follow the existing design language (same checkbox treatment as other settings modals).
- Fix the export action so it starts the export flow, shows progress, and signals completion.
- Read `docs/superpowers/specs/2026-06-25-wellness-selective-export.md` to understand the intended export behavior.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read both specs above IN FULL.
3. Grep the relevant files on YOUR branch to verify the gaps are still real before planning.
4. Invoke `coordinated-build`, write the plan, escalate to Coordinator for approval, then build.

## Your compact

- Both fixes in one PR titled `fix(wellness): expose check-in free-text note to Jarvis, fix export modal and action (#505 #509)`.
- Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files; record exit codes in wrap-up.
- Work only in this worktree. `git add` only your changed files.
- Never touch the project board, milestones, or merge.
- Escalate to `Coordinator` on: plan ready, blocker, design fork outside spec, done.

## Collision notes

- No other agent touches the wellness module this run — you own it exclusively.
- No migrations needed.
- The consent gate is existing code — do not weaken or bypass it. If you find the consent check ambiguous for the free-text field, escalate to Coordinator rather than guessing.
