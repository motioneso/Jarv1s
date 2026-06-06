import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { SpikeDatabase } from "./types.js";

const { Pool } = pg;

export interface DatabaseOptions {
  connectionString: string;
  maxConnections?: number;
}

export function createDatabase(options: DatabaseOptions): Kysely<SpikeDatabase> {
  return new Kysely<SpikeDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 4
      })
    })
  });
}
