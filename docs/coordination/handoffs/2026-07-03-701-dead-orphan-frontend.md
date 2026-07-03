# Build Handoff — 701 dead orphan frontend

**Spec (approved):** GitHub issue #701
**GitHub issue:** #701
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/701-dead-orphan-frontend` **Branch:** `coord/701-dead-orphan-frontend` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f25f9-9b63-76f3-9505-a015196d4a41`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

Issue #701 from `docs/audits/2026-07-02-dead-code-audit.md` added by commit `9cc00803`.

## Scope

Remove only these confirmed orphan files after re-confirming zero imports/usages on current `origin/main`:

- `apps/web/src/chat/memory-panel.tsx`
- `apps/web/src/ui/provisional-region.tsx`

Do not remove:

- `apps/web/src/styles.css`
- `apps/web/src/connectors/connect-google-panel.tsx` (already removed by #693)
- `apps/web/src/ui/time-bucket.tsx` (already removed by #693)

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm the two files have zero live imports/usages. If either premise drifted, escalate to `Coordinator` with a narrowed plan.
4. Submit a compact plan for coordinator approval before code.
5. Delete only confirmed orphan files and any now-empty tests/imports caused by those deletions.
6. Run focused web tests/lint/typecheck plus file-size/format checks; include exact commands and exits in wrap-up.

## Collision Notes

Wave 1 is parallel-safe with #702, #703, #707, and #708. Do not touch `docs/coordination/` from the build branch. Use explicit staging only.
