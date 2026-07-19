// external-modules/finance/src/worker/store.ts
// FIN-06b (#1166 F6-D4): the ONLY dual-read point in the module. Everything
// else asks the selector and gets one store for the whole invocation.
import { kvStore, sqlStore, type FinanceDb, type FinanceStore } from "../domain/index.js";
import { NS, type FinanceKv } from "../domain/kv-port.js";

export const MIGRATED_MARKER_KEY = "storage:migrated";

export function storeSelector(
  kv: FinanceKv,
  db: FinanceDb | undefined
): () => Promise<FinanceStore> {
  let selected: Promise<FinanceStore> | undefined;
  return () => {
    selected ??= (async () => {
      // Older hosts have no ctx.db — stay on KV regardless of the marker so
      // a marked owner still degrades to their (already deleted) KV... which
      // is why the marker is only written by the migrate handler AFTER it has
      // confirmed db access: marker implies db existed at migrate time.
      if (db === undefined) return kvStore(kv);
      const marker = await kv.get(NS.meta, MIGRATED_MARKER_KEY);
      return marker ? sqlStore(db) : kvStore(kv);
    })();
    return selected;
  };
}
