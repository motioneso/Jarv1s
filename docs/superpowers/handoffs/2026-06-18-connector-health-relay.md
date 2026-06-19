# Connector Health Relay

## Context

- Run: `2026-06-18-deploy-readiness`
- Issue: `#254`
- Branch/worktree: `deploy-254-connector-health` at `/home/ben/Jarv1s/.claude/worktrees/deploy-254-connector-health`
- Original handoff: `/home/ben/Jarv1s/docs/coordination/handoffs/2026-06-18-deploy-254-connector-health.md`
- Approved spec: `/home/ben/Jarv1s/docs/superpowers/specs/2026-06-18-connector-health-monitoring.md`
- Approved plan: `docs/superpowers/plans/2026-06-18-connector-health-monitoring.md`
- Coordinator label: `Coordinator`

## Current State

- `node_modules` exists.
- Handoff, spec, `coordinated-build`, `writing-plans`, `test-driven-development`, and `relay` skills were read.
- Required CLAUDE.md recalls were run:
  - `jarv1s current project state`: no results
  - `jarv1s migration hash placement`: no results
  - `jarv1s integration test trap`: one unrelated chat-live focused Vitest trap
  - `jarv1s frontend workspace querykey`: no results
  - `jarv1s RLS shareability policy`: no results
  - `jarv1s accesscontext datacontext`: no results
- Plan was written and coordinator-approved.
- Task 1 is complete and committed:
  - `f5c84c6 feat(connectors): add connector sync health columns`
  - Added `packages/connectors/sql/0099_connector_health_metadata.sql`.
  - Added manifest entry and DB types.
  - Added migration/default-null assertion in `tests/integration/connectors.test.ts`.
- Task 1 TDD evidence:
  - RED: direct focused command failed with `healthColumns.rows` empty / missing health columns.
  - GREEN: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm vitest run tests/integration/connectors.test.ts` passed, 12/12.
- `jarv1s_deploy_254` database did not exist initially; it was created with Docker Compose Postgres `createdb`.
- Use direct focused Vitest commands for TDD (`pnpm vitest run ...`). `pnpm test:integration <file>` hardcodes `tests/integration` first and runs the broad suite.
- Task 2 RED scratch assertions were started, validated, then removed before relay per coordinator request. Worktree is clean at the Task 1 boundary except this relay-doc update.

## Coordinator Approval

Coordinator approved the plan with these constraints:

- Keep admin/owner DTOs and `app.list_connector_account_safe_metadata()` aggregate-only.
- Do not put raw provider errors, response bodies, synced subjects/titles/external IDs, or tokens in DB/DTO/log/test fixtures.
- Migration number `0099` is provisional; renumber on rebase if main lands a collision.
- Keep `#114` secret-residual branch/policy untouched.
- Proceed task-by-task with TDD/focused checks, then `coordinated-wrap-up`.

## Next Step

Resume from approved plan Task 2: Safe DTO Exposure. Start with RED:

```bash
JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm vitest run tests/integration/connectors.test.ts
```

Add only failing owner/admin DTO assertions first:

- Owner `/api/connectors/accounts` response includes `lastSyncStartedAt`, `lastSyncFinishedAt`,
  `lastSyncStatus`, `lastSyncError`, `lastSyncCounts`, all `null` for new accounts.
- Admin `/api/admin/connectors/accounts` response includes the same safe aggregate fields.
- Responses still exclude token/secret material and raw provider/body text.

Expected RED: two connector integration failures because DTO fields are absent. Then add the
minimal shared DTO/schema, repository select, route serialization, and safe-metadata SQL update
needed to pass. Do **not** edit applied migration `0010`; add a new follow-up migration because the
runner hash-checks applied files.

Use explicit `git add` paths only. Do not touch `docs/coordination/`, project boards, milestones,
merge state, or `#114`.

## Closeout

When successor is driving, message `Coordinator`: successor label/session is active; old
`Build-254-ConnectorHealth-R2` pane can be reaped.
