# Relay r6 — #656 sports module (Task 10 in progress)

**Spec:** `docs/superpowers/specs/` (sports module) · **Plan:** the sports module plan tasks.
**Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module` · **Branch:** `coord/656-sports-module`
**Coordinator label:** `Coordinator` (pane resolved fresh via `herdr pane list`; escalation pane was `w1:p1F` — re-resolve, do not trust the number).
**Risk tier:** standard module build. Honor all CLAUDE.md Hard Invariants (RLS, migration invariants, module isolation).

## Why this relay

r5 hit auto-compact during Task 10. Coordinator issued a **hard stop**: dirty-relay now, do NOT
commit or continue Task 10 in r5. This doc captures the exact dirty state so r6 resumes cleanly.

## Done (committed)

- Task 0–7: per r5 handoff (source, repository, service, overview, briefing-facts).
- **Task 8** `9be733f6` — REST routes (`packages/sports/src/routes.ts`) + `tests/unit/sports-routes.test.ts` (6 tests green).
- **Task 9** `f48a6b01` — manifest (`packages/sports/src/manifest.ts`), briefing tool
  (`packages/sports/src/briefing-tool.ts`), `index.ts` rewrite, `tests/unit/sports-manifest.test.ts` (2 tests green).

## Task 10 — DIRTY, uncommitted (do NOT lose)

Registration of `@jarv1s/sports` in `BUILT_IN_MODULES` + activate migration 0133 + RLS integration test.

**Coordinator standing decisions for Task 10:**

- Migration number is **0133** — confirmed no collision (#647/#648 not claiming migrations). Keep 0133.
- PG clearance was **GRANTED** (shared dev Postgres quiet; #648 gate done, PR #662 CI is remote). PG-heavy foundation/RLS integration is allowed to run.

**Exact dirty state at relay (`git status --porcelain`):**

```
 M packages/module-registry/package.json      # added "@jarv1s/sports": "workspace:*" dep
 M packages/module-registry/src/index.ts      # import + BUILT_IN_MODULES entry (LOADER-SEAM 1+2)
 M pnpm-lock.yaml                              # pnpm install --lockfile-only (sports dep)
 M tests/integration/foundation.test.ts       # appended { version:"0133", name:"0133_sports_follows.sql" } to migration toEqual list
?? tests/unit/sports-registry.test.ts         # NEW: 2 non-PG tests, PASS 2/2 (asserts sports in getBuiltInModuleManifests + sql dir)
?? .claude/context-meter.log                  # NEVER stage
?? docs/coordination/handoffs/2026-07-01-656-sports-module.md  # coordinator-owned; NEVER stage
```

**Verified so far (r5):**

- `tests/unit/sports-registry.test.ts` passes 2/2 (non-PG).
- No integration test asserts an exact real-registry module count/list — `wellness.test.ts`,
  `data-export.test.ts`, `tasks.test.ts` all use `.find()` (safe). `module-enablement.test.ts:365`
  uses fixture manifests, not the real registry. So adding sports to `BUILT_IN_MODULES` is safe.
- `0133` is the highest migration across all module sql dirs (no collision).
- foundation.test.ts only needed the migration `toEqual` row (no full owned-table-list assertion).

## What's LEFT for r6

1. **Write the RLS integration test** `tests/integration/sports-follows-repository.test.ts`
   (mirror `tests/integration/multi-user-isolation.test.ts` harness — `resetEmptyFoundationDatabase`,
   `createDatabase`, `DataContextRunner`, `signUp` via `/api/auth/sign-up/email`, `disableApproval`).
   Use `SportsFollowsRepository` (`packages/sports/src/repository.ts`) directly under
   `dataCtx.withDataContext({ actorUserId, requestId }, (scopedDb) => repo.<method>(scopedDb, …))`.
   Three cases the plan specifies:
   - (a) owner `create` → `list` round-trips (owner sees own follow).
   - (b) second actor's `list` does NOT see first actor's follow (RLS owner-only isolation) → `[]`.
   - (c) duplicate whole-competition follow (`teamKey: null` twice, same competitionKey) does NOT
     create a second row — `create` returns the existing row (repo guards NULL-team dupes with an
     explicit existence check; see `repository.ts:40-48`). Assert `list` length stays 1 and the
     second `create` returns the same `id`.

   Repo API (from `packages/sports/src/repository.ts`):
   - `list(scopedDb): Promise<SportsFollowDto[]>` — ordered created_at desc.
   - `create(scopedDb, { competitionKey, teamKey }): Promise<SportsFollowDto>` — owner_user_id set via
     `app.current_actor_user_id()`; dedupes whole-competition (null team) via pre-check.
   - `remove(scopedDb, id): Promise<boolean>`.
     `SportsFollowDto = { id, competitionKey, teamKey: string|null, createdAt: string }`.
     `CreateSportsFollowRequest` from `@jarv1s/shared`.

2. **Run PG-heavy tests** (clearance granted — but RE-CONFIRM with Coordinator PG still quiet before
   running, per multi-agent PG contention rule):
   - `pnpm --filter <root> test:integration` for `foundation.test.ts` + the new RLS test, OR the
     repo's integration runner. Foundation asserts the FULL migration list — the 0133 row is already
     appended; a green foundation run proves the row matches the real applied migration.

3. **Non-PG gate on changed files:** `pnpm format:check && pnpm lint && pnpm typecheck` (pre-push trio).
   Format only the changed files (no repo-wide format).

4. **Commit Task 10** — explicit paths ONLY (never `.claude/context-meter.log`, never `docs/coordination/…`):

   ```
   git add packages/module-registry/src/index.ts packages/module-registry/package.json \
     pnpm-lock.yaml tests/unit/sports-registry.test.ts tests/integration/foundation.test.ts \
     tests/integration/sports-follows-repository.test.ts
   ```

   Message: `feat(sports): register @jarv1s/sports in BUILT_IN_MODULES (loader-seams 1+2)`

5. **Report Task 10 done to Coordinator** (re-resolve label + confirm exactly one pane holds it).

6. **Subsequent plan tasks** remain after Task 10: Task 11 (compose.ts briefing integration),
   Task 13 (UI). Continue via `coordinated-build`.

## Guardrails (repeat)

- Explicit staging only. NEVER `git add -A`. NEVER stage `.claude/context-meter.log` or
  `docs/coordination/…` (coordinator-owned).
- No repo-wide format — format only files you changed.
- `foundation.test.ts` test-trap: it asserts the full migration list with `toEqual`; the 0133 row is
  already in place. Do not reorder.
- Do NOT assume migration numbers; Coordinator serializes ordering (0133 confirmed).
- Relay at ~80–100k tokens or on compaction summary. Escalate blockers to Coordinator, don't spin.
- `[ -d node_modules ] || pnpm install` — node_modules already exists in this worktree; do not reinstall.
