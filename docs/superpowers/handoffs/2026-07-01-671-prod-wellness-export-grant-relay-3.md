# #671 relay-3 handoff — resume at validation/gate step

Worktree: `~/Jarv1s/.claude/worktrees/671-prod-wellness-export-grant`
Branch: `coord/671-prod-wellness-export-grant`
Latest commit: `76bb14f8` (all implementation work committed — clean tree except untracked
`.claude/context-meter.log`, not yours to touch)
Coordinator label: `Coordinator` (resolve fresh via `herdr pane list` before messaging — never
reuse a pane number from this doc)
Skill: `coordinated-build` (you are past plan/build, at validation → wrap-up)

## Binding decision already implemented

Coordinator decision for the 0134 raw-SELECT-vs-hardening-test conflict: **SECURITY DEFINER
bounded functions**, not weakening the test. Implemented in commit `76bb14f8`:

- `packages/settings/sql/0137_data_export_jobs_worker_bounded_functions.sql` (NEW): revokes
  `jarvis_worker_runtime`'s raw SELECT on `app.data_export_jobs` (granted by 0134), adds 4
  SECURITY DEFINER functions (`worker_get_data_export_job`, `worker_update_data_export_job_status`,
  `worker_complete_data_export_job`, `worker_fail_data_export_job`), each scoped by
  `id = p_job_id AND owner_user_id = app.current_actor_user_id()`. EXECUTE granted to
  **both** `jarvis_worker_runtime` and `jarvis_app_runtime` (scope decision beyond Coordinator's
  literal wording — see "Flag in PR" below).
- `packages/settings/src/data-export-repository.ts`: added `workerGetJobById`,
  `workerUpdateJobStatus`, `workerCompleteJob`, `workerFailJob` — call the new SQL functions via
  Kysely `sql` tag. Original methods (`getJobById`, `updateJobStatus`, `completeJob`, `failJob`)
  unchanged, still used by app-context routes.
- `packages/wellness/src/export-job.ts` and `packages/settings/src/data-export-jobs.ts`: worker
  call sites switched to the `worker*` repository methods.
- `tests/integration/data-export.test.ts`: "Finding 3" spy target changed from `updateJobStatus`
  to `workerUpdateJobStatus`. All other tests in this file verified by full read to need no further
  changes (dual-role EXECUTE grant covers the app-role-invoked cleanup/build tests).
- `tests/integration/foundation.test.ts`: added the `0137_data_export_jobs_worker_bounded_functions.sql`
  row to the migration-list `toEqual` assertion.

**None of this has been run yet** — implementation is done, validation is not.

## What's left (in order)

1. **Check `scripts/audit-release-hardening.ts` / `tests/integration/release-hardening.test.ts`**
   for any assertion about `data_export_jobs` grants that may need updating for the new model (no
   table SELECT for worker role; EXECUTE-only on 4 named functions, granted to both
   `jarvis_worker_runtime` and `jarvis_app_runtime`). Not yet checked this relay.
2. Run the isolated-DB gate: `JARVIS_PGDATABASE=jarv1s_671 pnpm verify:foundation` (apply
   migration 0137, run full test suite — confirm the previously-failing hardening test now passes
   and nothing else regressed). Record real exit code, don't `| tail`.
3. `JARVIS_PGDATABASE=jarv1s_671 pnpm audit:release-hardening` — confirm `AUDIT_EXIT=0`.
4. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. Push + `gh pr create` to `main`. PR body must cover:
   - Scope: #671 fix — three grants 0134/0135/0136 plus the SECURITY DEFINER bounded-function
     replacement (0137) for the worker status-update path.
   - Spec doc reference (see prior handoffs in `docs/superpowers/handoffs/` for the path).
   - VF_EXIT / AUDIT_EXIT evidence from steps 2–3.
   - **Explicit flag: Fable 5 / stronger security review required before merge.**
   - Deferred follow-up (out of scope): wellness content-table silent-empty-read risk.
   - **Flag in PR**: EXECUTE on the 4 new SECURITY DEFINER functions was granted to both
     `jarvis_worker_runtime` and `jarvis_app_runtime`, not just the worker role the Coordinator's
     literal wording named. Reason: most existing tests in `data-export.test.ts` and
     `wellness-export-job.test.ts` exercise worker handlers under app-role `DataContextRunner`
     (established suite pattern), so worker-only EXECUTE would have required rewriting several
     tests. Judged safe because each function enforces `owner_user_id =
     app.current_actor_user_id()` internally — no IDOR regardless of caller role. Judged this still
     qualifies as "the small function wrapper," not a broad rewrite, per Coordinator's own escalation
     condition — but call it out explicitly for review rather than let it pass silently.
6. Report to Coordinator via `herdr-pane-message` (resolve label fresh) with PR link, VF_EXIT/
   AUDIT_EXIT, branch sha, Fable 5 flag, deferred followup, and the app_runtime grant scope note.
   Then **stop** — no merge/board/close.

## Traps already hit this run (don't re-trip them)

- `foundation.test.ts` asserts the FULL migration list with `toEqual` — new migrations need a row
  added or the suite breaks latently (not caught by focused module tests).
- Read-tool "stale content" warnings fired repeatedly on files edited earlier in the session —
  resolved by re-reading fresh before further edits; don't skip the reread when you see that warning.
- Never edit an applied/committed migration file — 0134 stays as-is; 0137 supersedes it via REVOKE.
