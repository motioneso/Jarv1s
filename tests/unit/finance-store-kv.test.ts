// tests/unit/finance-store-kv.test.ts
// FIN-06b (#1166) Task 4: kvStore(kv) must satisfy the FinanceStore port
// against the SAME KV shapes today's handlers already read/write, so the
// FIN-06c cutover is a call-site swap, not a data-model rewrite. Fake KV
// copied from tests/unit/external-module-finance-handlers-sync.test.ts.
import { describe, expect, it } from "vitest";

import type { FinanceKv } from "../../external-modules/finance/src/domain/index.js";
import { NS } from "../../external-modules/finance/src/domain/index.js";
import { kvStore } from "../../external-modules/finance/src/domain/index.js";
import type {
  AccountRecord,
  ItemRecord,
  TransactionRecord
} from "../../external-modules/finance/src/domain/index.js";

function fakeKv(): FinanceKv {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const ns = (namespace: string) => {
    let bucket = store.get(namespace);
    if (!bucket) {
      bucket = new Map();
      store.set(namespace, bucket);
    }
    return bucket;
  };
  return {
    get: async (namespace, key) => structuredClone(ns(namespace).get(key) ?? null),
    set: async (namespace, key, value) => {
      ns(namespace).set(key, structuredClone(value));
    },
    delete: async (namespace, key) => ns(namespace).delete(key),
    list: async (namespace) => [...ns(namespace).keys()]
  };
}

function tx(over: Partial<TransactionRecord> & { id: string }): TransactionRecord {
  return {
    accountId: "acc1",
    date: "2026-07-10",
    amountCents: 1234,
    isoCurrency: "USD",
    name: "COFFEE SHOP",
    merchant: "Coffee Shop",
    plaidCategory: "FOOD_AND_DRINK",
    categoryId: null,
    pending: false,
    pendingTransactionId: null,
    categorizedBy: null,
    ...over
  };
}

describe("kvStore (FIN-06b #1166)", () => {
  it("listItems returns only item:* records from NS.connections", async () => {
    const kv = fakeKv();
    const item: ItemRecord = {
      itemId: "i1",
      institutionId: "ins_1",
      connectedAt: "2026-07-01T00:00:00Z",
      status: "connected"
    };
    await kv.set(NS.connections, "item:i1", item);
    await kv.set(NS.connections, "cursor:i1", { cursor: "c1" });
    await kv.set(NS.connections, "link:abc", { linkToken: "x" });

    const store = kvStore(kv);
    const items = await store.listItems();
    expect(items).toEqual([item]);
  });

  it("getItem/putItem round-trip through itemKey", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    const item: ItemRecord = {
      itemId: "i1",
      institutionId: null,
      connectedAt: "2026-07-01T00:00:00Z",
      status: "connected"
    };
    await store.putItem(item);
    expect(await store.getItem("i1")).toEqual(item);
    expect(await store.getItem("missing")).toBeNull();
  });

  it("listAccounts/getAccount/putAccount round-trip through NS.accounts", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    const account: AccountRecord = {
      accountId: "acc1",
      itemId: "i1",
      name: "Checking",
      officialName: null,
      type: "depository",
      subtype: "checking",
      mask: "0000",
      balanceCents: 500000,
      isoCurrency: "USD",
      updatedAt: "2026-07-18T00:00:00Z"
    };
    await store.putAccount(account);
    expect(await store.getAccount("acc1")).toEqual(account);
    expect(await store.listAccounts()).toEqual([account]);
    expect(await store.getAccount("missing")).toBeNull();
  });

  it("getTransactionChunk sorts date DESC, id ASC even when seeded unsorted, and returns null when absent", async () => {
    const kv = fakeKv();
    await kv.set(NS.transactions, "acc1:2026-07", {
      transactions: [
        tx({ id: "b", date: "2026-07-01" }),
        tx({ id: "a", date: "2026-07-10" }),
        tx({ id: "c", date: "2026-07-10" })
      ]
    });
    const store = kvStore(kv);
    expect(await store.getTransactionChunk("acc1", "2026-07")).toEqual([
      tx({ id: "a", date: "2026-07-10" }),
      tx({ id: "c", date: "2026-07-10" }),
      tx({ id: "b", date: "2026-07-01" })
    ]);
    expect(await store.getTransactionChunk("acc1", "2026-08")).toBeNull();
  });

  it("putTransactionChunk writes {transactions} under `${accountId}:${month}` in NS.transactions, dropping pruned records", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    await store.putTransactionChunk("acc1", "2026-07", [tx({ id: "a" }), tx({ id: "b" })]);
    // Simulate a later prune: only "b" survives the input this time.
    await store.putTransactionChunk("acc1", "2026-07", [tx({ id: "b" })]);

    const stored = await kv.get(NS.transactions, "acc1:2026-07");
    expect(stored).toEqual({ transactions: [tx({ id: "b" })] });
  });

  it("putTransaction rewrites exactly one record inside its month chunk", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    await store.putTransactionChunk("acc1", "2026-07", [
      tx({ id: "a", name: "OLD NAME" }),
      tx({ id: "b" })
    ]);
    await store.putTransaction(tx({ id: "a", name: "NEW NAME" }));

    const chunk = await store.getTransactionChunk("acc1", "2026-07");
    expect(chunk?.find((record) => record.id === "a")?.name).toBe("NEW NAME");
    expect(chunk).toHaveLength(2);
  });

  it("putTransaction creates a new chunk when none exists yet", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    await store.putTransaction(tx({ id: "a" }));
    expect(await store.getTransactionChunk("acc1", "2026-07")).toEqual([tx({ id: "a" })]);
  });

  it("listTransactionMonths derives distinct months newest-first from chunk keys", async () => {
    const kv = fakeKv();
    await kv.set(NS.transactions, "acc1:2026-05", { transactions: [] });
    await kv.set(NS.transactions, "acc2:2026-07", { transactions: [] });
    await kv.set(NS.transactions, "acc1:2026-07", { transactions: [] });
    const store = kvStore(kv);
    expect(await store.listTransactionMonths()).toEqual(["2026-07", "2026-05"]);
  });

  it("listMonthTransactions collects one month across accounts, sorted date DESC id ASC", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    await store.putTransactionChunk("acc1", "2026-07", [tx({ id: "a", date: "2026-07-01" })]);
    await store.putTransactionChunk("acc2", "2026-07", [tx({ id: "b", date: "2026-07-15" })]);
    await store.putTransactionChunk("acc1", "2026-08", [tx({ id: "c", date: "2026-08-01" })]);

    expect(await store.listMonthTransactions("2026-07")).toEqual([
      tx({ id: "b", date: "2026-07-15" }),
      tx({ id: "a", date: "2026-07-01" })
    ]);
  });

  it("listSnapshotChunks/getSnapshotChunk/putSnapshotChunk round-trip SnapshotChunk.days", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    await store.putSnapshotChunk("acc1", "2026-07", { "2026-07-01": 100 });
    await store.putSnapshotChunk("acc2", "2026-07", { "2026-07-01": 200 });

    expect(await store.getSnapshotChunk("acc1", "2026-07")).toEqual({ "2026-07-01": 100 });
    expect(await store.getSnapshotChunk("acc1", "2026-08")).toBeNull();
    expect(await store.listSnapshotChunks()).toEqual(
      expect.arrayContaining([
        { accountId: "acc1", month: "2026-07" },
        { accountId: "acc2", month: "2026-07" }
      ])
    );
  });

  it("setAssignment RMWs ledger:{month} setting assignments[categoryId] as a total, not a delta; getLedger null when absent", async () => {
    const kv = fakeKv();
    const store = kvStore(kv);
    expect(await store.getLedger("2026-07")).toBeNull();

    await store.setAssignment("2026-07", "groceries", 10000);
    await store.setAssignment("2026-07", "groceries", 15000);
    await store.setAssignment("2026-07", "rent", 200000);

    expect(await store.getLedger("2026-07")).toEqual({
      assignments: { groceries: 15000, rent: 200000 }
    });
  });

  it("listAssignmentMonths returns only ledger:* months, ascending, ignoring state:* cache keys", async () => {
    const kv = fakeKv();
    await kv.set(NS.budgets, "ledger:2026-07", { assignments: {} });
    await kv.set(NS.budgets, "ledger:2026-05", { assignments: {} });
    await kv.set(NS.budgets, "state:2026-07", { totalAssignedCents: 0 });
    const store = kvStore(kv);
    expect(await store.listAssignmentMonths()).toEqual(["2026-05", "2026-07"]);
  });
});
