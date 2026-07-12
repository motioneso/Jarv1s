# Relay r3 — JS-01 package contract (#930) — plan COMMITTED, approval PENDING

**You are the Fable successor** (`claude-fable-5`; relay successors stay Fable — scoped exception
to the Sonnet rule, per coordinator handoff). Worktree
`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-01-package-contract`,
branch `feat/js-01-package-contract` (off origin/main @ `2f4a0fe3`). Coordinator label
`Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` (verify EXACTLY ONE pane,
resolve fresh — never a cached pane number).

Resume via `coordinated-build` at step 2 (BUILD). Coordinator handoff doc (short, read it):
`docs/coordination/2026-07-11-js-01-package-contract-handoff.md` (untracked — NEVER commit it).

## State (what is DONE — do not redo)

- Spec verified against branch: DONE (r1). Both spec-vs-ABI forks RESOLVED by coordinator ruling
  2026-07-10: (1) plain kebab id `job-search` (dotted ids banned by merged `MODULE_ID_RE`; do NOT
  edit validate.ts — banned platform edit); (2) `permissionId == tool name` for JS-01,
  consolidated permission model deferred to JS-06. Both recorded in the plan's **Spec Deltas**
  section.
- **Plan WRITTEN and COMMITTED: `bedd8a44`** →
  `docs/superpowers/plans/2026-07-10-js-01-package-contract.md` (1378 lines, 7 TDD tasks with
  COMPLETE code — manifest, sources, build script, unit + fail-closed + integration tests, gate).
- **Approval message SENT to Coordinator** by r2 at relay time (plan path + commit + relay
  notice). Approval may already be waiting in your pane when you boot, or arrive shortly.

## Your next steps

1. `[ -d node_modules ] || pnpm install` (worktree already has node_modules — skip).
2. **Wait for coordinator approval before ANY code.** If no approval message visible/received,
   message Coordinator (caveman-terse): "js-01 r3 successor up. Plan `bedd8a44` awaiting your
   approve/flag." Then wait. Do NOT build unapproved.
3. On approval: TDD build **Tasks 1–7 reading the plan ONE TASK AT A TIME** (it has complete
   code; a full read wastes half your budget — read by section only). Commit green per task,
   `git add` explicit paths only.
4. Do NOT re-read platform files or the specs — plan is self-contained and grounded @ `2f4a0fe3`.
   Exception: if a Task 5 fail-closed test FAILS, that pins merged platform behavior — STOP and
   escalate to Coordinator (platform edits are banned).
5. Finish with `coordinated-wrap-up` (pre-push trio + fresh rebase; PR title in plan Task 7;
   report to Coordinator; no merge/board). Flag at wrap-up if `apps/web/src/external-modules/loader.ts`
   was touched (#916 collision — plan does NOT touch it).

## Bans still live (unchanged)

Explicit-path `git add` only — never `-A`/`.` or repo-wide `pnpm format` (shared tree). Never
touch `docs/coordination/` (coordinator-only). No board/milestone/merge. No platform-internal
edits (everything lands under `external-modules/job-search/`, `scripts/build-external-module.ts`,
`tests/`, `.dockerignore`, root `package.json` scripts). No migration (flag if that changes). No
secrets anywhere. Prettier-format any doc you commit BEFORE committing (run `--write` twice, then
`--check`). Caveman-terse comms to Coordinator; conventional commits/PR. Relay on 70% meter —
successor stays Fable (`--model claude-fable-5`).
