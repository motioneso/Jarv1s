# Build Handoff — 914-module-data-plane

**Spec (approved):** `docs/superpowers/specs/2026-07-09-module-data-plane.md` (approved, merged
via PR #920)
**GitHub issue:** #914 (Part of the Open Module System epic)
**Risk tier:** `security` (RLS + privileged install + secrets/credential scope + data
lifecycle/export/delete — this PR gets adversarial Opus QA + Ben merge sign-off before merge;
build to that bar)
**Worktree:** `.claude/worktrees/914-module-data-plane` **Branch:** `build/914-module-data-plane`
off `origin/main` (`4bc53694`) — already created, continue in this exact existing worktree/branch,
do NOT create a new one.
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
2. Read the spec above IN FULL.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual
   branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and comms are all
   defined there — this doc does not restate them.
4. **Migration numbers:** do NOT hardcode a number. Current global head is **0152**, and #918 (a
   parallel build) provisionally holds 0153/0154 and is expected to land first. At your own plan
   step, check the live head yourself and take the next-free number, expecting to land AFTER #918.
   If #918 merges first, rebase your `foundation.test.ts` + `types.ts` additions onto its landed
   state and re-run the FULL `test:integration` suite (never a focused suite) to catch any
   `toEqual` break in `foundation.test.ts`.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator — verbatim from manifest, Opus-verified)

Building in parallel with #918 (`plan/918-open-module-system-slice2`) — Opus collision check
confirmed **no serialization needed**, both build concurrently. Full verdict:

- Your new per-module migration ledger does **NOT** replace `foundation.test.ts`'s whole-list
  `toEqual` assertion — your spec explicitly preserves it unchanged for core/built-in migrations;
  your per-module ledger is a separate, additive mechanism only for *external* module-owned
  tables.
- #918's 2 new migrations (`packages/settings/sql/`) are platform/built-in, go through the
  existing global `migrate` path untouched by your new external-module install machinery. No
  RLS/table-install overlap — #918's tables are platform-owned with hand-written RLS; your new
  generated-RLS/role machinery is for external-module-owned tables only, a disjoint surface.
- **Mechanical-only conflicts to resolve at merge time** (coordinator will handle at merge, but be
  aware you're sharing these files with #918's build agent):
  `tests/integration/foundation.test.ts` (both PRs append rows to the same `toEqual` block),
  `packages/db/src/types.ts` (both add table interfaces + `JarvisDatabase` registrations), global
  migration numbers (see Start step 4 above), and possibly
  `scripts/audit-release-hardening.ts` (`protectedTables` coverage, minor).
- Do not hand-resolve these against #918's branch yourself — the coordinator confirms final
  landing order and handles integration re-verification at merge.
