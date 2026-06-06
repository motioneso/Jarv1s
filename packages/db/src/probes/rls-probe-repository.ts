import type { DataContextDb } from "../data-context.js";
import { assertDataContextDb } from "../data-context.js";
import type { RlsProbeItem } from "../types.js";

export class RlsProbeRepository {
  async listVisible(scopedDb: DataContextDb): Promise<RlsProbeItem[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db.selectFrom("app.rls_probe_items").selectAll().orderBy("id").execute();
  }

  async getById(scopedDb: DataContextDb, itemId: string): Promise<RlsProbeItem | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.rls_probe_items")
      .selectAll()
      .where("id", "=", itemId)
      .executeTakeFirst();
  }
}
