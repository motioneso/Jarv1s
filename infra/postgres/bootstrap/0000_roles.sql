DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvis_migration_owner') THEN
    CREATE ROLE jarvis_migration_owner LOGIN PASSWORD 'migration_password';
  ELSE
    ALTER ROLE jarvis_migration_owner WITH LOGIN PASSWORD 'migration_password';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvis_app_runtime') THEN
    CREATE ROLE jarvis_app_runtime LOGIN PASSWORD 'app_password';
  ELSE
    ALTER ROLE jarvis_app_runtime WITH LOGIN PASSWORD 'app_password';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvis_worker_runtime') THEN
    CREATE ROLE jarvis_worker_runtime LOGIN PASSWORD 'worker_password';
  ELSE
    ALTER ROLE jarvis_worker_runtime WITH LOGIN PASSWORD 'worker_password';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvis_auth_runtime') THEN
    CREATE ROLE jarvis_auth_runtime LOGIN PASSWORD 'auth_password';
  ELSE
    ALTER ROLE jarvis_auth_runtime WITH LOGIN PASSWORD 'auth_password';
  END IF;
END
$$;

ALTER ROLE jarvis_migration_owner WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

ALTER ROLE jarvis_app_runtime WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

ALTER ROLE jarvis_worker_runtime WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

ALTER ROLE jarvis_auth_runtime WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO jarvis_migration_owner, jarvis_app_runtime, jarvis_worker_runtime, jarvis_auth_runtime',
    current_database()
  );
  EXECUTE format('GRANT CREATE ON DATABASE %I TO jarvis_migration_owner', current_database());
END
$$;

-- Allow the migration role to SET LOCAL ROLE jarvis_auth_runtime so migration 0045 can
-- create SECURITY DEFINER functions owned by jarvis_auth_runtime (which has the USING(true)
-- RLS policy on users required for app.count_all_users() to work).
GRANT jarvis_auth_runtime TO jarvis_migration_owner;
