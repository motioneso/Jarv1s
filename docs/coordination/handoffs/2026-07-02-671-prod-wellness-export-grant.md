# Handoff — #671 Prod Wellness Export Job Grant

Issue: https://github.com/motioneso/Jarv1s/issues/671
Coordinator: `Coordinator`
Branch/worktree: `coord/671-prod-wellness-export-grant` at `~/Jarv1s/.claude/worktrees/671-prod-wellness-export-grant`
Risk tier: `sensitive`

## Context

JarvisProd is healthy on edge digest `sha256:8733509d98c5...`, but a Wellness export job failed in production with `permission denied for table data_export_jobs` inside `DataExportRepository.updateJobStatus`.

Observed grants: `jarvis_worker_runtime` has `UPDATE` but not `SELECT` on `app.data_export_jobs`. No private export contents were read during investigation.

## Scope

- Fix the root cause for worker-owned export job status updates.
- Prefer the smallest grant/migration change that lets the worker status update path read exactly what it already needs.
- Add or update a focused regression check for the worker runtime permission/status-update path.
- Keep this to the production export failure; do not redesign Wellness exports or data export architecture.

## Constraints

- Use `coordinated-build`.
- Do not touch `docs/coordination/`; coordinator-only.
- Do not run repo-wide format or broad staging.
- Do not use `git add .` or `git add -A`.
- Preserve DataContextDb/RLS invariants and metadata-only job payloads.
- If a migration is needed, add a new migration file; never edit an applied migration.

## Expected Verification

- Run the focused test covering the grant/status-update path.
- Run the smallest necessary type/lint/format checks for touched files.
- If the change is a migration/grant, run the relevant migration verification expected by the repo.
- Wrap up via `coordinated-wrap-up`: push branch, open PR, and report PR URL plus exact verification evidence to the coordinator.
