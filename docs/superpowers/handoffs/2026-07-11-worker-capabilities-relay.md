# Relay — #915 External Worker Capabilities

## Resume target

- Spec: `docs/superpowers/specs/2026-07-09-external-worker-capabilities-design.md`
- Approved plan: `docs/superpowers/plans/2026-07-11-worker-capabilities.md`
- Original build handoff: `docs/coordination/handoffs/2026-07-11-915-worker-capabilities.md`
- Worktree: `~/Jarv1s/.claude/worktrees/915-worker-capabilities`
- Branch: `feat/915-worker-capabilities`
- Coordinator label: `Coordinator`; always run `herdr pane list` and require exactly one matching
  label before messaging.
- Security tier. Relay again on the 70% context-meter warning or any compaction summary.

## Scope and approved rulings

- Build only Goal #1 (queue/schedule/run-now registration and reconciliation) and Goal #3
  (host-pinned SSRF-safe fetch). Goal #2 structured AI already shipped in PR #923; do not touch it.
- Fork A approved: worker reconcile failures stay process-local fail-closed and retry on later
  startup/control reconciliation. Do not invent an admin-write or RLS-bypass seam.
- Fork B approved: orphaned external queues/schedules/workers purge at startup or control-plane
  reconcile. No live uninstall endpoint exists; do not add one.
- Migration 0158 uses the authorized 0144/0112/0137 fallback: `jarvis_migration_owner` SECURITY
  DEFINER, narrow role-scoped SELECT policies, worker-only EXECUTE, and
  `search_path = pg_catalog, app, pg_temp`. The originally planned bespoke NOLOGIN owner was
  impossible because `jarvis_migration_owner` is `NOCREATEROLE`. Disclose this approved swap in the
  PR body.
- Global `ALLOWED_PAYLOAD_KEYS` remains unchanged. All external module job/control payloads use
  dedicated exact-key validators and contain metadata only.

## Completed and committed

- `0f1cfde4 feat(modules): validate external worker declarations`
  - Added manifest queue/schedule/fetch contracts and DTO types.
  - Added browser-safe `@jarv1s/host-fetch/policy` hostname validation.
  - Added fail-closed worker declaration validation: prefix/collision, schema formats, caps,
    dead-letter graph, cron/timezone, static params, retry clamp.
  - API discovery supplies built-in/foundation queue names as reserved collisions.
  - Approved implementation plan is committed in this changeset.
- `2f9bc1f0 feat(jobs): add metadata-only module job envelopes`
  - Added `ExternalModuleJobPayload`, `assertModuleJobPayload`, and `sendModuleJob` with trusted
    actor/module/hash stamping, schema/2 KiB/4 KiB bounds, and singleton options outside payload.
  - Added exact `{moduleId, action:"reconcile"}` control payload validation and
    `platform.module-control` foundation queue.
  - Extracted shared pure params-schema matching into the module SDK.
- `eaa91eb6 feat(worker): enumerate active external module users`
  - Added `packages/settings/sql/0158_external_module_active_users.sql` and ordered migration test.
  - Added worker-only active-user fan-out function security/behavior integration coverage.
  - Updated the exact queue-list integration assertion for `platform.module-control`.

## Verification evidence

- Manifest/loader/jobs focused suites: 56 passing before Task 3.
- Root `pnpm typecheck`: passed after Tasks 1 and 2.
- `pnpm tsx scripts/test-integration.ts tests/integration/foundation.test.ts`: 30/30 passed.
- Mandatory pre-migration-commit `pnpm test:integration`: 136 files passed; 1,475 tests passed;
  2 skipped. Duration about 588 seconds.
- Worktree was clean immediately after `eaa91eb6`; this relay doc is the only subsequent change.

## Continue here

1. Run `[ -d node_modules ] || pnpm install`; dependencies already exist, so this should skip.
2. Read the approved plan and this relay in full; invoke `coordinated-build` and keep using strict
   RED → observed failure → minimal GREEN cycles.
3. Continue Task 3 by writing failing unit/integration tests for a server-only
   `packages/module-registry/src/external/job-reconciler.ts`:
   - create dead-letter targets before source queues and converge queue options;
   - register each process-local worker exactly once, `offWork` before replacement;
   - schedule one validated envelope per active user with key
     `${moduleId}:${scheduleId}:${userId}` and remove stale/orphan keys;
   - disabled modules keep queues/jobs but stop registrations/schedules;
   - missing discoveries purge orphan schedules/workers/queues;
   - isolate module failure process-locally and log only module id/error name.
4. Wire worker startup/control handling only after those tests are red/green. Reuse
   `ExternalModuleWorkerRuntime` and `createExternalModuleRpcHandler`; do not duplicate #919.
5. Complete Tasks 4–7 from the approved plan: run-now/lifecycle signals, shared Node HTTPS pinned
   transport, `ctx.fetch` RPC/composition guard, end-to-end security tests, then
   `coordinated-wrap-up`.
6. Keep commits green and stage explicit paths only. Never touch `docs/coordination/`, board,
   milestones, or merge state.

## Current implementation notes

- `getExternalModuleRegistrations` now accepts `reservedQueueNames`; the worker composition root
  must pass `getAllQueueDefinitions()` just as API discovery does.
- Module params matching currently permits omitted declared fields but rejects every unknown field;
  schedule and runtime params therefore cannot carry undeclared strings/content.
- The 0158 function returns only UUIDs and sees `app.external_modules` / `app.module_enablement`
  through migration-owner-only SELECT policies. PUBLIC execute is revoked; only
  `jarvis_worker_runtime` receives EXECUTE.
- Do not edit migration 0158 after it has been committed/pushed into an applied environment. It is
  currently only on this feature branch and was verified from a fresh isolated database.
