-- Postgres-native memory graph substrate (#528).
-- Owner-scoped tables; all access goes through app.current_actor_user_id() RLS.

CREATE TABLE IF NOT EXISTS app.memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'person',
    'project',
    'preference',
    'goal',
    'constraint',
    'decision',
    'topic',
    'place',
    'organization',
    'self'
  )),
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'merged')),
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0.00 AND 1.00),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_entities_one_self_per_owner_idx
  ON app.memory_entities (owner_user_id)
  WHERE kind = 'self';

CREATE INDEX IF NOT EXISTS memory_entities_owner_status_idx
  ON app.memory_entities (owner_user_id, status, kind);

CREATE TABLE IF NOT EXISTS app.memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_entity_id UUID NOT NULL,
  predicate TEXT NOT NULL CHECK (predicate IN (
    'prefers',
    'works_on',
    'has_goal',
    'has_constraint',
    'decided',
    'related_to',
    'owes',
    'waiting_on',
    'mentioned_in',
    'alias_of'
  )),
  object_entity_id UUID,
  object_text TEXT,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.60 CHECK (confidence BETWEEN 0.00 AND 1.00),
  provenance TEXT NOT NULL DEFAULT 'inferred' CHECK (
    provenance IN ('volunteered', 'inferred', 'confirmed', 'imported')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'rejected')),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  last_confirmed_at TIMESTAMPTZ,
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0.00 AND 1.00),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((object_entity_id IS NULL) <> (object_text IS NULL)),
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, subject_entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, object_entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_facts_owner_status_idx
  ON app.memory_facts (owner_user_id, status, pinned, importance);

CREATE INDEX IF NOT EXISTS memory_facts_subject_idx
  ON app.memory_facts (owner_user_id, subject_entity_id);

CREATE TABLE IF NOT EXISTS app.memory_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'chat',
    'note',
    'task',
    'email',
    'calendar',
    'manual'
  )),
  source_ref TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ,
  excerpt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, id)
);

CREATE INDEX IF NOT EXISTS memory_episodes_owner_kind_idx
  ON app.memory_episodes (owner_user_id, source_kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS app.memory_fact_sources (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  fact_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, fact_id, episode_id),
  FOREIGN KEY (owner_user_id, fact_id)
    REFERENCES app.memory_facts(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, episode_id)
    REFERENCES app.memory_episodes(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.memory_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  ambiguous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id, entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_aliases_owner_unambiguous_idx
  ON app.memory_aliases (owner_user_id, normalized_alias)
  WHERE ambiguous = false;

CREATE TABLE IF NOT EXISTS app.memory_search_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('entity', 'fact', 'episode')),
  target_id UUID NOT NULL,
  search_text TEXT NOT NULL,
  embedding vector(768),
  embed_model_name TEXT,
  embed_model_version TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS memory_search_documents_owner_status_idx
  ON app.memory_search_documents (owner_user_id, status, target_kind);

CREATE INDEX IF NOT EXISTS memory_search_documents_embedding_idx
  ON app.memory_search_documents USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.memory_legacy_fact_migrations (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  legacy_fact_id UUID NOT NULL REFERENCES app.chat_memory_facts(id) ON DELETE CASCADE,
  memory_fact_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, legacy_fact_id),
  FOREIGN KEY (owner_user_id, memory_fact_id)
    REFERENCES app.memory_facts(owner_user_id, id) ON DELETE CASCADE
);

ALTER TABLE app.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_entities_owner ON app.memory_entities;
CREATE POLICY memory_entities_owner ON app.memory_entities
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_facts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_facts_owner ON app.memory_facts;
CREATE POLICY memory_facts_owner ON app.memory_facts
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_episodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_episodes_owner ON app.memory_episodes;
CREATE POLICY memory_episodes_owner ON app.memory_episodes
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_fact_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_fact_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_fact_sources_owner ON app.memory_fact_sources;
CREATE POLICY memory_fact_sources_owner ON app.memory_fact_sources
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_aliases_owner ON app.memory_aliases;
CREATE POLICY memory_aliases_owner ON app.memory_aliases
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_search_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_search_documents_owner ON app.memory_search_documents;
CREATE POLICY memory_search_documents_owner ON app.memory_search_documents
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

ALTER TABLE app.memory_legacy_fact_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_legacy_fact_migrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_legacy_fact_migrations_owner ON app.memory_legacy_fact_migrations;
CREATE POLICY memory_legacy_fact_migrations_owner ON app.memory_legacy_fact_migrations
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_entities TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_facts TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_episodes TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_fact_sources TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_aliases TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_search_documents TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_legacy_fact_migrations TO jarvis_app_runtime, jarvis_worker_runtime;

INSERT INTO app.memory_entities (owner_user_id, kind, name, summary)
SELECT DISTINCT owner_user_id, 'self', 'Self', 'Owner self memory root'
FROM app.chat_memory_facts
WHERE status = 'active'
ON CONFLICT (owner_user_id) WHERE kind = 'self' DO NOTHING;

DO $$
DECLARE
  legacy RECORD;
  self_entity_id UUID;
  new_fact_id UUID;
  new_episode_id UUID;
  mapped_predicate TEXT;
  mapped_source_kind TEXT;
  mapped_source_ref TEXT;
BEGIN
  FOR legacy IN
    SELECT f.*
    FROM app.chat_memory_facts f
    LEFT JOIN app.memory_legacy_fact_migrations m
      ON m.owner_user_id = f.owner_user_id
     AND m.legacy_fact_id = f.id
    WHERE f.status = 'active'
      AND m.legacy_fact_id IS NULL
    ORDER BY f.created_at, f.id
  LOOP
    SELECT id INTO self_entity_id
    FROM app.memory_entities
    WHERE owner_user_id = legacy.owner_user_id
      AND kind = 'self';

    mapped_predicate := CASE legacy.category
      WHEN 'preference' THEN 'prefers'
      WHEN 'goal' THEN 'has_goal'
      WHEN 'profile' THEN 'related_to'
      ELSE 'related_to'
    END;
    mapped_source_kind := CASE WHEN legacy.source_thread_id IS NULL THEN 'manual' ELSE 'chat' END;
    mapped_source_ref := COALESCE(
      legacy.source_thread_id::text,
      'legacy-chat-memory-fact:' || legacy.id::text
    );

    INSERT INTO app.memory_facts (
      owner_user_id,
      subject_entity_id,
      predicate,
      object_text,
      confidence,
      provenance,
      importance,
      created_at,
      updated_at
    )
    VALUES (
      legacy.owner_user_id,
      self_entity_id,
      mapped_predicate,
      legacy.content,
      0.70,
      legacy.provenance::text,
      legacy.importance,
      legacy.created_at,
      legacy.updated_at
    )
    RETURNING id INTO new_fact_id;

    INSERT INTO app.memory_episodes (
      owner_user_id,
      source_kind,
      source_ref,
      source_label,
      occurred_at,
      excerpt,
      created_at
    )
    VALUES (
      legacy.owner_user_id,
      mapped_source_kind,
      mapped_source_ref,
      'Legacy chat memory fact',
      legacy.created_at,
      legacy.content,
      legacy.created_at
    )
    RETURNING id INTO new_episode_id;

    INSERT INTO app.memory_fact_sources (owner_user_id, fact_id, episode_id)
    VALUES (legacy.owner_user_id, new_fact_id, new_episode_id);

    INSERT INTO app.memory_legacy_fact_migrations (owner_user_id, legacy_fact_id, memory_fact_id)
    VALUES (legacy.owner_user_id, legacy.id, new_fact_id)
    ON CONFLICT (owner_user_id, legacy_fact_id) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO app.memory_search_documents (owner_user_id, target_kind, target_id, search_text)
SELECT owner_user_id, 'entity', id, concat_ws(' ', name, summary)
FROM app.memory_entities
ON CONFLICT (owner_user_id, target_kind, target_id) DO NOTHING;

INSERT INTO app.memory_search_documents (owner_user_id, target_kind, target_id, search_text)
SELECT owner_user_id, 'fact', id, object_text
FROM app.memory_facts
WHERE object_text IS NOT NULL
ON CONFLICT (owner_user_id, target_kind, target_id) DO NOTHING;

INSERT INTO app.memory_search_documents (owner_user_id, target_kind, target_id, search_text)
SELECT owner_user_id, 'episode', id, excerpt
FROM app.memory_episodes
WHERE excerpt <> ''
ON CONFLICT (owner_user_id, target_kind, target_id) DO NOTHING;
