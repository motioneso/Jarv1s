# 914-module-data-plane — relay-7 handoff

Plan: `docs/superpowers/plans/2026-07-10-module-data-plane.md` (READ IN FULL — Tasks 7-9 + final
Verification section are the remaining work). Branch `build/914-module-data-plane`, same worktree.
Prior handoff `docs/superpowers/handoffs/2026-07-10-914-module-data-plane-relay-6.md` (superseded —
Task 2 review-verdict question it raised is moot: Tasks 1-6 are now all committed, see below).

## State: Tasks 1-6 committed. Task 7 ~90% done, uncommitted. Tasks 8-9 not started.

Direct execution only — no sub-agent delegation (prior lane stalled 2h doing that). Commit after
EACH task. Do not touch `docs/coordination/` (coordinator-only). No repo-wide `pnpm format`. No
`git add -A` — stage explicit paths only.

Confirmed via `git log --oneline`: commits `e5f45ddc` (Task 3), `24c7b342` (Task 4), `2a51866e` +
`88eaa6c3` (Task 5, incl. a crash-recovery hardening fix), `d8b9c073` (Task 6) are all landed.

**Task 7 uncommitted in the tree right now:**
- `scripts/module-install.ts` (147 lines, untracked) — matches plan's 4-phase `installModule`
  implementation (Task 7 Step 3).
- `tests/integration/module-install.test.ts` (93 lines, untracked) — matches plan's Task 7 Step 1
  test.
- `packages/db/src/module-role-broker.ts` (modified, +12/-1, uncommitted) — adds
  `GRANT USAGE, CREATE ON SCHEMA app` + `GRANT REFERENCES (id) ON app.users` to the install role
  inside `ensureModuleRoles`. **This is not in the plan's original Task 5 listing** but is a
  legitimate fix: Phase B's installer role runs `CREATE TABLE` DDL directly, which requires schema
  privileges the plan's original Task 5 code never granted. Keep this change — fold it into Task
  7's commit (do not touch already-committed Task 5 commits `2a51866e`/`88eaa6c3` — never amend
  landed commits, just carry this diff forward in the new commit).

**Still missing for Task 7 (per plan lines ~1352-1401):**
1. Run `pnpm test:integration -- module-install.test.ts` — not yet verified green in this relay.
   Plan Step 4 flags a known needed test fix: the `roleCanLogin` assertion as drafted checks the
   wrong condition; replace with a direct `rolcanlogin` existence+`false` check (exact replacement
   snippet is in the plan at that line).
2. Plan Step 5: add the `module-install` ops-profile service to `infra/docker-compose.prod.yml`
   (confirmed absent via grep — not yet added). Exact YAML block + usage comment in the plan.
3. Commit Task 7: `git add scripts/module-install.ts tests/integration/module-install.test.ts
   infra/docker-compose.prod.yml packages/db/src/module-role-broker.ts` (note: role-broker.ts
   included here since plan's own Task 7 git-add line predates this fix) →
   `git commit -m "feat: add 4-phase external module install entrypoint (#914)"`.

## Next steps after Task 7 lands

1. **Task 8** (plan line ~1407): `packages/db/src/module-storage-rpc.ts` + `tests/integration/
   module-storage-rpc.test.ts`. Full code given verbatim in plan. Commit per plan's Step 5 git-add.
2. **Task 9** (plan line ~1565): `getExternalModuleDeletionTables` in
   `packages/module-registry/src/index.ts`, `readExternalModuleExportRows` in
   `packages/settings/src/data-export.ts`, wire into `scripts/delete-user-data.ts`, extend
   `tests/integration/module-registry.test.ts`. **Watch file-size**: plan explicitly warns
   `module-registry/src/index.ts` was already 1822 lines pre-Task-9 — if `check:file-size` fails,
   split the new export into `packages/module-registry/src/external-lifecycle.ts` per the plan's
   Verification section note, re-export from the barrel.
3. **Verification section** (plan tail, line ~1748): `pnpm verify:foundation` full gate (record
   exact exit code), `pnpm test:integration` in full (not just new files — catches
   `foundation.test.ts` migration-list regressions), `audit-release-hardening.ts` script, file-size
   check.
4. Run the gate via `coordinated-build`, open the PR via `coordinated-wrap-up`. Report the PR
   number + VF exit code to the Coordinator label.

## Lesson this relay

Context hit the 71% checkpoint almost immediately after loading the full plan doc (1773 lines) +
prior handoff into context in one relay — for the next relay, read the plan in **sections**
(offset/limit around just the target task) rather than the whole file at once if picking up
mid-plan.
