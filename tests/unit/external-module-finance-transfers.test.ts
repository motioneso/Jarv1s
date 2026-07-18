import { describe, expect, it } from "vitest";

import type { TransactionRecord } from "../../external-modules/finance/src/domain/index.js";
import {
  effectiveTransferIds,
  excludeTransfers,
  pairTransfers
} from "../../external-modules/finance/src/domain/index.js";

// FIN-05 (#1150): the transfer auto-pairing heuristic (spec delta §"Transfer
// auto-pairing"). Pinned: opposite nonzero amounts, different accounts,
// ≤3-day distance, at least one side categorized "transfers"; deterministic
// greedy (date asc then id asc, nearest date, tie by id); effective set =
// paired ∪ transfers-categorized.

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

describe("pairTransfers", () => {
  it("pairs opposite amounts across accounts when one side is transfers", () => {
    const out = tx({
      id: "out",
      accountId: "checking",
      amountCents: 50_000,
      categoryId: "transfers"
    });
    const inn = tx({ id: "in", accountId: "savings", amountCents: -50_000, date: "2026-07-11" });
    expect(pairTransfers([inn, out])).toEqual([{ aId: "out", bId: "in" }]);
  });

  it("pairs across a month boundary within 3 days", () => {
    const out = tx({
      id: "out",
      accountId: "a",
      date: "2026-06-30",
      amountCents: 10_000,
      categoryId: "transfers"
    });
    const inn = tx({ id: "in", accountId: "b", date: "2026-07-02", amountCents: -10_000 });
    expect(pairTransfers([out, inn])).toHaveLength(1);
  });

  it("rejects candidates more than 3 days apart", () => {
    const out = tx({
      id: "out",
      accountId: "a",
      date: "2026-07-01",
      amountCents: 10_000,
      categoryId: "transfers"
    });
    const inn = tx({ id: "in", accountId: "b", date: "2026-07-05", amountCents: -10_000 });
    expect(pairTransfers([out, inn])).toEqual([]);
  });

  it("requires opposite sign, different account, and a transfers side", () => {
    const base = { date: "2026-07-10", amountCents: 10_000, categoryId: "transfers" as const };
    const sameSign = [
      tx({ id: "a", accountId: "a", ...base }),
      tx({ id: "b", accountId: "b", ...base })
    ];
    expect(pairTransfers(sameSign)).toEqual([]);
    const sameAccount = [
      tx({ id: "a", accountId: "a", ...base }),
      tx({ id: "b", accountId: "a", amountCents: -10_000, date: "2026-07-10" })
    ];
    expect(pairTransfers(sameAccount)).toEqual([]);
    const noTransfersSide = [
      tx({ id: "a", accountId: "a", amountCents: 10_000, date: "2026-07-10" }),
      tx({ id: "b", accountId: "b", amountCents: -10_000, date: "2026-07-10" })
    ];
    expect(pairTransfers(noTransfersSide)).toEqual([]);
  });

  it("never pairs zero amounts", () => {
    const a = tx({ id: "a", accountId: "a", amountCents: 0, categoryId: "transfers" });
    const b = tx({ id: "b", accountId: "b", amountCents: 0 });
    expect(pairTransfers([a, b])).toEqual([]);
  });

  it("greedily takes the nearest date, tie broken by id, deterministically", () => {
    const out = tx({
      id: "out",
      accountId: "a",
      date: "2026-07-10",
      amountCents: 5_000,
      categoryId: "transfers"
    });
    const near = tx({ id: "z-near", accountId: "b", date: "2026-07-11", amountCents: -5_000 });
    const far = tx({ id: "a-far", accountId: "b", date: "2026-07-12", amountCents: -5_000 });
    // nearest date wins even though "a-far" sorts first by id
    expect(pairTransfers([far, near, out])).toEqual([{ aId: "out", bId: "z-near" }]);
    const tieA = tx({ id: "aa", accountId: "b", date: "2026-07-11", amountCents: -5_000 });
    const tieB = tx({ id: "bb", accountId: "b", date: "2026-07-11", amountCents: -5_000 });
    // same date: lower id wins; input order must not matter
    expect(pairTransfers([tieB, tieA, out])).toEqual([{ aId: "out", bId: "aa" }]);
    expect(pairTransfers([out, tieA, tieB])).toEqual([{ aId: "out", bId: "aa" }]);
  });

  it("consumes each transaction at most once", () => {
    const out1 = tx({
      id: "o1",
      accountId: "a",
      date: "2026-07-10",
      amountCents: 5_000,
      categoryId: "transfers"
    });
    const out2 = tx({
      id: "o2",
      accountId: "a",
      date: "2026-07-10",
      amountCents: 5_000,
      categoryId: "transfers"
    });
    const inn = tx({ id: "i1", accountId: "b", date: "2026-07-10", amountCents: -5_000 });
    // same date → id-ascending scan order: "i1" leads and takes "o1"; "o2"
    // stays unpaired (each row consumed at most once)
    expect(pairTransfers([out1, out2, inn])).toEqual([{ aId: "i1", bId: "o1" }]);
  });
});

describe("effectiveTransferIds / excludeTransfers", () => {
  it("unions paired rows with transfers-categorized rows", () => {
    const out = tx({ id: "out", accountId: "a", amountCents: 5_000, categoryId: "transfers" });
    const inn = tx({ id: "in", accountId: "b", amountCents: -5_000 });
    const lone = tx({ id: "lone", accountId: "a", amountCents: 7_500, categoryId: "transfers" });
    const spend = tx({ id: "spend", accountId: "a", amountCents: 675 });
    const all = [out, inn, lone, spend];
    expect(effectiveTransferIds(all)).toEqual(new Set(["out", "in", "lone"]));
    expect(excludeTransfers(all).map((t) => t.id)).toEqual(["spend"]);
  });
});
