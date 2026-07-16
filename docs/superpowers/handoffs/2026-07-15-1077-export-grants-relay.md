# Relay — #1077 export worker grants audit (r2)

## Authority and scope

- Approved spec: `docs/superpowers/specs/2026-07-15-1077-export-worker-grants.md`.
- Coordinator: exact label `UX Coordinator`, session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed` (pane `w1:pPP`, confirmed unique via `herdr pane list`).
- Branch/worktree: `ux/1077-export-grants` in
  `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`. Tree clean except pre-existing unrelated
  `.claude/context-meter.log` mod — do not stage/commit that file, it's not part of this task.
- Security tier. **No implementation edits made yet — audit only, per plan-approval gate.**
- Codebase-memory graph tools (`search_graph`/`trace_path`/etc.) not exposed as callable tools
  this session either — used literal/source + live-DB ground truth fallback (see below).

## Audit — COMPLETE, ground-truthed against live dev Postgres

Export surface = `packages/settings/src/data-export.ts` `readExportTables()`, queries in
`packages/settings/src/data-export-queries.ts`. Confirmed 38 distinct `app.*` tables read via
`scopedDb.db` (role `jarvis_worker_runtime`) — excludes `auth_accounts`/`better_auth_sessions`
(read via separate `authDb`/`jarvis_auth_runtime`, out of scope) and `wellness_checkins` /
`wellness_therapy_notes` / news-personalization rows (read through each module's own
`dataLifecycle.exportSections` collector under its own module runtime role — already has its own
grants, e.g. `packages/wellness/sql/0139_wellness_worker_read_policies.sql`).

Method: queried live `jarv1s-postgres` container (docker exec psql, port 55433) directly —
`has_table_privilege('jarvis_worker_runtime', 'app.<t>', 'SELECT')` +
`pg_policies` filtered to `'jarvis_worker_runtime'=ANY(roles) AND cmd IN ('SELECT','ALL')` — for
all 38 tables. This is ground truth (live grants/policies), not a migration-file grep.

**Confirmed gaps (exactly 4 — matches r1's finding, audit found NO additional gaps):**

| table | has_select_grant | worker_select_policy |
|---|---|---|
| `app.notification_reads` | false | 0 |
| `app.entities` | false | 0 |
| `app.ai_assistant_action_requests` | false | 0 |
| `app.jarvis_action_audit_log` | false | 0 |

**Confirmed already covered (34 tables, grant=true + exactly 1 worker SELECT/ALL policy each):**
`users`, `tasks`, `task_activity`, `notifications`, `connector_accounts`, `module_credentials`,
`module_kv`, `calendar_events`, `email_messages`, `ai_provider_configs`, `ai_configured_models`,
`chat_threads`, `chat_messages`, `briefing_definitions`, `briefing_runs`, `memory_chunks`,
`chat_memory_facts`, `memory_entities`, `memory_facts`, `memory_episodes`, `memory_fact_sources`,
`memory_aliases`, `memory_conflict_groups`, `memory_candidates`, `memory_search_documents`,
`memory_legacy_fact_migrations`, `commitments`, `preferences`, `usefulness_feedback_signals`,
`usefulness_feedback_targets`, `medications`, `medication_logs`, `jarvis_goals`,
`jarvis_goal_evidence`. Do not touch these.

## Exact predicates to mirror for the 4 gaps (pulled live from each table's existing
`jarvis_app_runtime` SELECT policy — spec requires an exact mirror, not a new stricter predicate)

```sql
-- notification_reads (spec explicitly requires BOTH clauses retained)
(app.current_actor_user_id() IS NOT NULL)
  AND (user_id = app.current_actor_user_id())
  AND (EXISTS (SELECT 1 FROM app.notifications visible_notification
               WHERE visible_notification.id = notification_reads.notification_id))

-- entities (mirrors app_runtime's owner-or-share predicate exactly — export's own WHERE
-- owner_user_id=userId already restricts rows read; do not narrow it to owner-only-only,
-- spec says "exactly mirrors", not "tightens")
(owner_user_id = app.current_actor_user_id()) OR app.has_share('entity'::text, id, 'view'::text)

-- ai_assistant_action_requests
(app.current_actor_user_id() IS NOT NULL) AND (owner_user_id = app.current_actor_user_id())

-- jarvis_action_audit_log
(app.current_actor_user_id() IS NOT NULL) AND (owner_user_id = app.current_actor_user_id())
```

Owning module dirs for the new migrations (module-local `sql/`, next global number, currently
**0166** as of this checkout — confirmed both local branch and `origin/main` top out at `0165`;
**re-verify immediately before authoring**, another lane may have claimed 0166 since):
- `notification_reads` → `packages/notifications/sql/`
- `entities` → likely `packages/structured-state/sql/` (where `entities-repository.ts` lives) —
  confirm exact owning module before authoring, not yet verified which package's `sql/` dir owns
  `app.entities`'s existing migrations (check `packages/structured-state/sql/*entit*` or
  `infra/postgres/migrations/0001_app_schema.sql`/`0002_app_rls.sql` for original table origin,
  then follow existing precedent of where later entities policies were added).
- `ai_assistant_action_requests` → `packages/ai/sql/` (pattern: `0037_ai_worker_read_grants.sql`)
- `jarvis_action_audit_log` → likely `packages/ai/sql/` or a dedicated audit-log module — same
  "confirm owning dir" caveat as entities.

GRANT only `SELECT` (never INSERT/UPDATE/DELETE/BYPASSRLS) + `CREATE POLICY ... FOR SELECT TO
jarvis_worker_runtime USING (<predicate above>)`, one migration per confirmed gap or bundled —
follow the module's existing per-table-worker-grant precedent (e.g.
`packages/memory/sql/0054_worker_memory_rls.sql` for the `DROP POLICY IF EXISTS` + `CREATE POLICY`
idiom used throughout this repo).

## Out-of-scope finding (flag to coordinator, DO NOT FIX under #1077)

`app.task_activity`'s existing `task_activity_select` RLS policy (shared by BOTH
`jarvis_app_runtime` and `jarvis_worker_runtime`, pre-existing, not introduced by this ticket) only
checks `EXISTS (SELECT 1 FROM app.tasks parent_task WHERE parent_task.id = task_activity.task_id)`
— it does **not** check `parent_task.owner_user_id = app.current_actor_user_id()`. That means, in
principle, any authenticated actor's `app_runtime`/`worker_runtime` query against
`task_activity` directly (not through `export.build`'s own join-and-filter SQL) could read
**any user's** task activity rows, since the policy only requires the referenced task to exist at
all, not to be owned by the actor. Export itself is not exposed to this (its own SQL joins
`task.owner_user_id = userId`), so it doesn't affect the #1077 exit criteria, but it's a real
latent cross-user read gap unrelated to worker grants — outside the locked scope's "confirmed gap ⇒
missing grant" definition and explicitly barred by the spec's non-goal ("do not change owner
predicates"). Reported here, not touched. Recommend a separate ticket.

## Remaining plan work (spec section "Verification")

1. **Not yet started.** Write the smallest TDD plan (`superpowers:writing-plans` →
   `docs/superpowers/plans/2026-07-15-<slug>.md`) covering:
   - integration test that populates all 38 worker-scoped export tables (+ auth/module-section
     tables already covered) and proves `export.build`/`exportUserData` completes for the owning
     account without a permission error;
   - negative test: `jarvis_worker_runtime` can `SELECT` the 4 newly-granted tables but still
     cannot `INSERT`/`UPDATE`/`DELETE` them;
   - policy-exactness test: the 4 new worker SELECT policies produce identical visible rows to the
     existing owner-visible (`jarvis_app_runtime`) predicate for the same actor (i.e., mirror
     verified, not just "some" policy);
   - migration inventory/hash expectations updated in whichever test enumerates the full migration
     list with `toEqual` (see `foundation.test.ts` per `[[migration-invariants]]` memory — add every
     new migration's row or it breaks latently).
2. **Send the compact plan pointer to the coordinator (`UX Coordinator`, pane `w1:pPP`) for
   approval before writing any code** — this has not happened yet, do it as the very next step.
3. Build under TDD, one commit per task, `Co-Authored-By: Claude` trailer.
4. Defer failure-handler transaction hardening (`worker_fail_data_export_job`) and all unrelated
   cleanup — explicit non-goal.
5. Close out via `coordinated-wrap-up` — PR + report only, no merge/board/QA (coordinator's job).

## Context checkpoint

Relayed at ~64% context per instruction ("At 65% checkpoint and request manual relay; never enter
compaction"). No implementation edits made — audit + this handoff doc only. Requesting **manual**
successor spawn from `UX Coordinator` rather than self-spawning via the `relay` skill's automatic
successor mechanism, per explicit task instruction.
