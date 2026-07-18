import { describe, expect, it } from "vitest";

import type { TransactionRecord } from "../../external-modules/finance/src/domain/index.js";
import {
  aggregateSpending,
  mergeSpendingMonths,
  monthWindow,
  UNCATEGORIZED_BUCKET
} from "../../external-modules/finance/src/domain/index.js";

// FIN-05 (#1150): spending/cash-flow aggregation (spec delta §"Spending &
// cash-flow aggregation"). Pinned: uncategorized rows ARE bucketed (unlike
// budget activity); income rows are excluded from spending breakdowns but
// drive cashFlow.incomeCents; payee = merchant ?? name; everything is a pure
// function of (transactions, window).

let seq = 0;
function tx(over: Partial<TransactionRecord> & { amountCents: number }): TransactionRecord {
  seq += 1;
  return {
    id: `tx-${seq}`,
    accountId: "acc-1",
    date: "2026-07-10",
    isoCurrency: "USD",
    name: "ACME",
    merchant: null,
    plaidCategory: null,
    categoryId: null,
    pending: false,
    pendingTransactionId: null,
    categorizedBy: null,
    ...over
  };
}

describe("monthWindow", () => {
  it("returns ascending months ending at now's month", () => {
    expect(monthWindow(new Date("2026-07-18T12:00:00Z"), 3)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07"
    ]);
  });
  it("crosses year boundaries", () => {
    expect(monthWindow(new Date("2026-01-15T00:00:00Z"), 2)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("aggregateSpending", () => {
  const window = ["2026-06", "2026-07"];

  it("sums signed cents per category with refunds netting, uncategorized bucketed", () => {
    const rows = [
      tx({ categoryId: "groceries", amountCents: 8_432 }),
      tx({ categoryId: "groceries", amountCents: -1_000 }),
      tx({ amountCents: 675 })
    ];
    const [june, july] = aggregateSpending(rows, window);
    expect(june!.byCategory).toEqual({});
    expect(july!.byCategory).toEqual({ groceries: 7_432, [UNCATEGORIZED_BUCKET]: 675 });
  });

  it("groups payees by merchant ?? name", () => {
    const rows = [
      tx({ merchant: "Blue Bottle Coffee", name: "BLUE BOTTLE OAK", amountCents: 675 }),
      tx({ merchant: null, name: "INTEREST PAYMENT", amountCents: -1_250 })
    ];
    const [, july] = aggregateSpending(rows, window);
    expect(july!.byPayee).toEqual({ "Blue Bottle Coffee": 675, "INTEREST PAYMENT": -1_250 });
  });

  it("routes income to cash flow, not spending, and computes net", () => {
    const rows = [
      tx({ categoryId: "income", amountCents: -200_000 }),
      tx({ categoryId: "groceries", amountCents: 8_432 })
    ];
    const [, july] = aggregateSpending(rows, window);
    expect(july!.byCategory).toEqual({ groceries: 8_432 });
    expect(july!.byPayee).toEqual({ ACME: 8_432 });
    expect(july!.cashFlow).toEqual({
      incomeCents: 200_000,
      outflowCents: 8_432,
      netCents: 191_568
    });
  });

  it("drops rows outside the window and emits one entry per window month", () => {
    const rows = [tx({ date: "2026-05-31", amountCents: 999 })];
    const months = aggregateSpending(rows, window);
    expect(months.map((m) => m.month)).toEqual(window);
    expect(months[0]!.byCategory).toEqual({});
    expect(months[1]!.byCategory).toEqual({});
  });
});

describe("mergeSpendingMonths", () => {
  it("sums aligned sources month-wise", () => {
    const window = ["2026-07"];
    const own = aggregateSpending([tx({ categoryId: "groceries", amountCents: 1_000 })], window);
    const shared = aggregateSpending(
      [
        tx({ categoryId: "groceries", amountCents: 500 }),
        tx({ categoryId: "income", amountCents: -2_000 })
      ],
      window
    );
    const [july] = mergeSpendingMonths(window, [own, shared]);
    expect(july!.byCategory).toEqual({ groceries: 1_500 });
    expect(july!.cashFlow).toEqual({ incomeCents: 2_000, outflowCents: 1_500, netCents: 500 });
  });
});
