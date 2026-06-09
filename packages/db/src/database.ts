import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { JarvisDatabase } from "./types.js";

const { Pool } = pg;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
}

export function createDatabase(options: DatabaseOptions): Kysely<JarvisDatabase> {
  return new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 4,
        connectionTimeoutMillis:
          options.connectionTimeoutMillis ??
          Number(process.env.JARVIS_DB_CONNECT_TIMEOUT_MS ?? 5000)
      })
    })
  });
}
