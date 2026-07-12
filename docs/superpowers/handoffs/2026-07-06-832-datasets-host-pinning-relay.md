# #832 Datasets Host-Pinning Log — Relay Handoff

**Branch/worktree:** `832-datasets-host-pinning` at
`/home/ben/Jarv1s/.claude/worktrees/832-datasets-host-pinning` (already checked out, don't
re-clone). `node_modules` already installed — do NOT re-run `pnpm install`.

**Coordinator:** Herdr pane label `Coordinator` (resolve fresh via `herdr pane list` — never trust
a pane number written anywhere, including this doc). **Plan already approved** on this issue
(#832) — no further plan approval needed for #832. Coordinator was notified of this relay already.

**Chain context:** This is issue 1 of 3 in a sequential chain in this one worktree (#832 → #833 →
#836), per `docs/coordination/handoffs/2026-07-06-832-833-836-datasets-chain.md` (read it — not
restated here). **Do not start #833 or #836.** Only finish #832 through PR + wrap-up.

**Plan doc (read this in full — has exact code for every remaining step):**
`docs/superpowers/plans/2026-07-06-832-datasets-host-pinning-log.md`

**Issue:** #832 (`gh api repos/motioneso/jarv1s/issues/832` for full body if needed — already
summarized accurately in the plan doc's goal section).

## Done (commit already on branch, do not redo)

- **Task 1** (`HostPinningViolationError` class + throw sites) — commit `c2c1aa5f`. Touched
  `packages/datasets/src/host-pinning.ts` (new exported error class, both throw sites in
  `assertHttpsAndAllowed` now throw it with the attempted host), `packages/datasets/src/index.ts`
  (exports `HostPinningViolationError`), `tests/unit/dataset-host-pinning.test.ts` (updated 3
  existing rejection tests to assert `HostPinningViolationError`/`.host`, added 1 new
  `instanceof` test). All 16 tests in that file green. `pnpm --filter @jarv1s/datasets typecheck`
  clean. Prettier/eslint clean on all 3 touched files.

## Remaining — execute in this order (full detail in the plan doc)

1. **Task 2** (plan doc "Task 2: `DatasetLogger` seam + distinct logging in `client.ts`") — TDD:
   - First add the two new tests to `tests/unit/dataset-client.test.ts` (fake recording logger +
     the two `it(...)` blocks in the plan — pinning-violation-logs-and-degrades,
     ordinary-error-stays-silent). Confirm red (won't even compile until `DatasetLogger` is
     exported — expected).
   - Then implement in `packages/datasets/src/client.ts`: import `HostPinningViolationError` from
     `./host-pinning.js`; add exported `DatasetLogger` interface (`warn(data, message)`, mirrors
     `packages/connectors/src/sync-jobs.ts:113-124`'s `SyncLogger`/`NOOP_SYNC_LOGGER` exactly —
     read that file for the precedent, don't reinvent); add `NOOP_DATASET_LOGGER` const; add
     `logger?: DatasetLogger` to `DatasetClientDeps`; `const logger = deps.logger ??
     NOOP_DATASET_LOGGER;`; change `catch {` to `catch (error) {` and add the
     `if (error instanceof HostPinningViolationError) logger.warn({ sourceId: source.id,
     datasetKey, host: error.host }, "...")` block before the existing `if (hit)` — **do not
     change any existing return statement in that catch block**, this is additive-only.
   - Confirm green.
2. **Task 3** (plan doc "Task 3") — add `type DatasetLogger` to the client export line in
   `packages/datasets/src/index.ts` (the `HostPinningViolationError`/other host-pinning exports
   are already done from Task 1 — only the client-export line needs the addition now). Re-run the
   full datasets test suite as the checkpoint.
3. **Task 4** (plan doc "Task 4") — one-line change in
   `packages/module-registry/src/index.ts` (~line 1173, sports `registerRoutes` callback): add
   `logger: createModuleLogger(server.log, "sports")` to the existing `createDatasetClient(...)`
   call's deps object (alongside `fetchFn: deps.fetchFn`). `createModuleLogger` is already
   imported in that file (line 124). Run `pnpm --filter @jarv1s/module-registry typecheck`.
   **Confirmed disjoint from #834/#835/#837** (checked against the #837 handoff's collision
   notes before starting this issue) — coordinator confirmed this scope when approving the plan.
4. **Task 5 — full gate + PR:**
   - `pnpm format:check && pnpm lint && pnpm typecheck`
   - `pnpm verify:foundation` (record exit code)
   - `git fetch origin main && git rebase origin/main` (should be a no-op/fast-forward — no other
     agent in this run touches `host-pinning.ts`/`client.ts`; module-registry/index.ts also
     confirmed disjoint)
   - Stage only the touched files per task (never `git add -A`), commit with
     `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
   - Push, open PR against issue #832 (routine tier). PR body: summarize the distinct-error +
     logging + one-line composition-root wiring; note "1/3 of the datasets host-pinning chain,
     #833/#836 to follow sequentially in this same worktree after this merges."
5. **Wrap-up.** Once PR is open and gate is green, invoke `coordinated-wrap-up` to report the PR +
   verified evidence to the Coordinator, then stop. Do not merge, touch the board, or close the
   issue.
6. **After coordinator confirms #832 merged:** `git fetch origin && git rebase origin/main`, then
   start #833 per the chain handoff doc (new `coordinated-build` plan cycle — do not reuse this
   plan doc, it only covers #832).

## Task-tracking

Recreate a TaskList (TaskCreate/TaskUpdate) mirroring: Task 1 ✅ (commit `c2c1aa5f`), Task 2
pending, Task 3 pending, Task 4 pending, Task 5 pending. Keep the existing 3 top-level tasks
(#832/#833/#836 chain) — #832 stays `in_progress` until its PR is opened and wrap-up reports to
the coordinator.

## Conventions to keep following

- Caveman-mode terse messages to the Coordinator (`herdr-pane-message` skill) — full technical
  accuracy, no filler.
- Before any `herdr pane run`/message, re-resolve the Coordinator pane via a fresh
  `herdr pane list` — pane numbers reflow, never trust one written in a doc.
- `git add` by explicit path only, never `-A` or repo-wide `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
