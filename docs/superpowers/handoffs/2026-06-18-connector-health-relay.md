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
- No product code has been changed.

## Coordinator Approval

Coordinator approved the plan with these constraints:

- Keep admin/owner DTOs and `app.list_connector_account_safe_metadata()` aggregate-only.
- Do not put raw provider errors, response bodies, synced subjects/titles/external IDs, or tokens in DB/DTO/log/test fixtures.
- Migration number `0099` is provisional; renumber on rebase if main lands a collision.
- Keep `#114` secret-residual branch/policy untouched.
- Proceed task-by-task with TDD/focused checks, then `coordinated-wrap-up`.

## Next Step

Resume from approved plan Task 1. Start with RED:

```bash
JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts
```

Add only the failing migration/default-null assertion first. Watch it fail for missing health
columns. Then add the minimal migration/types/manifest changes needed to pass.

Use explicit `git add` paths only. Do not touch `docs/coordination/`, project boards, milestones,
merge state, or `#114`.

## Closeout

When successor is driving, message `Coordinator`: successor label/session is active; old
`Build-254-ConnectorHealth` pane can be reaped.
