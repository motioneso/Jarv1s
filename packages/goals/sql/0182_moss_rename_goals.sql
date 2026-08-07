-- #1444 (Moss rename, database half). Epic #1440.
--
-- Renames this module's two tables -- app.jarvis_goals and app.jarvis_goal_evidence -- and every
-- dependent named object, to the moss_* naming. Ships in the same PR as the goals repository code
-- that queries them (packages/goals/src/repository.ts) and the settings data-export queries that
-- read them cross-module, so the rename and its callers deploy together.
--
-- WHY THIS LIVES IN packages/goals/sql AND NOT infra/postgres/migrations:
-- scripts/migrate.ts runs the core migrations directory to completion FIRST, then each built-in
-- module's sql directory. A core migration therefore executes before packages/goals/sql/0123 has
-- ever created these tables, and aborts 42P01 on any database built from scratch. The rename must
-- be numbered after 0123 inside this module's own directory, where ordering is guaranteed.
--
-- Versions are globally unique across the core directory and every module directory
-- (scripts/migrate.ts asserts this), so 0182 is claimed here and nowhere else.
--
-- No IF EXISTS guards: a guard would green CI while silently renaming nothing.
-- The four jarvis_* Postgres roles are out of scope and permanently frozen (issue #1461); no role
-- identifier appears below.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables (2)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE app.jarvis_goals RENAME TO moss_goals;
ALTER TABLE app.jarvis_goal_evidence RENAME TO moss_goal_evidence;

-- ---------------------------------------------------------------------------------------------
-- 2. Constraints (18) -- renaming a PRIMARY KEY or UNIQUE constraint also renames its backing index.
-- ---------------------------------------------------------------------------------------------

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
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_pkey TO moss_goal_evidence_pkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_owner_user_id_fkey TO moss_goal_evidence_owner_user_id_fkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_owner_user_id_goal_id_fkey TO moss_goal_evidence_owner_user_id_goal_id_fkey;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_evidence_kind_check TO moss_goal_evidence_evidence_kind_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_source_kind_check TO moss_goal_evidence_source_kind_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_source_label_check TO moss_goal_evidence_source_label_check;
ALTER TABLE app.moss_goal_evidence RENAME CONSTRAINT jarvis_goal_evidence_summary_check TO moss_goal_evidence_summary_check;

-- ---------------------------------------------------------------------------------------------
-- 3. Standalone indexes (1) -- not backing a constraint, renamed directly.
-- ---------------------------------------------------------------------------------------------

ALTER INDEX app.jarvis_goal_evidence_owner_goal_idx RENAME TO moss_goal_evidence_owner_goal_idx;

-- ---------------------------------------------------------------------------------------------
-- 4. RLS policies (5) -- TO/USING/WITH CHECK clauses are unaffected; they resolve roles by OID.
-- ---------------------------------------------------------------------------------------------

ALTER POLICY jarvis_goals_rw ON app.moss_goals RENAME TO moss_goals_rw;
ALTER POLICY jarvis_goals_worker_ro ON app.moss_goals RENAME TO moss_goals_worker_ro;
ALTER POLICY jarvis_goals_worker_upd ON app.moss_goals RENAME TO moss_goals_worker_upd;
ALTER POLICY jarvis_goal_evidence_rw ON app.moss_goal_evidence RENAME TO moss_goal_evidence_rw;
ALTER POLICY jarvis_goal_evidence_worker_ro ON app.moss_goal_evidence RENAME TO moss_goal_evidence_worker_ro;

-- ---------------------------------------------------------------------------------------------
-- 5. Trigger (1) and its function (1) -- two distinct catalog objects sharing one name.
-- ---------------------------------------------------------------------------------------------

ALTER TRIGGER jarvis_goals_updated_at ON app.moss_goals RENAME TO moss_goals_updated_at;
ALTER FUNCTION app.jarvis_goals_updated_at() RENAME TO moss_goals_updated_at;
