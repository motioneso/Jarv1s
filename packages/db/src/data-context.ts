import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import type { JarvisDatabase } from "./types.js";

export interface AccessContext {
  readonly actorUserId: string;
  readonly workspaceId?: string | null;
  readonly requestId?: string;
}

export const dataContextBrand: unique symbol = Symbol("DataContextDb");

export interface DataContextDb {
  readonly db: Transaction<JarvisDatabase>;
  readonly [dataContextBrand]: true;
}

export class DataContextRunner {
  constructor(private readonly rootDb: Kysely<JarvisDatabase>) {}

  async withDataContext<T>(
    accessContext: AccessContext,
    work: (scopedDb: DataContextDb) => Promise<T>
  ): Promise<T> {
    if (!accessContext.actorUserId) {
      throw new Error("withDataContext requires an actor user id");
    }

    return this.rootDb.transaction().execute(async (transaction) => {
      await setLocal(transaction, "app.actor_user_id", accessContext.actorUserId);
      await setLocal(transaction, "app.workspace_id", accessContext.workspaceId ?? "");
      await setLocal(transaction, "app.request_id", accessContext.requestId ?? randomUUID());

      return work({
        db: transaction,
        [dataContextBrand]: true
      });
    });
  }

  async unsafeSelectVisibleProbeIdsForTest(): Promise<string[]> {
    const rows = await this.rootDb
      .selectFrom("app.rls_probe_items")
      .select("id")
      .orderBy("id")
      .execute();

    return rows.map((row) => row.id);
  }
}

export function assertDataContextDb(value: unknown): asserts value is DataContextDb {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<DataContextDb>)[dataContextBrand] !== true
  ) {
    throw new Error("Repository access requires withDataContext");
  }
}

async function setLocal(
  transaction: Transaction<JarvisDatabase>,
  name: "app.actor_user_id" | "app.workspace_id" | "app.request_id",
  value: string
): Promise<void> {
  await sql`select set_config(${name}, ${value}, true)`.execute(transaction);
}
