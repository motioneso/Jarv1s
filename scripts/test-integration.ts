export type DatabaseIsolationPlan =
  | { readonly mode: "passthrough" }
  | { readonly mode: "isolated"; readonly databaseName: string };

export function createDatabaseIsolationPlan(
  env: NodeJS.ProcessEnv,
  entropySuffix: string
): DatabaseIsolationPlan {
  if (env.JARVIS_PGDATABASE) {
    return { mode: "passthrough" };
  }

  return { mode: "isolated", databaseName: `jarvis_test_${entropySuffix}` };
}
