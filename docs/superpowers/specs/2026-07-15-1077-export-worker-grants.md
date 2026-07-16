# #1077 — Restore least-privilege worker access for data export

Status: **approved by Ben on 2026-07-15**

## Problem

`export.build` runs owner-scoped reads as `jarvis_worker_runtime`. Real UAT reaches
`app.notification_reads`, which lacks the worker grant/policy, aborts the transaction, and leaves
the personal export stuck at `Queued...`. The first denial can hide later gaps.

## Locked scope

Audit every table read through the worker-scoped database path in `export.build`, including the
known candidates `notification_reads`, `entities`, `ai_assistant_action_requests`,
`jarvis_action_audit_log`, `usefulness_feedback_signals`, and `usefulness_feedback_targets`.

For each confirmed gap only:

- add a module-owned, append-only migration using the next available global migration number;
- grant `jarvis_worker_runtime` `SELECT` only;
- add a worker `SELECT` policy that exactly mirrors the table's existing owner-visible predicate;
- preserve all existing grants and policies; never add `INSERT`, `UPDATE`, `DELETE`, or
  `BYPASSRLS` access.

`app.notification_reads` must retain both `user_id = app.current_actor_user_id()` and its existing
visible-notification `EXISTS` guard.

## Verification

- An integration test populates every worker-scoped export table and proves `export.build`
  completes for the owning account.
- A least-privilege test proves the worker can select the newly covered rows but cannot write them.
- Migration inventory/hash expectations are updated for every new migration.
- The normal full verification and release-hardening gates pass.

## Non-goals

- No export payload, API, UI, retry, or job-shape changes.
- Do not change owner predicates or broaden cross-user visibility.
- Do not repair `worker_fail_data_export_job` transaction handling here; track that separately if
  still useful after this fix.
- Do not modify PR #1075.

## Exit criteria

1. Every table read through the worker-scoped export path has the minimum owner-scoped `SELECT`
   grant/policy required by the existing export behavior.
2. The populated-account export and negative write tests pass.
3. Independent Opus security QA finds no unproven trust-boundary or cross-user access gap.
4. Exact-head live UAT proves a real personal export completes before #1075 is reconsidered.
