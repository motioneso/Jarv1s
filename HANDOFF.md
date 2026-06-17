# Build Handoff — inferred-patterns-243

**Spec (approved):** docs/superpowers/specs/2026-06-15-inferred-patterns.md
**GitHub issue:** #243
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/inferred-patterns-243 **Branch:** inferred-patterns-243
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `0dadd466-352f-48c1-82ec-b859e045b149`
**Relay threshold:** ~80–100k tokens or compaction summary → relay immediately.
**JARVIS_PGDATABASE:** `jarvis_build_inferred243`

## Start

1. `[ -d node_modules ] || pnpm install`
2. `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm db:migrate` — bootstraps the fresh DB.
3. Read the spec at `docs/superpowers/specs/2026-06-15-inferred-patterns.md` IN FULL.
4. Write your plan → escalate to coordinator for approval via `herdr-pane-message` → on approval,
   build TDD/green → pre-push trio → fresh rebase before push → open PR via `coordinated-wrap-up`,
   report done to coordinator.

## Your compact (non-negotiable)

- Work ONLY in this worktree/branch. `git add` only this task's files.
  `Co-Authored-By: Claude <noreply@anthropic.com>` on all commits.
- Plan approval comes from the **coordinator** (label `Coordinator`), NOT Ben. No code before approval.
- Escalate to coordinator the moment you hit: plan ready, blocker, design fork, or done.
- **Never touch** `docs/coordination/`, the project board, or merge — coordinator owns those.
- **Never run `pnpm format` + broad `git add` / `git add -A`** — scope staging to your own files.
- **No touching `apps/web/src/onboarding/**`\*\* — an unrelated Codex session owns it.
- Caveman mode for all status/escalation messages.
- Honor all CLAUDE.md Hard Invariants.

## Collision notes

- **Migration number: do NOT pick a final number.** Use placeholder filename
  `0092_inferred_patterns_suppression.sql` in the appropriate module `sql/` dir. Coordinator
  assigns the real number at merge.
- **`apps/web/src/api/client.ts`** and **`packages/chat/src/routes.ts`** are collision targets with
  #241 and #247. Your PR may need a rebase keep-both at merge — coordinator handles it.
- **Suppression/corrections store shared with #244.** You land first in the memory-pane cluster.
  Build the suppression table here; keep the schema minimal and extensible so #244 (corrections-log)
  can add columns/rows to the same table. Name clearly (e.g. `chat_memory_suppressions`). Document
  the schema in the migration comment. #244 will NOT run until your PR merges.
- **`settings-memory-pane.tsx`** — the "Inferred patterns" section. #242 (memory-provenance) is
  already merged. Keep your changes scoped to the inferred section only.
- Owner-only RLS on the suppression table. Verify in integration tests.
- Extraction guard: the fact-extraction path in `packages/chat` must consult the suppression store
  by content-signature before creating a new `inferred` fact. Signature = normalized
  category+content hash (stable across re-inferences).

## Verification target

- Integration: confirm inferred fact → provenance `confirmed`, appears under remembered; reject →
  fact deleted + suppression row written; re-run extraction on same content → suppressed (not
  re-created); per-user isolation; non-owner can't confirm/reject.
- `JARVIS_PGDATABASE=jarvis_build_inferred243 pnpm verify:foundation` green before PR.
