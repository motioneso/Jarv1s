# Build Handoff — 918-open-module-system-slice2 (Build phase)

**Spec / plan (approved):** `docs/superpowers/plans/2026-07-10-open-module-system-slice2.md`
(commit `bc035fe1`). Plan step is DONE — Ben already approved it. Skip `writing-plans`; start
straight at the **Build** step of `coordinated-build`.
**GitHub issue:** #918 (Part of the Open Module System epic; #919 remains queued behind this —
landing the plan did not unblock it, #919 needs this build merged first)
**Risk tier:** `security` (this PR gets adversarial Opus QA + Ben merge sign-off before merge —
build to that bar)
**Worktree:** `.claude/worktrees/918-implementation-plan` **Branch:**
`plan/918-open-module-system-slice2` — **continue in this exact existing worktree/branch, do NOT
create a new one.**
**Build skill path (absolute):** `.claude/skills/coordinated-build/SKILL.md` in the main repo
tree (follow this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `4d68fcc5-bc2c-44cd-ae0d-a2e305f94069` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the approved plan above IN FULL.
3. Invoke **`coordinated-build`**, entering at the **Build** step (plan/coordinator-approval steps
   are already satisfied) → TDD build → **`coordinated-wrap-up`** (PR + report). Escalation rules,
   gate commands, and comms are defined there — this doc does not restate them.
4. **Migration numbers:** current global head is **0152**. This plan provisionally claims
   0153/0154 (already fixed in the plan's migration count) — proceed on that basis, but the
   coordinator confirms final landing order at merge time (see collision notes below).

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator — verbatim from manifest, Opus-verified)

Building in parallel with #914 (`build/914-module-data-plane`) — Opus collision check confirmed
**no serialization needed**, both build concurrently. Full verdict:

- #914's new per-module migration ledger does **NOT** replace `foundation.test.ts`'s whole-list
  `toEqual` assertion — #914's own spec explicitly preserves it unchanged for core/built-in
  migrations; the per-module ledger is a separate, additive mechanism only for *external*
  module-owned tables.
- Your 2 new migrations (`packages/settings/sql/`) are platform/built-in, go through the existing
  global `migrate` path untouched by #914's new external-module install machinery. No RLS/table-
  install overlap — your tables are platform-owned with hand-written RLS; #914's new
  generated-RLS/role machinery is for external-module-owned tables only, a disjoint surface.
- **Mechanical-only conflicts to resolve at merge time** (coordinator will handle at merge, but be
  aware you're sharing these files with #914's build agent):
  `tests/integration/foundation.test.ts` (both PRs append rows to the same `toEqual` block),
  `packages/db/src/types.ts` (both add table interfaces + `JarvisDatabase` registrations), global
  migration numbers (you provisionally hold 0153/0154; #914 hasn't planned its numbers yet and
  will take next-free after checking the live head at its own plan step — you're expected to land
  FIRST; if landing order somehow flips, the coordinator will handle the rebase), and possibly
  `scripts/audit-release-hardening.ts` (`protectedTables` coverage, minor).
- Do not hand-resolve these against #914's branch yourself — the coordinator confirms final
  landing order and handles integration re-verification at merge.
