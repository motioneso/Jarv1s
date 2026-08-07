import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import { resolveMossEnv } from "./env.js";
import type { MossDatabase } from "./types.js";

const { Pool } = pg;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
}

export function createDatabase(options: DatabaseOptions): Kysely<MossDatabase> {
  return new Kysely<MossDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 4,
        connectionTimeoutMillis:
          options.connectionTimeoutMillis ??
          Number(resolveMossEnv(process.env, "JARVIS_DB_CONNECT_TIMEOUT_MS") ?? 5000)
      })
    })
  });
}
