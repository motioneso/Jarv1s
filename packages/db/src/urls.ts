export interface JarvisDatabaseUrls {
  readonly bootstrap: string;
  readonly migration: string;
  readonly app: string;
  readonly worker: string;
}

export function getJarvisDatabaseUrls(env: NodeJS.ProcessEnv = process.env): JarvisDatabaseUrls {
  const host = env.JARVIS_PGHOST ?? "localhost";
  const port = env.JARVIS_PGPORT ?? "55433";
  const database = env.JARVIS_PGDATABASE ?? "jarv1s";

  return {
    bootstrap:
      env.JARVIS_BOOTSTRAP_DATABASE_URL ??
      `postgres://postgres:postgres@${host}:${port}/${database}`,
    migration:
      env.JARVIS_MIGRATION_DATABASE_URL ??
      `postgres://jarvis_migration_owner:migration_password@${host}:${port}/${database}`,
    app:
      env.JARVIS_APP_DATABASE_URL ??
      `postgres://jarvis_app_runtime:app_password@${host}:${port}/${database}`,
    worker:
      env.JARVIS_WORKER_DATABASE_URL ??
      `postgres://jarvis_worker_runtime:worker_password@${host}:${port}/${database}`
  };
}
