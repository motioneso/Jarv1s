# Build Handoff — memory-cleanup

**Specs (approved):**
- `docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md` (issues #554, #555)
- `docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md` (issues #560, #561, #562, #565)

**GitHub issues:** #554, #555, #560, #561, #562, #565 — fix all in one PR.
**Risk tier:** `sensitive` (shared-table write paths, cross-module API contract)
**Worktree:** ~/Jarv1s/.claude/worktrees/memory-cleanup **Branch:** memory-cleanup (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Coordinator session id:** `f8a5b8f7-a287-4665-b480-0f46dc52bed2`
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately.

## What to build

Six follow-up fixes to the memory module, all flagged during security/spec QA of PRs #553 and #559. No migrations needed.

### #554 — Transaction atomicity (confirmFact, correctFact, patchFactStatus)

In `packages/memory/src/`, the `confirmFact`, `correctFact`, and `patchFactStatus` operations each perform multiple writes without a wrapping transaction. A crash between writes leaves partial state.

**Required:**
- Wrap each of the three operations in a DB transaction using the `DataContextDb` transaction seam.
- Add a test verifying atomicity: mock a mid-write failure and assert neither write persisted.

### #555 — patchFactStatus: block reactivation of superseded records

`patchFactStatus` currently allows setting `status='active'` on a record whose `superseded_by` is non-null.

**Required:**
- Guard in `patchFactStatus`: return 400 if request sets `status='active'` and `superseded_by IS NOT NULL`.
- Add a regression test asserting the 400 response.

### #560 — Self-entity delete/forget returns 403

`DELETE /api/memory/graph/entities/:id` uses a 409 fact-count check but has no explicit guard against deleting the user's own self-entity.

**Required:**
- In the delete/forget path, identify the actor's self-entity.
- Return 403 if the target entity is the actor's self-entity (before any other check).
- Add an integration test asserting self-entity delete is rejected with 403.

Part of epic #533.

### #561 — acceptCandidate must route conflicts via correction path

`acceptCandidate` always creates a new active fact, even if a conflicting active fact already exists for the same predicate/subject-entity.

**Required:**
- Before calling `remember()`, check for existing active facts with the same predicate/subject-entity.
- If a conflict exists, route through the #532 correction path instead of creating a duplicate.
- #532 is already merged (PR #553). Part of epic #533.

### #562 — factToItem: no raw sourceRef fallback

In `factToItem`, `sourceSummary` falls back to `source.sourceRef` (a raw private source ID such as a UUID) when no `sourceLabel` is present.

**Required:**
- When `sourceLabel` is absent and `sourceRef` looks like a raw UUID or internal ref, substitute a safe display string (e.g. the `sourceKind` label) instead.
- Add a test asserting no raw UUIDs appear in the `sourceSummary` field.

Part of epic #533.

### #565 — Module isolation: notes monitor-provider

`packages/notes/src/monitor-provider.ts:61-87` queries `app.memory_file_index` and `app.memory_chunks` directly via raw Kysely, violating module isolation.

**Required:**
- Add `listRecentVaultFiles(scopedDb: DataContextDb, since: Date, limit: number)` to `MemoryRepository` in `packages/memory/src/`. Returns recently ingested vault files with their first N chunks.
- Update `packages/notes/src/monitor-provider.ts` to call this method instead of querying memory tables directly.
- `@jarv1s/notes` already has `@jarv1s/memory` in its deps — no new dep needed.

Part of epic #531.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read both specs above IN FULL.
3. Grep the files cited in each issue on YOUR branch to confirm the gap is still real before planning (specs go stale).
4. Invoke `coordinated-build`, write the plan, escalate to Coordinator for approval, then build.

## Your compact

- All fixes in one PR titled `fix(memory): transaction atomicity, supersession guard, self-entity 403, conflict routing, sourceSummary, notes isolation (#554 #555 #560 #561 #562 #565)`.
- Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files; record exit codes in wrap-up.
- Work only in this worktree. `git add` only your changed files.
- Never touch the project board, milestones, or merge.
- Escalate to `Coordinator` on: plan ready, blocker, design fork outside spec, done.

## Collision notes

- No other agent touches `packages/memory/src/` — you own it exclusively this run.
- No migrations needed for any of these issues.
