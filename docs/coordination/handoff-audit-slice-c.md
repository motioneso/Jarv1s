# Build Handoff — audit-slice-c

**Spec (approved):** docs/superpowers/specs/2026-06-11-audit-slice-c-vault-containment.md
**Plan (approved):** docs/superpowers/plans/2026-06-11-audit-slice-c-vault-containment.md
**GitHub issues:** #129, #130
**Risk tier:** `security` (vault path containment, filesystem I/O escape vectors → cross-model QA + Ben merge sign-off required; build to that bar)
**Worktree:** ~/Jarv1s/.claude/worktrees/audit-slice-c **Branch:** audit-slice-c (off origin/main @ d186e01)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context (relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute **Build skill path** above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if already present (worktrees share pnpm store).
3. Read the **spec** and **plan** above IN FULL before writing a single line of code.
4. **The plan is already approved.** Skip the plan-approval escalation step — go straight to TDD implementation following the plan task-by-task.
5. Run `pnpm format:check && pnpm lint && pnpm check:file-size && pnpm typecheck` + fresh rebase before every push → close out with **`coordinated-wrap-up`** (PR + report to Coordinator).

## Your compact

- Work **only** in this worktree (`~/Jarv1s/.claude/worktrees/audit-slice-c`). Never touch the shared main tree.
- Commit green per task; `git add` only that task's files. Commit co-author: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Plan is pre-approved — do not escalate for plan approval.** Escalate to `Coordinator` only for: a blocker, a design fork outside the spec, or done (PR open).
- **Never touch** the project board, milestones, or merge — those are the Coordinator's.
- Self-monitor context on countable events. Relay if you hit ~80–100k tokens or see a compaction summary.
- Honor all CLAUDE.md Hard Invariants. No secrets in any doc/log/prompt.
- Caveman mode for all Coordinator escalations (terse, no filler, full technical accuracy).
- Run `pnpm format` after all code changes and before final push (CI enforces prettier).

## What you're building

Two code-only security fixes in `packages/vault/src/` — no migrations, no schema changes:

**#129 — actorUserId guard in withVaultContext**

- File: `packages/vault/src/vault-context.ts`
- Add `VaultContextError` class (export it from `src/index.ts` too)
- Add guard at the start of `withVaultContext` body: throw `VaultContextError` if `actorUserId` is empty or whitespace-only
- The attack: empty string → `join(vaultsBaseDir, "")` = vaultsBaseDir itself → caller gets access to all users' vaults

**#130 — realpath symlink-escape check in vault-ops.ts**

- File: `packages/vault/src/vault-ops.ts`
- Add `realpath` to the `node:fs/promises` import
- Import `VaultPathError` from `./vault-path.js` (currently not imported there)
- Add `assertNoSymlinkEscape(fullPath, vaultRoot)` async helper (see plan Task 4 for full code)
- Call `await assertNoSymlinkEscape(fullPath, ctx.vaultRoot)` after EVERY `resolveVaultPath` call in all 7 vault-ops functions
- Pre-write paths: if `realpath(fullPath)` throws ENOENT, fall back to `realpath(dirname(fullPath))`
- The attack: symlink inside vault → resolveVaultPath passes (lexical check) → read/write through symlink escapes

**Tests** (5 new, all in `tests/integration/vault.test.ts`):

- 3 × #129: empty actorUserId throws, whitespace throws, valid userId succeeds
- 2 × #130: symlink-to-outside-file blocks readVaultFile, symlink-dir blocks writeVaultFile

## Collision notes

- Slice C is **parallel-safe** with the migration spine (A/B/D/G/H). It touches `packages/vault/` only — no overlap with any other active slice.
- No other agent is on this worktree or branch.
- Slice A is in flight on `audit-slice-a` (migrations 0053/0054). If Slice A merges before this PR is ready to push, rebase on the new `origin/main` — there are no conflicts (different modules).
