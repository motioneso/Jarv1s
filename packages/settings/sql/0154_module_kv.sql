-- Module KV storage (#918, Open module system Slice 2). Plain module data,
-- never secrets (secrets go in app.module_credentials). No module code can
-- reach this table until Slice 3's ctx.kv RPC — Slice 2 writes happen only
-- through platform code. 'user' rows cascade-delete with the user; 'instance'
-- rows are shared instance state.

CREATE TABLE IF NOT EXISTS app.module_kv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id text NOT NULL,
  namespace text NOT NULL,
  scope text NOT NULL CONSTRAINT module_kv_scope_ck CHECK (scope IN ('instance', 'user')),
  owner_user_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  key text NOT NULL CONSTRAINT module_kv_key_ck CHECK (char_length(key) BETWEEN 1 AND 512),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_kv_scope_owner_ck CHECK (
    (scope = 'instance' AND owner_user_id IS NULL)
    OR (scope = 'user' AND owner_user_id IS NOT NULL)
  ),
  -- Guard against unbounded values long before Slice 3 exposes writes to modules.
  CONSTRAINT module_kv_value_size_ck CHECK (octet_length(value::text) <= 65536)
);

CREATE UNIQUE INDEX IF NOT EXISTS module_kv_instance_uq
  ON app.module_kv (module_id, namespace, key)
  WHERE scope = 'instance';
CREATE UNIQUE INDEX IF NOT EXISTS module_kv_user_uq
  ON app.module_kv (module_id, namespace, owner_user_id, key)
  WHERE scope = 'user';

ALTER TABLE app.module_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_kv FORCE ROW LEVEL SECURITY;

-- Reads: user rows owner-only; instance rows readable by any authenticated actor
-- (shared instance state is the point of the scope).
DROP POLICY IF EXISTS module_kv_select ON app.module_kv;
CREATE POLICY module_kv_select ON app.module_kv
  FOR SELECT TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR scope = 'instance'
  );

-- Writes: user rows owner-only; instance rows admin-only in Slice 2 (fail-closed —
-- no consumer exists yet; Slice 3's RPC design may relax this via a NEW policy
-- migration, never by editing this one).
DROP POLICY IF EXISTS module_kv_insert ON app.module_kv;
CREATE POLICY module_kv_insert ON app.module_kv
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_kv_update ON app.module_kv;
CREATE POLICY module_kv_update ON app.module_kv
  FOR UPDATE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  )
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_kv_delete ON app.module_kv;
CREATE POLICY module_kv_delete ON app.module_kv
  FOR DELETE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

-- Real DELETE grant (per-key deletes are a KV primitive) — this is why module_kv
-- is NOT in scripts/audit-release-hardening.ts's protectedTables.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_kv TO jarvis_app_runtime;
-- No jarvis_worker_runtime grant (same rationale as module_credentials).
