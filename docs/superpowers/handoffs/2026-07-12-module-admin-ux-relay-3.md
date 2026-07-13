# Relay 3 — module-management admin UX (#996, part of #860)

Worktree/branch: `/home/ben/Jarv1s/.claude/worktrees/module-admin-ux`, branch `module-admin-ux`.
Coordinator label: `Coordinator` — confirmed exactly one pane with this label (`herdr pane list`)
before this handoff. My own pane label was `Module-996-3` (session `cd5a42e5-...`).

## State

- **Plan APPROVED by Coordinator**: `docs/superpowers/plans/2026-07-12-module-management-admin-ux.md`
  — 13 TDD tasks (S1 gate removal + resolveModulesDir, S2 manifest flip, S3 pane dedup+switch, S4
  compose) + Task 14 (full gate + PR). Read it BY TASK, never in full.
- Coordinator's two explicit confirms to honor while building (do not skip):
  1. Task 11 must actually DELETE `USER_TOGGLEABLE_MODULE_IDS` and derive from `!module.required`.
  2. Keep the existing `pending-restart` state/tag verbatim in the registry pane — no auto-reboot.
- **Tasks 1-3 DONE, green, committed** (task-tracker ids 1-3 completed — see `TaskList`):
  - `9a8533a4` Task 1: `resolveModulesDir` helper.
  - `9d6b08af` Task 2: server.ts gate removal (`ApiServerConfig.externalModulesDir` non-nullable,
    `enableExternalModules` deleted). Also fixed test-file drift the plan missed: 6 integration
    test fixtures that constructed `ApiServerConfig` with the now-deleted flag, plus deleted the
    obsolete `discoverExternalModules` gate-behavior unit tests in
    `tests/unit/external-modules-discovery.test.ts` (behavior no longer exists).
  - `dcdae9d6` Task 3: dropped `enabled` from `createActiveExternalModulesResolverForApi` and
    narrowed `registerPlatformRoutes`/`registerExternalModuleWebAssetRoute`'s
    `getActiveExternalModules` param from optional to required in `server.ts` +
    `external-module-web-route.ts`.
  - After Task 3: `pnpm --filter @jarv1s/api typecheck` errors are confined to EXACTLY
    `module-distribution-port.ts:32` (`enableExternalModules` doesn't exist) — this is expected,
    Task 4 closes it. Confirm this stays the ONLY error before starting Task 4's Step 1.
- **Task 4 NOT yet started** (task-tracker id 4, `pending`; ids 5-14 also `pending`).
- **Plan drift note for future tasks**: the plan's Task 2 Step 4 said typecheck errors would be
  "confined to external-module-tools.ts/module-distribution-port.ts" — in practice several
  integration test files (constructing `ApiServerConfig` with the deleted flag) and one unit test
  also broke and needed fixing; already handled for Tasks 1-3. If a later task (5+) hits similar
  drift (test fixtures referencing removed fields not mentioned in that task's file list), fix them
  inline as mechanical cleanup — it's not a product/architecture fork, just plan incompleteness.
  Only escalate if the fix requires an actual design decision.

## Next steps

1. `[ -d node_modules ] || pnpm install` (should already exist — skip).
2. Read plan doc's **Task 4** section only (`## Task 4:` header, `module-distribution-port.ts —
   drop the gate`). Implement Step 3, run `pnpm --filter @jarv1s/api typecheck` (expect PASS),
   commit (Step 5).
3. Continue Task 5 → Task 13 in order, one plan-doc section at a time, TDD
   (`superpowers:test-driven-development`), one green commit per task, `Co-Authored-By: Claude`
   trailer, generous why-comments citing `#996`/`#860`. Mark each `TaskUpdate` `in_progress`→
   `completed` as you go. **Recreate the task-tracker list first** (this session's `TaskList` was
   empty on boot despite the prior relay's ids 1-14 — tracker state doesn't persist across
   sessions; recreate ids 1-14 mirroring the plan's task titles, mark 1-3 completed immediately).
4. Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` +
   `git fetch origin main && git rebase origin/main`.
5. Task 14: full gate `pnpm verify:foundation` + `pnpm test:integration`, both green, record exit
   codes, then `coordinated-wrap-up` — PR body `Part of #996` + `Part of #860`, base `main`, short
   user-facing "What's new" line. Report PR number to Coordinator. Never merge/board/close.

## Constraints (unchanged)

- Never touch `packages/ai/**`, `packages/chat/**`, `packages/module-registry/src/index.ts`,
  AI-admin settings surfaces (Codex-869's lane, concurrent build on `ai-admin-869`).
- No DB migration for S2 (confirmed unnecessary, Coordinator re-confirmed).
- No `git add -A`. Don't touch `docs/coordination/`. Don't run repo-wide `pnpm format`. Never edit
  an applied migration.
- S4 (compose) is repo-side only — never touch `~/JarvisProd/` or any live box.

## Why relaying now

Context-meter hit 70% right after Task 3's commit (`dcdae9d6`) landed green. Clean, low-loss
handoff point — pick up at Task 4 Step 1.
