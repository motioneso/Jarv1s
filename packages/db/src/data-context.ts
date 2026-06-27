import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import type { JarvisDatabase } from "./types.js";

export interface AccessContext {
  readonly actorUserId: string;
  readonly requestId?: string;
}

// The RLS principal is injected into the `app.actor_user_id` GUC, which every RLS policy
// reads back as `current_setting('app.actor_user_id')::uuid`. A non-UUID value would surface
// as a `22P02 invalid_text_representation` deep inside an unrelated query (failing open in
// confusing ways), so we shape-check the actor id here — the single RLS injection point —
// before it ever reaches `set_config`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

export const dataContextBrand: unique symbol = Symbol("DataContextDb");

export interface DataContextDb {
  readonly db: Transaction<JarvisDatabase>;
  readonly [dataContextBrand]: true;
}

/**
 * A scoped key/value preferences accessor over a DataContextDb. The single shared
 * shape for "read/write a user's stored preference blob" — features alias this rather
 * than re-declaring the same two methods (e.g. ProfilePreferencesPort in @jarv1s/settings,
 * SourceBehaviorPreferencesPort in @jarv1s/source-behaviors).
 */
export interface PreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  getWithMetadata<T>(scopedDb: DataContextDb, key: string): Promise<{ value: T; updatedAt: Date } | null>;
  upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
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
    assertUuid(accessContext.actorUserId, "withDataContext actor user id");

    return this.rootDb.transaction().execute(async (transaction) => {
      await setLocal(transaction, "app.actor_user_id", accessContext.actorUserId);
      await setLocal(transaction, "app.request_id", accessContext.requestId ?? randomUUID());

      return work({
        db: transaction,
        [dataContextBrand]: true
      });
    });
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
  name: "app.actor_user_id" | "app.request_id",
  value: string
): Promise<void> {
  await sql`select set_config(${name}, ${value}, true)`.execute(transaction);
}
