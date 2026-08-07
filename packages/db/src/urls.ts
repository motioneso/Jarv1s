import { resolveMossEnv } from "./env.js";

export const DEFAULT_JARVIS_DATABASE_NAME = "jarv1s";

export interface MossDatabaseUrls {
  readonly bootstrap: string;
  readonly migration: string;
  readonly app: string;
  readonly auth: string;
  readonly worker: string;
}

function getExplicitProductionUrl(env: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = resolveMossEnv(env, envVar);
  if (env.NODE_ENV === "production" && !value) {
    throw new Error(`${envVar} is required in production`);
  }
  return value;
}

export function getMossDatabaseUrls(env: NodeJS.ProcessEnv = process.env): MossDatabaseUrls {
  const host = resolveMossEnv(env, "JARVIS_PGHOST") ?? "localhost";
  const port = resolveMossEnv(env, "JARVIS_PGPORT") ?? "55433";
  // JARVIS_PGDATABASE is carved out: infra/backup-full.sh reads it directly on the host,
  // so it can't move behind this shim without breaking that script (see the Tier C carve-out
  // list). resolveMossEnv() passes carved-out names through unchanged, so this call is
  // future-proof if that ever changes, but today it's equivalent to env.JARVIS_PGDATABASE.
  const database = resolveMossEnv(env, "JARVIS_PGDATABASE") ?? DEFAULT_JARVIS_DATABASE_NAME;

  return {
    bootstrap:
      getExplicitProductionUrl(env, "JARVIS_BOOTSTRAP_DATABASE_URL") ??
      `postgres://postgres:postgres@${host}:${port}/${database}`,
    migration:
      getExplicitProductionUrl(env, "JARVIS_MIGRATION_DATABASE_URL") ??
      `postgres://jarvis_migration_owner:migration_password@${host}:${port}/${database}`,
    app:
      getExplicitProductionUrl(env, "JARVIS_APP_DATABASE_URL") ??
      `postgres://jarvis_app_runtime:app_password@${host}:${port}/${database}`,
    auth:
      getExplicitProductionUrl(env, "JARVIS_AUTH_DATABASE_URL") ??
      `postgres://jarvis_auth_runtime:auth_password@${host}:${port}/${database}`,
    worker:
      getExplicitProductionUrl(env, "JARVIS_WORKER_DATABASE_URL") ??
      `postgres://jarvis_worker_runtime:worker_password@${host}:${port}/${database}`
  };
}
