# Build Handoff — #252 AI provider test and model detection

**Spec (approved):** `docs/superpowers/specs/2026-06-18-ai-provider-test-and-model-detect.md`
**GitHub issue:** #252
**Risk tier:** `security` (stored provider credentials, decrypted server-side validation, admin API)
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/phase2-252-ai-provider-test-model-detect`
**Branch:** `phase2-252-ai-provider-test-model-detect` off `origin/main`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019edf08-c4dc-7751-a2f3-73cbe67c0139`
**Relay threshold:** read your own pane context indicator; relay at ~2/3-3/4 consumed, after plan approval plus ~5-8 committed tasks, or immediately on compaction.

## Start

1. Confirm skills; if `coordinated-build` does not resolve, read the absolute skill path above.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the approved spec in full.
4. Use `coordinated-build`: write a plan, send it to `Coordinator` for approval, then wait.

## Compact

- Work only in this worktree and branch.
- Do not touch `docs/coordination/` after reading this handoff.
- Do not write code before coordinator plan approval.
- Stage only your own files.
- Preserve credential secrecy: never log, return, persist, or include provider credentials or raw provider errors in PR text.
- Before wrap-up, run the smallest focused tests plus `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`; full CI-equivalent gate is coordinator-owned after PR.

## Scope

Implement #252 only:

- `POST /api/ai/providers/:id/test`
- `POST /api/ai/providers/:id/discover-models`
- Admin UI wiring for provider-card Test and model discovery
- Manual model registration stays working

Out of scope:

- CLI re-auth flow
- Capability-routing persistence (#253)
- Non-admin provider metadata expansion
- Rebuilding credential editing

## Collision Notes

- #253 is adjacent but separate; do not persist capability routes here.
- #306 remains blocked on missing `JARVIS_IMAGE_TAG`; ignore deploy checkpoint work.
- Shared tree has foreign edits outside your worktree; do not use broad staging commands.
