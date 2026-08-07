-- #1444 (Moss rename, database half). Plan:
-- docs/superpowers/plans/2026-08-06-moss-1444-database-cutover.md §3.4, §1.2.
--
-- DO NOT MERGE ALONE: this migration lands only in the #1444 cutover window, together with the
-- database rename jarv1s -> moss and the accompanying config/image changes. The currently
-- deployed app still queries these tables by their old names, so merging this alone breaks it.
--
-- The four Postgres roles (jarvis_*) are not renamed by this migration or by any other change in
-- scope for #1444 -- they stay jarvis_* permanently. No role identifier appears below, and that
-- is a permanent property of this file, not a timing accident.
--
-- Renames the four app.jarvis_* tables and every dependent named object enumerated from the live
-- catalogue (pg_indexes / pg_constraint / pg_policies / pg_trigger / pg_proc), plus CREATE OR
-- REPLACE for the three functions whose *bodies* reference a renamed table by literal name.
--
-- `app.record_anonymous_error` is SECURITY DEFINER and its body references app.jarvis_error_log,
-- but its own name contains no "jarv" — ALTER TABLE RENAME does not rewrite prosrc, so leaving it
-- alone would only fail at the first call after cutover. All three affected functions are
-- CREATE OR REPLACE'd here with SECURITY DEFINER, search_path and owner unchanged (CREATE OR
-- REPLACE preserves ownership and grants when the signature does not change; renaming likewise
-- does not touch ACLs).
--
-- One extra object beyond the plan's 62-count catalogue: the trigger function
-- app.jarvis_goals_updated_at() is a distinct pg_proc row from the app.jarvis_goals trigger of the
-- same name (trigger and function share one string but live in different catalogs). Its body has
-- no jarv reference, so it only needs a rename, not a CREATE OR REPLACE. 63 named objects total.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables (4)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE app.jarvis_goals RENAME TO moss_goals;
ALTER TABLE app.jarvis_goal_evidence RENAME TO moss_goal_evidence;
ALTER TABLE app.jarvis_action_audit_log RENAME TO moss_action_audit_log;
ALTER TABLE app.jarvis_error_log RENAME TO moss_error_log;

-- ---------------------------------------------------------------------------------------------
-- 2. Constraints — renaming a PRIMARY KEY or UNIQUE constraint also renames its backing index.
--    (4 PK + 1 UNIQUE + 5 FK + 25 CHECK = 35 constraints)
-- ---------------------------------------------------------------------------------------------

-- app.moss_goals (PK 1, UNIQUE 1, FK 1, CHECK 8)
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_pkey TO moss_goals_pkey;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_owner_user_id_id_key TO moss_goals_owner_user_id_id_key;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_owner_user_id_fkey TO moss_goals_owner_user_id_fkey;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_blocker_summary_check TO moss_goals_blocker_summary_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_desired_outcome_check TO moss_goals_desired_outcome_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_last_progress_summary_check TO moss_goals_last_progress_summary_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_next_suggested_action_check TO moss_goals_next_suggested_action_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_priority_check TO moss_goals_priority_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_review_cadence_check TO moss_goals_review_cadence_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_status_check TO moss_goals_status_check;
ALTER TABLE app.moss_goals RENAME CONSTRAINT jarvis_goals_title_check TO moss_goals_title_check;

-- app.moss_goal_evidence (PK 1, FK 2, CHECK 4)
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_pkey TO moss_goal_evidence_pkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_owner_user_id_fkey TO moss_goal_evidence_owner_user_id_fkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_owner_user_id_goal_id_fkey TO moss_goal_evidence_owner_user_id_goal_id_fkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_evidence_kind_check TO moss_goal_evidence_evidence_kind_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_source_kind_check TO moss_goal_evidence_source_kind_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_source_label_check TO moss_goal_evidence_source_label_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_summary_check TO moss_goal_evidence_summary_check;

-- app.moss_action_audit_log (PK 1, FK 1, CHECK 8)
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_pkey TO moss_action_audit_log_pkey;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_owner_user_id_fkey TO moss_action_audit_log_owner_user_id_fkey;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_action_kind_check TO moss_action_audit_log_action_kind_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_approval_mode_check TO moss_action_audit_log_approval_mode_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_error_class_check TO moss_action_audit_log_error_class_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_input_summary_check TO moss_action_audit_log_input_summary_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_outcome_check TO moss_action_audit_log_outcome_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_source_surface_check TO moss_action_audit_log_source_surface_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_tool_module_id_check TO moss_action_audit_log_tool_module_id_check;
ALTER TABLE app.moss_action_audit_log RENAME CONSTRAINT jarvis_action_audit_log_tool_name_check TO moss_action_audit_log_tool_name_check;

-- app.moss_error_log (PK 1, FK 1, CHECK 5)
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_pkey TO moss_error_log_pkey;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_owner_user_id_fkey TO moss_error_log_owner_user_id_fkey;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_error_category_check TO moss_error_log_error_category_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_feature_check TO moss_error_log_feature_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_internal_summary_check TO moss_error_log_internal_summary_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_operation_check TO moss_error_log_operation_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_user_message_check TO moss_error_log_user_message_check;

-- ---------------------------------------------------------------------------------------------
-- 3. Standalone indexes (5) — not backing a constraint, renamed directly.
-- ---------------------------------------------------------------------------------------------

ALTER INDEX app.jarvis_goal_evidence_owner_goal_idx RENAME TO moss_goal_evidence_owner_goal_idx;
ALTER INDEX app.jarvis_action_audit_log_owner_family_time_idx RENAME TO moss_action_audit_log_owner_family_time_idx;
ALTER INDEX app.jarvis_action_audit_log_owner_time_idx RENAME TO moss_action_audit_log_owner_time_idx;
ALTER INDEX app.jarvis_error_log_owner_feature_time_idx RENAME TO moss_error_log_owner_feature_time_idx;
ALTER INDEX app.jarvis_error_log_owner_time_idx RENAME TO moss_error_log_owner_time_idx;

-- ---------------------------------------------------------------------------------------------
-- 4. RLS policies (15) — TO/USING/WITH CHECK clauses are unaffected; they resolve roles by OID.
-- ---------------------------------------------------------------------------------------------

ALTER POLICY jarvis_goals_rw ON app.moss_goals RENAME TO moss_goals_rw;
ALTER POLICY jarvis_goals_worker_ro ON app.moss_goals RENAME TO moss_goals_worker_ro;
ALTER POLICY jarvis_goals_worker_upd ON app.moss_goals RENAME TO moss_goals_worker_upd;

ALTER POLICY jarvis_goal_evidence_rw ON app.moss_goal_evidence RENAME TO moss_goal_evidence_rw;
ALTER POLICY jarvis_goal_evidence_worker_ro ON app.moss_goal_evidence RENAME TO moss_goal_evidence_worker_ro;

ALTER POLICY jarvis_action_audit_log_insert ON app.moss_action_audit_log RENAME TO moss_action_audit_log_insert;
ALTER POLICY jarvis_action_audit_log_maintenance_delete ON app.moss_action_audit_log RENAME TO moss_action_audit_log_maintenance_delete;
ALTER POLICY jarvis_action_audit_log_maintenance_select ON app.moss_action_audit_log RENAME TO moss_action_audit_log_maintenance_select;
ALTER POLICY jarvis_action_audit_log_select ON app.moss_action_audit_log RENAME TO moss_action_audit_log_select;

ALTER POLICY jarvis_error_log_insert ON app.moss_error_log RENAME TO moss_error_log_insert;
ALTER POLICY jarvis_error_log_maintenance_delete ON app.moss_error_log RENAME TO moss_error_log_maintenance_delete;
ALTER POLICY jarvis_error_log_maintenance_insert ON app.moss_error_log RENAME TO moss_error_log_maintenance_insert;
ALTER POLICY jarvis_error_log_maintenance_select ON app.moss_error_log RENAME TO moss_error_log_maintenance_select;
ALTER POLICY jarvis_error_log_select ON app.moss_error_log RENAME TO moss_error_log_select;
ALTER POLICY jarvis_error_log_worker_insert ON app.moss_error_log RENAME TO moss_error_log_worker_insert;

-- ---------------------------------------------------------------------------------------------
-- 5. Trigger (1) and its function — two distinct catalog objects sharing one name.
-- ---------------------------------------------------------------------------------------------

ALTER TRIGGER jarvis_goals_updated_at ON app.moss_goals RENAME TO moss_goals_updated_at;
ALTER FUNCTION app.jarvis_goals_updated_at() RENAME TO moss_goals_updated_at;

-- ---------------------------------------------------------------------------------------------
-- 6. Functions whose bodies reference a renamed table by literal name (3) — CREATE OR REPLACE
--    restates SECURITY DEFINER and search_path explicitly (both are cleared on replace unless
--    respecified); owner and existing EXECUTE grants are preserved automatically by Postgres
--    because the call signature does not change.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.purge_jarvis_action_audit_log(older_than timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.moss_action_audit_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

ALTER FUNCTION app.purge_jarvis_action_audit_log(timestamp with time zone) RENAME TO purge_moss_action_audit_log;

CREATE OR REPLACE FUNCTION app.purge_jarvis_error_log(older_than timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.moss_error_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

ALTER FUNCTION app.purge_jarvis_error_log(timestamp with time zone) RENAME TO purge_moss_error_log;

-- app.record_anonymous_error keeps its name (it never contained "jarv"); only its body changes.
CREATE OR REPLACE FUNCTION app.record_anonymous_error(event_id uuid, event_feature text, event_operation text, event_error_category text, event_retryable boolean, event_user_message text, event_internal_summary text, event_request_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
BEGIN
  INSERT INTO app.moss_error_log (
    id,
    owner_user_id,
    feature,
    operation,
    error_category,
    retryable,
    user_message,
    internal_summary,
    request_id
  )
  VALUES (
    event_id,
    NULL,
    event_feature,
    event_operation,
    event_error_category,
    event_retryable,
    event_user_message,
    event_internal_summary,
    event_request_id
  );
END;
$function$;
