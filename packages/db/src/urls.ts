export const DEFAULT_JARVIS_DATABASE_NAME = "jarv1s";

export interface JarvisDatabaseUrls {
  readonly bootstrap: string;
  readonly migration: string;
  readonly app: string;
  readonly auth: string;
  readonly worker: string;
}

function getExplicitProductionUrl(env: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = env[envVar];
  if (env.NODE_ENV === "production" && !value) {
    throw new Error(`${envVar} is required in production`);
  }
  return value;
}

export function getJarvisDatabaseUrls(env: NodeJS.ProcessEnv = process.env): JarvisDatabaseUrls {
  const host = env.JARVIS_PGHOST ?? "localhost";
  const port = env.JARVIS_PGPORT ?? "55433";
  const database = env.JARVIS_PGDATABASE ?? DEFAULT_JARVIS_DATABASE_NAME;

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
