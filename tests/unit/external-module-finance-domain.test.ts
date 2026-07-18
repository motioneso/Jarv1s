// tests/unit/external-module-finance-domain.test.ts
import { describe, expect, it } from "vitest";

import {
  contentHash,
  cursorKey,
  itemKey,
  linkKey,
  monthKey,
  normalizePayee,
  prevMonthKey
} from "../../external-modules/finance/src/domain/keys.js";
import type { TransactionRecord } from "../../external-modules/finance/src/domain/records.js";

// FIN-01 (#1146) Task 3: the KV key ABI every later slice roots on
// (grounded-decisions "KV/key design"). Key shapes are a storage contract —
// changing them orphans stored chunks, so they're pinned literally here.
describe("finance domain keys (#1146)", () => {
  it("monthKey addresses a month chunk from an ISO date", () => {
    expect(monthKey("acc1", "2026-07-18")).toBe("acc1:2026-07");
    expect(monthKey("acc1", "2026-01-05")).toBe("acc1:2026-01");
  });

  it("prevMonthKey handles the January→December year boundary", () => {
    expect(prevMonthKey("acc1", "2026-07-18")).toBe("acc1:2026-06");
    expect(prevMonthKey("acc1", "2026-01-05")).toBe("acc1:2025-12");
  });

  it("itemKey and cursorKey are distinct prefixes over the same item id", () => {
    // cursor lives at its own key so cursor-persist-LAST stays an isolated
    // write (sync at-least-once contract, plan Task 6).
    expect(itemKey("item-9")).toBe("item:item-9");
    expect(cursorKey("item-9")).toBe("cursor:item-9");
  });

  it("linkKey hashes the link token so the token never becomes key material", () => {
    const key = linkKey("link-sandbox-abc123");
    expect(key).toBe(`link:${contentHash("link-sandbox-abc123")}`);
    expect(key).not.toContain("abc123");
    expect(key).toMatch(/^link:[0-9a-f]{32}$/);
    // Deterministic: the poll handler must re-derive the same key.
    expect(linkKey("link-sandbox-abc123")).toBe(key);
    expect(linkKey("link-sandbox-other")).not.toBe(key);
  });

  it("normalizePayee strips digits/punctuation and collapses whitespace", () => {
    expect(normalizePayee("Trader Joe's #123 ")).toBe("trader joes");
    expect(normalizePayee("UBER   *TRIP 4X2")).toBe("uber trip x");
    expect(normalizePayee("Netflix.com")).toBe("netflixcom");
  });
});

describe("finance domain records (#1146)", () => {
  it("TransactionRecord round-trips through JSON unchanged", () => {
    const record: TransactionRecord = {
      id: "tx-1",
      accountId: "acc1",
      date: "2026-07-18",
      amountCents: 1234,
      isoCurrency: "USD",
      name: "Trader Joe's #123",
      merchant: "Trader Joe's",
      plaidCategory: "FOOD_AND_DRINK",
      categoryId: null,
      pending: false,
      pendingTransactionId: null,
      categorizedBy: null
    };
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});
