// tests/unit/external-module-finance-shared.test.ts
import { describe, expect, it } from "vitest";

import {
  parseSharedKey,
  sharedAccountPrefix,
  sharedMetaKey,
  sharedMonthKey,
  sharedOwnerPrefix,
  toSharedAccountMeta,
  toSharedChunk
} from "../../external-modules/finance/src/domain/shared-pool.js";
import type {
  AccountRecord,
  TransactionRecord
} from "../../external-modules/finance/src/domain/records.js";

// FIN-04 (#1149) Task 1: the household mirror projection contract (spec delta
// §"Mirror contract"). The projection is an explicit field ALLOWLIST, not a
// blocklist — an extra field on a stored record (a future FIN slice, a bug, a
// tampered row) must never leak into the instance-scoped mirror by default.
// `notes` is the pinned proof case: it is assistant-only personal annotation
// and stays private even on a shared account.

const OWNER = "00000000-0000-4000-8000-0000000000aa";

function account(partial: Partial<AccountRecord> = {}): AccountRecord {
  return {
    accountId: "acc-checking-1",
    itemId: "item-1",
    name: "Everyday Checking",
    officialName: "Everyday Checking Plus",
    type: "depository",
    subtype: "checking",
    mask: "4321",
    balanceCents: 254_317,
    isoCurrency: "USD",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...partial
  };
}

let txnSeq = 0;
function txn(partial: Partial<TransactionRecord> = {}): TransactionRecord {
  txnSeq += 1;
  return {
    id: `tx-${txnSeq}`,
    accountId: "acc-checking-1",
    date: "2026-07-15",
    amountCents: 1_234,
    isoCurrency: "USD",
    name: "BLUE BOTTLE COFFEE OAK",
    merchant: "Blue Bottle",
    plaidCategory: "FOOD_AND_DRINK",
    categoryId: "dining",
    pending: false,
    pendingTransactionId: null,
    categorizedBy: "plaid-map",
    ...partial
  };
}

describe("finance shared-pool projection (#1149)", () => {
  it("meta projection emits exactly the allowlisted account subset", () => {
    const meta = toSharedAccountMeta(OWNER, account({ sharedToHousehold: true }));
    expect(meta).toEqual({
      accountId: "acc-checking-1",
      ownerUserId: OWNER,
      name: "Everyday Checking",
      officialName: "Everyday Checking Plus",
      type: "depository",
      subtype: "checking",
      mask: "4321",
      balanceCents: 254_317,
      isoCurrency: "USD",
      updatedAt: "2026-07-18T00:00:00.000Z"
    });
    // toEqual above is already exhaustive; pin the two highest-value
    // exclusions by name anyway so a future field rename keeps the intent.
    expect(meta).not.toHaveProperty("itemId");
    expect(meta).not.toHaveProperty("sharedToHousehold");
  });

  it("meta projection does not pass through unknown extra fields", () => {
    const tampered = { ...account(), plaidAccessToken: "access-sandbox-LEAK" };
    const meta = toSharedAccountMeta(OWNER, tampered as AccountRecord);
    expect(JSON.stringify(meta)).not.toContain("LEAK");
  });

  it("chunk projection strips notes and keeps the shared transaction fields", () => {
    const projected = toSharedChunk({
      transactions: [
        txn({ notes: "therapy copay — private" }),
        txn({ pending: true, pendingTransactionId: null })
      ]
    });
    expect(projected.transactions).toHaveLength(2);
    for (const row of projected.transactions) {
      expect(row).not.toHaveProperty("notes");
    }
    const [first, second] = projected.transactions;
    if (!first || !second) {
      throw new Error("expected two projected transactions");
    }
    expect(first).toEqual({
      id: first.id,
      accountId: "acc-checking-1",
      date: "2026-07-15",
      amountCents: 1_234,
      isoCurrency: "USD",
      name: "BLUE BOTTLE COFFEE OAK",
      merchant: "Blue Bottle",
      plaidCategory: "FOOD_AND_DRINK",
      categoryId: "dining",
      pending: false,
      pendingTransactionId: null,
      categorizedBy: "plaid-map"
    });
    expect(second.pending).toBe(true);
  });

  it("chunk projection does not pass through unknown extra fields", () => {
    const projected = toSharedChunk({
      transactions: [{ ...txn(), internalFlag: "LEAK" } as TransactionRecord]
    });
    expect(JSON.stringify(projected)).not.toContain("LEAK");
  });

  it("builds the mirror key contract {owner}:{accountId}:{suffix}", () => {
    expect(sharedMetaKey(OWNER, "acc-1")).toBe(`${OWNER}:acc-1:meta`);
    expect(sharedMonthKey(OWNER, "acc-1", "2026-07")).toBe(`${OWNER}:acc-1:2026-07`);
    expect(sharedAccountPrefix(OWNER, "acc-1")).toBe(`${OWNER}:acc-1:`);
    expect(sharedOwnerPrefix(OWNER)).toBe(`${OWNER}:`);
  });

  it("parses mirror keys and rejects malformed ones", () => {
    expect(parseSharedKey(`${OWNER}:acc-1:meta`)).toEqual({
      ownerUserId: OWNER,
      accountId: "acc-1",
      suffix: "meta"
    });
    expect(parseSharedKey(`${OWNER}:acc-1:2026-07`)).toEqual({
      ownerUserId: OWNER,
      accountId: "acc-1",
      suffix: "2026-07"
    });
    expect(parseSharedKey("not-a-mirror-key")).toBeNull();
    expect(parseSharedKey(`${OWNER}:missing-suffix`)).toBeNull();
    expect(parseSharedKey(`${OWNER}:acc-1:`)).toBeNull();
  });

  it("prefix helpers and parser agree (reconcile uses both)", () => {
    const key = sharedMonthKey(OWNER, "acc-1", "2026-07");
    expect(key.startsWith(sharedOwnerPrefix(OWNER))).toBe(true);
    expect(key.startsWith(sharedAccountPrefix(OWNER, "acc-1"))).toBe(true);
    expect(parseSharedKey(key)?.ownerUserId).toBe(OWNER);
  });
});
