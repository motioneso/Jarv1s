// tests/unit/external-module-finance-reduce.test.ts
import { describe, expect, it } from "vitest";

import type { PlaidTx } from "../../external-modules/finance/src/adapters/plaid.js";
import {
  monthKey,
  reduceSyncPage,
  toRecord
} from "../../external-modules/finance/src/domain/index.js";
import type {
  ChunkMap,
  TransactionRecord
} from "../../external-modules/finance/src/domain/index.js";

// FIN-01 (#1146) Task 6: the PURE sync reducer. Contracts pinned here:
// toRecord owns the ONE dollars→cents conversion (spending-positive, Plaid
// sign preserved), re-applying a page is a byte-stable no-op (at-least-once
// delivery — the cursor persists only after chunk writes, so a crash between
// the two replays the page), a posted transaction replaces its pending twin
// (same month OR previous month) carrying the user's categorization forward,
// and chunks stay sorted date desc then id asc.

function tx(over: Partial<PlaidTx> & { transaction_id: string }): PlaidTx {
  return {
    account_id: "acc-1",
    date: "2026-07-10",
    amount: 12.34,
    iso_currency_code: "USD",
    name: "COFFEE SHOP #123",
    merchant_name: "Coffee Shop",
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
    pending: false,
    pending_transaction_id: null,
    ...over
  };
}

function page(over: {
  added?: PlaidTx[];
  modified?: PlaidTx[];
  removed?: { transaction_id: string }[];
}) {
  return { added: over.added ?? [], modified: over.modified ?? [], removed: over.removed ?? [] };
}

const JULY = monthKey("acc-1", "2026-07-01");
const JUNE = monthKey("acc-1", "2026-06-01");

describe("toRecord (#1146: the single dollars→cents edge)", () => {
  it("converts float dollars to integer cents, spending-positive", () => {
    expect(toRecord(tx({ transaction_id: "t1", amount: 12.34 })).amountCents).toBe(1234);
  });

  it("preserves Plaid's sign (income/refunds negative)", () => {
    expect(toRecord(tx({ transaction_id: "t1", amount: -45.67 })).amountCents).toBe(-4567);
  });

  it("rounds float artifacts instead of truncating", () => {
    // 4.56 * 100 === 455.99999999999994 in IEEE754 — truncation would lose a cent.
    expect(toRecord(tx({ transaction_id: "t1", amount: 4.56 })).amountCents).toBe(456);
  });

  it("maps the raw snake_case payload onto the stored record shape", () => {
    const record = toRecord(
      tx({
        transaction_id: "t1",
        iso_currency_code: null,
        merchant_name: null,
        personal_finance_category: null,
        pending: true,
        pending_transaction_id: null
      })
    );
    expect(record).toEqual({
      id: "t1",
      accountId: "acc-1",
      date: "2026-07-10",
      amountCents: 1234,
      isoCurrency: "USD",
      name: "COFFEE SHOP #123",
      merchant: null,
      plaidCategory: null,
      categoryId: null,
      pending: true,
      pendingTransactionId: null,
      categorizedBy: null
    });
  });
});

describe("reduceSyncPage (#1146: idempotent month-chunk reducer)", () => {
  it("inserts added transactions into their month chunk, creating it if absent", () => {
    const result = reduceSyncPage(
      {},
      page({
        added: [
          tx({ transaction_id: "t2", date: "2026-07-11" }),
          tx({ transaction_id: "t1", date: "2026-07-10" })
        ]
      })
    );
    expect(result.touched).toEqual([JULY]);
    expect(result.chunks[JULY]!.transactions.map((r) => r.id)).toEqual(["t2", "t1"]);
  });

  it("keeps chunks sorted date desc then id asc", () => {
    const result = reduceSyncPage(
      {},
      page({
        added: [
          tx({ transaction_id: "t-b", date: "2026-07-10" }),
          tx({ transaction_id: "t-c", date: "2026-07-12" }),
          tx({ transaction_id: "t-a", date: "2026-07-10" })
        ]
      })
    );
    expect(result.chunks[JULY]!.transactions.map((r) => r.id)).toEqual(["t-c", "t-a", "t-b"]);
  });

  it("re-applying the same page is a no-op (touched empty, chunks byte-stable)", () => {
    const p = page({
      added: [tx({ transaction_id: "t1" }), tx({ transaction_id: "t2", date: "2026-07-11" })],
      removed: [{ transaction_id: "gone" }]
    });
    const first = reduceSyncPage({}, p);
    const second = reduceSyncPage(first.chunks, p);
    expect(second.touched).toEqual([]);
    expect(second.chunks).toEqual(first.chunks);
  });

  it("does not mutate the caller's chunks", () => {
    const before: ChunkMap = {
      [JULY]: { transactions: [toRecord(tx({ transaction_id: "t1" }))] }
    };
    const snapshot = structuredClone(before);
    reduceSyncPage(
      before,
      page({ added: [tx({ transaction_id: "t2" })], removed: [{ transaction_id: "t1" }] })
    );
    expect(before).toEqual(snapshot);
  });

  it("upserts modified transactions in place by transaction_id", () => {
    const first = reduceSyncPage({}, page({ added: [tx({ transaction_id: "t1", amount: 10 })] }));
    const second = reduceSyncPage(
      first.chunks,
      page({ modified: [tx({ transaction_id: "t1", amount: 11.5 })] })
    );
    expect(second.touched).toEqual([JULY]);
    const records = second.chunks[JULY]!.transactions;
    expect(records).toHaveLength(1);
    expect(records[0]!.amountCents).toBe(1150);
  });

  it("preserves a user categorization when the same transaction is re-sent", () => {
    // At-least-once replay after the user categorized in between must not
    // clobber their work — same carry rule as the pending-twin replacement.
    const categorized: TransactionRecord = {
      ...toRecord(tx({ transaction_id: "t1" })),
      categoryId: "cat-food",
      categorizedBy: "user",
      notes: "team lunch"
    };
    const result = reduceSyncPage(
      { [JULY]: { transactions: [categorized] } },
      page({ modified: [tx({ transaction_id: "t1", amount: 13.0 })] })
    );
    const record = result.chunks[JULY]!.transactions[0]!;
    expect(record.amountCents).toBe(1300);
    expect(record.categoryId).toBe("cat-food");
    expect(record.categorizedBy).toBe("user");
    expect(record.notes).toBe("team lunch");
  });

  it("replaces a same-month pending twin, carrying user category and notes", () => {
    const pendingTwin: TransactionRecord = {
      ...toRecord(tx({ transaction_id: "p1", date: "2026-07-09", pending: true })),
      categoryId: "cat-food",
      categorizedBy: "user",
      notes: "lunch"
    };
    const result = reduceSyncPage(
      { [JULY]: { transactions: [pendingTwin] } },
      page({
        added: [tx({ transaction_id: "t1", date: "2026-07-10", pending_transaction_id: "p1" })]
      })
    );
    const records = result.chunks[JULY]!.transactions;
    expect(records.map((r) => r.id)).toEqual(["t1"]);
    expect(records[0]).toMatchObject({
      categoryId: "cat-food",
      categorizedBy: "user",
      notes: "lunch",
      pendingTransactionId: "p1"
    });
  });

  it("finds and replaces a pending twin that landed in the previous month", () => {
    const pendingTwin: TransactionRecord = {
      ...toRecord(tx({ transaction_id: "p1", date: "2026-06-30", pending: true })),
      categoryId: "cat-travel",
      categorizedBy: "user"
    };
    const result = reduceSyncPage(
      { [JUNE]: { transactions: [pendingTwin] } },
      page({
        added: [tx({ transaction_id: "t1", date: "2026-07-01", pending_transaction_id: "p1" })]
      })
    );
    expect(result.touched.sort()).toEqual([JULY, JUNE].sort());
    expect(result.chunks[JUNE]!.transactions).toEqual([]);
    expect(result.chunks[JULY]!.transactions[0]).toMatchObject({
      id: "t1",
      categoryId: "cat-travel",
      categorizedBy: "user"
    });
  });

  it("does not carry non-user categorization from the pending twin", () => {
    // rule/plaid-map/ai categorization is re-derivable; only user work is sacred.
    const pendingTwin: TransactionRecord = {
      ...toRecord(tx({ transaction_id: "p1", pending: true })),
      categoryId: "cat-guessed",
      categorizedBy: "plaid-map"
    };
    const result = reduceSyncPage(
      { [JULY]: { transactions: [pendingTwin] } },
      page({ added: [tx({ transaction_id: "t1", pending_transaction_id: "p1" })] })
    );
    expect(result.chunks[JULY]!.transactions[0]).toMatchObject({
      id: "t1",
      categoryId: null,
      categorizedBy: null
    });
  });

  it("drops removed ids from any loaded chunk", () => {
    const result = reduceSyncPage(
      {
        [JULY]: { transactions: [toRecord(tx({ transaction_id: "t1" }))] },
        [JUNE]: { transactions: [toRecord(tx({ transaction_id: "t0", date: "2026-06-05" }))] }
      },
      page({ removed: [{ transaction_id: "t0" }, { transaction_id: "not-loaded" }] })
    );
    expect(result.touched).toEqual([JUNE]);
    expect(result.chunks[JUNE]!.transactions).toEqual([]);
    expect(result.chunks[JULY]!.transactions).toHaveLength(1);
  });

  it("moves a modified transaction whose date changed months", () => {
    const result = reduceSyncPage(
      { [JULY]: { transactions: [toRecord(tx({ transaction_id: "t1", date: "2026-07-01" }))] } },
      page({ modified: [tx({ transaction_id: "t1", date: "2026-06-30" })] })
    );
    expect(result.touched.sort()).toEqual([JULY, JUNE].sort());
    expect(result.chunks[JULY]!.transactions).toEqual([]);
    expect(result.chunks[JUNE]!.transactions.map((r) => r.id)).toEqual(["t1"]);
  });
});
