# Build Handoff - rfa-721-chat-priority-context-ranking

**Spec:** `docs/superpowers/specs/2026-07-04-chat-priority-context-ranking.md`
**Issue:** #721
**Tier:** `sensitive`
**Branch:** `rfa-721-chat-priority-context-ranking`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-721-chat-priority-context-ranking`
**Coordinator:** label `Coordinator`, Codex session `019f2c81-005f-73c3-80bc-fd6d568820f7`

## Mission

Wire the existing unified priority model into live chat context ranking where chat already has
candidates. Do not add new source reads or a second ranking path.

## Collision Notes

- #729 is active on branch `feat/729-live-first-source-context` in
  `~/Jarv1s-wt/729-live-first-source-context`.
- #721 is mostly disjoint from #729. Expected soft overlap: `packages/chat/src/routes.ts`,
  `packages/briefings/src/compose.ts`, and `packages/briefings/src/signals.ts`.
- Before wrap-up/QA, rebase after #729 lands and resolve any soft overlap in the owning #721 branch.
- Do not touch Email settings, `packages/email`, or shared Email/source behavior without coordinator
  approval.

## Guardrails

- Follow the `coordinated-build` skill.
- Plan first; wait for coordinator approval before implementation.
- Do not edit `docs/coordination/`.
- Do not run repo-wide `pnpm format`.
- Do not use `git add -A`, `git add .`, broad checkout, reset, or stash.
- Stage exact files only.
- Keep pg-boss payloads metadata-only, preserve DataContextDb/VaultContext boundaries, and never log
  or persist source bodies, tool payloads, secrets, tokens, or connector metadata.

## Expected Verification

- Focused tests proving priority settings affect chat context ordering.
- Focused tests for muted-source behavior and any UI copy/control narrowing.
- Relevant existing chat/priority/briefings tests.
- `pnpm verify:foundation` before PR closeout unless coordinator explicitly narrows the gate.

