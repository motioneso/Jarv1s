# Build Handoff — #650 connector sync wedge

**Run:** `2026-06-30-rfa-fleet`
**GitHub issue:** #650
**Work source:** issue #650 + `docs/superpowers/specs/2026-06-13-p3-connector-sync-engine.md`
**Risk tier:** `security` (network-exposed sync route + pg-boss singleton behavior)
**Worktree:** `~/Jarv1s/.claude/worktrees/650-sync-wedge`
**Branch:** `coord/650-sync-wedge`
**Build skill path:** `~/Jarv1s/.claude/worktrees/650-sync-wedge/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1b3e-bd16-71b3-b753-703cd94e4e70`
**Relay threshold:** countable events: around 80-100k tokens or any compaction summary; then relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, issue #650, this handoff, and the relevant parts of `docs/superpowers/specs/2026-06-13-p3-connector-sync-engine.md`.
3. Invoke `coordinated-build` by name, or read the build skill path above in full and follow it.
4. Verify the issue premise on this branch before planning. If the current code already fixes or changes the premise, escalate to `Coordinator`.
5. Send your plan to `Coordinator` and wait for approval before editing feature code.

## Scope

Fix the root cause: a stranded active `connectors.google-sync` exclusive singleton must not permanently wedge future sync requests.

Acceptance from issue #650:
- Killing the worker mid-sync does not permanently block future syncs; recovery happens within `expire_seconds`.
- Reconnect/manual sync after a stranded job reclaims it or returns a clear already-running signal; never silent no-op.
- Add a regression/integration test: enqueue -> force job active -> simulate worker death -> assert next enqueue eventually succeeds.

## Collision Notes

- Root-cause fix belongs in shared connector sync enqueue/supervision path; do not patch only one route.
- #642 waits for this lane because it also touches connector sync scheduling / pg-boss behavior.
- Metadata-only job payloads remain mandatory.
- Treat any network-exposed route behavior and pg-boss singleton reclamation as security-reviewable.

## Non-Negotiables

- Do not touch `docs/coordination/` except this handoff if you need to amend your own report.
- Do not touch board, milestones, merges, or other agents' worktrees.
- No repo-wide `pnpm format`; format/stage only files you changed.
- No `git add .` or `git add -A`.
- Use `DataContextDb`/`withDataContext` boundaries; no raw root DB in protected flows.
- Keep secrets/private data out of payloads, logs, docs, and prompts.

## Done

Open a PR, include local command exit codes, then message `Coordinator` with PR number and compact evidence. The coordinator owns QA and merge.
