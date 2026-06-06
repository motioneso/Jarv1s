import { PgBoss, type ConstructorOptions } from "pg-boss";

export const PGBOSS_SCHEMA = "pgboss";
export const RLS_PROBE_QUEUE = "rls-probe";

export interface RlsProbeJobPayload {
  actorUserId: string;
  workspaceId?: string | null;
  targetItemId: string;
}

export function createPgBoss(
  connectionString: string,
  overrides: Partial<ConstructorOptions> = {}
): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    schedule: false,
    supervise: false,
    migrate: false,
    createSchema: false,
    ...overrides
  });

  boss.on("error", (error) => {
    throw error;
  });

  return boss;
}
