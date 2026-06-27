# Build Handoff — rfa-533-memory-dashboard

**Spec (approved):** docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md
**GitHub issue:** #533
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-533-memory-dashboard **Branch:** rfa-533-memory-dashboard (off origin/main d06d6842)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow; re-resolve the live pane by label each time.)
**Coordinator session id:** `6502bd00-7c52-4e73-9ed5-d95a42f54dd8` (immutable authority — confirm this session is still live before relying on it.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (relay immediately on compaction).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute Build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if node_modules exists (worktrees share pnpm store).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** #532 (confidence-aware-memory-records) just merged at d06d6842 — confirm which fields/APIs from #532 your spec references are now present. Escalate any spec drift to the coordinator before proceeding.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate to coordinator for approval → on approval, build TDD/green → run pre-push trio before every push → close out with **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files locally; record exit codes in wrap-up report. Use `JARVIS_PGDATABASE=jarvis_build_rfa_533_memory_dashboard` for integration tests.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files. Co-Authored-By: Claude.
- Plan approval comes from the **coordinator**, not a human. Do not write code before approval.
- **Escalate to coordinator** the moment you hit: a blocker, plan ready for approval, design fork outside this spec, done. Security tier = escalate security questions immediately with `[SECURITY]` tag.
- **Never touch** the project board, milestones, merges, or `docs/coordination/`.
- **Self-monitor your context** on countable events. At ~80–100k tokens or on compaction summary: use the `relay` skill.
- Honor every CLAUDE.md Hard Invariants. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator.

## Security requirements (tier = security)

- This PR gets cross-model (Opus) adversarial QA before merge. Build to that bar.
- RLS: all memory record access must use owner-scoped `DataContextDb`; no admin bypass.
- User edits (label/tag/delete on their own memory records) must be gated by the owner FK — row belongs to actor, or reject.
- No `isSensitive` flag trusted from client payload; determine sensitivity server-side.
- Export and delete: memory records edited/deleted via dashboard must propagate through the same export/delete lifecycle as records created by the distillation pipeline.
- No raw SQL on memory schema; use the public MemoryRepository APIs added in #528.

## Collision notes (from the coordinator)

- **#532 (confidence-aware-memory-records) just merged** at d06d6842 as your base. The memory_records table now has `confidence_score`, `confirmed_at`, `needs_review`, `superseded_by` columns. Build ON TOP of this; do not re-add or modify these columns.
- **#527 (usefulness-feedback) is mid-build** in a parallel lane — both touch export/delete/RLS. Scope your export/delete additions to memory_records dashboard operations only; do not modify the usefulness_feedback table.
- **#525 (cross-tool-reasoning) launching in parallel** — touches chat runTurn / gateway layer; no memory schema changes there. No conflict expected.
- **Migration slot:** If this spec requires a schema migration, do NOT assume a migration number. Escalate to the coordinator before writing the SQL file; migration 0120 (#527, unmerged) and 0121 (#532, merged) are claimed. Next available is 0122, but assignment happens at coordinator-controlled merge order.
- **Memory spine dependency met:** #528, #529, #530, #532 all merged into main. Build on the stable public APIs they expose.
- No `git add -A`; stage only your own changed paths.
