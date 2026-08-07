-- #1444 (Moss rename, database half). Epic #1440.
--
-- Renames this module's two tables -- app.jarvis_action_audit_log and app.jarvis_error_log -- and
-- every dependent named object, to the moss_* naming. Ships in the same PR as the ai repository
-- code that queries them (packages/ai/src/repository.ts) and the settings data-export queries.
--
-- WHY THIS LIVES IN packages/ai/sql AND NOT infra/postgres/migrations:
-- scripts/migrate.ts runs the core migrations directory to completion FIRST, then each built-in
-- module's sql directory. A core migration therefore executes before packages/ai/sql/0127 and 0145
-- have ever created these tables, and aborts 42P01 on any database built from scratch. The rename
-- must be numbered after 0145 inside this module's own directory, where ordering is guaranteed.
--
-- Versions are globally unique across the core directory and every module directory
-- (scripts/migrate.ts asserts this), so 0183 is claimed here and nowhere else.
--
-- app.record_anonymous_error is SECURITY DEFINER and its BODY references app.jarvis_error_log,
-- but its own name contains no "jarv" -- ALTER TABLE RENAME does not rewrite prosrc, so leaving it
-- alone would fail only at the first call after the rename. All three affected functions are
-- CREATE OR REPLACE'd below with SECURITY DEFINER and search_path restated (both are cleared on
-- replace unless respecified); owner and EXECUTE grants are preserved because the signature is
-- unchanged.
--
-- No IF EXISTS guards: a guard would green CI while silently renaming nothing.
-- The four jarvis_* Postgres roles are out of scope and permanently frozen (issue #1461); no role
-- identifier appears below.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables (2)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE app.jarvis_action_audit_log RENAME TO moss_action_audit_log;
ALTER TABLE app.jarvis_error_log RENAME TO moss_error_log;

-- ---------------------------------------------------------------------------------------------
-- 2. Constraints (17) -- renaming a PRIMARY KEY or UNIQUE constraint also renames its backing index.
-- ---------------------------------------------------------------------------------------------

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
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_pkey TO moss_error_log_pkey;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_owner_user_id_fkey TO moss_error_log_owner_user_id_fkey;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_error_category_check TO moss_error_log_error_category_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_feature_check TO moss_error_log_feature_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_internal_summary_check TO moss_error_log_internal_summary_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_operation_check TO moss_error_log_operation_check;
ALTER TABLE app.moss_error_log RENAME CONSTRAINT jarvis_error_log_user_message_check TO moss_error_log_user_message_check;

-- ---------------------------------------------------------------------------------------------
-- 3. Standalone indexes (4) -- not backing a constraint, renamed directly.
-- ---------------------------------------------------------------------------------------------

ALTER INDEX app.jarvis_action_audit_log_owner_family_time_idx RENAME TO moss_action_audit_log_owner_family_time_idx;
ALTER INDEX app.jarvis_action_audit_log_owner_time_idx RENAME TO moss_action_audit_log_owner_time_idx;
ALTER INDEX app.jarvis_error_log_owner_feature_time_idx RENAME TO moss_error_log_owner_feature_time_idx;
ALTER INDEX app.jarvis_error_log_owner_time_idx RENAME TO moss_error_log_owner_time_idx;

-- ---------------------------------------------------------------------------------------------
-- 4. RLS policies (10) -- TO/USING/WITH CHECK clauses are unaffected; they resolve roles by OID.
-- ---------------------------------------------------------------------------------------------

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
