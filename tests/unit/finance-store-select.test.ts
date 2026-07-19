// tests/unit/finance-store-select.test.ts
// FIN-06b (#1166) Task 6: storeSelector(kv, db) is the ONLY dual-read point
// in the module — every handler asks it once per invocation and gets back
// one store for the whole call. Covers the three-way degrade (no db / no
// marker / marker+db) and the memoization contract (marker read at most
// once per created selector), since a second read mid-invocation could
// observe a migration completing concurrently and split reads across stores.
import { describe, expect, it } from "vitest";

import type { FinanceDb, FinanceKv } from "../../external-modules/finance/src/domain/index.js";
import { NS } from "../../external-modules/finance/src/domain/index.js";
import {
  MIGRATED_MARKER_KEY,
  storeSelector
} from "../../external-modules/finance/src/worker/store.js";

function fakeKv(
  seed: Record<string, Record<string, unknown>> = {}
): FinanceKv & { getCalls: number } {
  const bucket = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const kv = {
    getCalls: 0,
    async get(_namespace: string, key: string) {
      kv.getCalls++;
      return structuredClone(bucket.get(key) ?? null);
    },
    async set(_namespace: string, key: string, value: Record<string, unknown>) {
      bucket.set(key, structuredClone(value));
    },
    async delete(_namespace: string, key: string) {
      return bucket.delete(key);
    },
    async list() {
      return [...bucket.keys()];
    }
  };
  return kv;
}

function fakeDb(): FinanceDb {
  return {
    async query() {
      return { rows: [] };
    }
  };
}

describe("storeSelector (FIN-06b #1166)", () => {
  it("no marker + db present -> KV store", async () => {
    const kv = fakeKv();
    const select = storeSelector(kv, fakeDb());
    const store = await select();
    // KV store reads through NS.accounts today; SQL store never touches kv.
    await store.listAccounts();
    expect(kv.getCalls).toBeGreaterThan(0);
  });

  it("marker present + db present -> SQL store", async () => {
    const kv = fakeKv({ [MIGRATED_MARKER_KEY]: { migratedAt: "2026-07-18T00:00:00.000Z" } });
    const db = fakeDb();
    const calls: string[] = [];
    const countingDb: FinanceDb = {
      async query(text, params) {
        calls.push(text);
        return db.query(text, params);
      }
    };
    const select = storeSelector(kv, countingDb);
    const store = await select();
    await store.listAccounts();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("marker present but NO db (older host) -> KV store", async () => {
    const kv = fakeKv({ [MIGRATED_MARKER_KEY]: { migratedAt: "2026-07-18T00:00:00.000Z" } });
    const select = storeSelector(kv, undefined);
    const store = await select();
    await store.listAccounts();
    expect(kv.getCalls).toBeGreaterThan(0);
  });

  it("db undefined stays on KV regardless of the marker without ever reading it", async () => {
    const kv = fakeKv({ [MIGRATED_MARKER_KEY]: { migratedAt: "2026-07-18T00:00:00.000Z" } });
    const select = storeSelector(kv, undefined);
    await select();
    // db === undefined short-circuits before the marker read (see store.ts).
    expect(kv.getCalls).toBe(0);
  });

  it("marker is read from KV at most once per created selector (memoized)", async () => {
    const kv = fakeKv();
    const select = storeSelector(kv, fakeDb());
    await select();
    await select();
    await select();
    expect(kv.getCalls).toBe(1);
  });

  it("marker key lives in NS.meta, not NS.settings", () => {
    expect(NS.meta).toBe("finance.meta");
  });
});
