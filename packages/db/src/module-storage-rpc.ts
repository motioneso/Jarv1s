// Slice 4 (#914), spec D5: the ONLY database surface a module's own code ever gets. Runs every
// query under SET LOCAL ROLE jarvis_mod_<slug>_runtime inside the caller's existing DataContextDb
// transaction, so the module inherits the actor-scoped GUCs (app.actor_user_id / app.request_id)
// already set by withDataContext, and RLS narrows every query to owner_user_id = that actor —
// exactly as if the module had written its own repository against the parent runtime role, minus
// the ability to ever touch a table it wasn't granted.
import { CompiledQuery, sql } from "kysely";

import type { DataContextDb } from "./data-context.js";
import { moduleRuntimeRoleName } from "./module-role-broker.js";

export interface ModuleQueryResult<T> {
  readonly rows: readonly T[];
}

export interface ModuleStorageRpc {
  query<T = Record<string, unknown>>(
    queryText: string,
    params?: readonly unknown[]
  ): Promise<ModuleQueryResult<T>>;
}

export function createModuleStorageRpc(
  scopedDb: DataContextDb,
  moduleId: string
): ModuleStorageRpc {
  const role = moduleRuntimeRoleName(moduleId);
  return {
    async query<T>(
      queryText: string,
      params: readonly unknown[] = []
    ): Promise<ModuleQueryResult<T>> {
      await sql.raw(`SET LOCAL ROLE ${role}`).execute(scopedDb.db);
      const result = await scopedDb.db.executeQuery<T>(CompiledQuery.raw(queryText, [...params]));
      return { rows: result.rows };
    }
  };
}
