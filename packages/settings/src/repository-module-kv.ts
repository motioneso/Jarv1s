// Module KV repository (#918 Slice 2). Data-plane state, not admin configuration — no
// audit writer here (mirrors repository-module-credentials.ts's shape otherwise). RLS
// is the authorization layer: owner-only user rows, admin-only instance writes
// (migration 0154). Scope-shaped partial unique indexes rule out a plain
// .onConflict(columns) target, so writes are SELECT -> UPDATE-or-INSERT, same as
// repository-module-credentials.ts's upsert (see that file's docstring for the
// lost-race justification).
import { randomUUID } from "node:crypto";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

export interface ModuleKvKey {
  readonly moduleId: string;
  readonly namespace: string;
  readonly scope: "instance" | "user";
  /** null for scope='instance'; the acting user's own id for scope='user'. */
  readonly ownerUserId: string | null;
  readonly key: string;
}

export async function getModuleKvValue(
  scopedDb: DataContextDb,
  k: ModuleKvKey
): Promise<Record<string, unknown> | null> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("value")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where("owner_user_id", k.ownerUserId === null ? "is" : "=", k.ownerUserId as never)
    .where("key", "=", k.key)
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setModuleKvValue(
  scopedDb: DataContextDb,
  k: ModuleKvKey,
  value: Record<string, unknown>
): Promise<void> {
  assertDataContextDb(scopedDb);
  const existing = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("id")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where("owner_user_id", k.ownerUserId === null ? "is" : "=", k.ownerUserId as never)
    .where("key", "=", k.key)
    .executeTakeFirst();

  if (existing) {
    await scopedDb.db
      .updateTable("app.module_kv")
      .set({ value, updated_at: new Date() })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await scopedDb.db
      .insertInto("app.module_kv")
      .values({
        id: randomUUID(),
        module_id: k.moduleId,
        namespace: k.namespace,
        scope: k.scope,
        owner_user_id: k.ownerUserId,
        key: k.key,
        value
      })
      .execute();
  }
}

export async function deleteModuleKvKey(scopedDb: DataContextDb, k: ModuleKvKey): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .deleteFrom("app.module_kv")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where("owner_user_id", k.ownerUserId === null ? "is" : "=", k.ownerUserId as never)
    .where("key", "=", k.key)
    .executeTakeFirst();
  return (result.numDeletedRows ?? 0n) > 0n;
}

export async function listModuleKvKeys(
  scopedDb: DataContextDb,
  ns: Omit<ModuleKvKey, "key">
): Promise<string[]> {
  assertDataContextDb(scopedDb);
  const rows = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("key")
    .where("module_id", "=", ns.moduleId)
    .where("namespace", "=", ns.namespace)
    .where("scope", "=", ns.scope)
    .where("owner_user_id", ns.ownerUserId === null ? "is" : "=", ns.ownerUserId as never)
    .orderBy("key")
    .execute();
  return rows.map((r) => r.key);
}
