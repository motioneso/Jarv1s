// tests/unit/external-module-finance-handlers-budget.test.ts
import { describe, expect, it } from "vitest";

import { NS } from "../../external-modules/finance/src/domain/index.js";
import type {
  FinanceKv,
  TransactionRecord
} from "../../external-modules/finance/src/domain/index.js";
import {
  budgetApplyHandler,
  budgetAssignHandler,
  budgetStatusHandler,
  invalidateBudgetStateFrom
} from "../../external-modules/finance/src/worker/handlers/budget.js";
import type { WorkerPorts } from "../../external-modules/finance/src/worker/ports.js";

// FIN-03 (#1148) Task 3+5: the budget handler contracts (spec delta §"Worker
// delta"). Pinned here: `ledger:{month}` is the source of truth and assign
// SETS a total (never increments); `state:{month}` is a throwaway cache
// OWNED BY THE WRITE PATHS — status serves it on hit and recomputes on miss
// WITHOUT persisting, because finance.budget.status is a read-risk tool and
// the host rpc rejects kv.set from read tools with `forbidden_kv_mutation`
// (worker-rpc-host.ts; this surfaced as the UAT run-2 handler_failed). The
// write paths delete caches ≥ the affected month, then warm the assigned
// month; the queue twin consumes the HOST job envelope (ids in input.params —
// the a6023cb7 regression), not flat ids.

const NOW = new Date("2026-07-18T12:00:00Z");

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

// Budget handlers are pure KV reads/writes — same isolation contract as the
// feed handlers: touching Plaid creds, tokens, or instance settings throws.
function fakePorts(kv: FinanceKv): WorkerPorts {
  return {
    kv,
    // FIN-04 (#1149): mirror writes are share/sync-handler territory only.
    mirror: {
      get: async () => {
        throw new Error("budget handlers must not read the household mirror");
      },
      set: async () => {
        throw new Error("budget handlers must not write the household mirror");
      },
      delete: async () => {
        throw new Error("budget handlers must not delete from the household mirror");
      },
      list: async () => {
        throw new Error("budget handlers must not list the household mirror");
      }
    },
    ai: null,
    plaid: null,
    tokens: {
      read: async () => {
        throw new Error("budget handlers must not read tokens");
      },
      write: async () => {
        throw new Error("budget handlers must not write tokens");
      }
    },
    creds: {
      get: async () => {
        throw new Error("budget handlers must not read creds");
      }
    },
    settings: {
      getEnvironment: async () => {
        throw new Error("budget handlers must not read settings");
      }
    },
    isAdmin: false,
    now: () => NOW
  };
}

let txnSeq = 0;
function txRecord(over: Partial<TransactionRecord> & { amountCents: number }): TransactionRecord {
  txnSeq += 1;
  return {
    id: `tx-${txnSeq}`,
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

async function seedJuly(kv: FinanceKv): Promise<void> {
  await kv.set(NS.transactions, "acc-1:2026-07", {
    transactions: [
      txRecord({ categoryId: "income", amountCents: -200_000 }),
      txRecord({ categoryId: "groceries", amountCents: 12_345 })
    ]
  });
  await kv.set(NS.budgets, "ledger:2026-07", { assignments: { groceries: 50_000 } });
}

describe("finance budget.status (#1148)", () => {
  it("derives the month from ledger + chunks WITHOUT persisting (read-risk tool)", async () => {
    const kv = fakeKv();
    await seedJuly(kv);

    const result = await budgetStatusHandler(fakePorts(kv))({ month: "2026-07" });

    expect(result.month).toBe("2026-07");
    expect(result.state).toEqual({
      computedAt: NOW.toISOString(),
      tbbCents: 150_000,
      categories: {
        income: { assignedCents: 0, activityCents: -200_000, availableCents: 200_000 },
        groceries: { assignedCents: 50_000, activityCents: 12_345, availableCents: 37_655 }
      }
    });
    // The taxonomy rides along so the web screen renders groups in one call.
    expect((result.categories as Array<{ id: string }>).some((c) => c.id === "groceries")).toBe(
      true
    );
    // status must NOT kv.set — the host rejects writes from read-risk tools
    // (forbidden_kv_mutation), which is exactly the UAT run-2 handler_failed.
    expect(await kv.get(NS.budgets, "state:2026-07")).toBeNull();
  });

  it("serves the cached state on a second call instead of recomputing", async () => {
    const kv = fakeKv();
    await seedJuly(kv);
    // Sentinel: if status recomputed, this impossible value would vanish.
    await kv.set(NS.budgets, "state:2026-07", {
      computedAt: "2026-07-01T00:00:00.000Z",
      tbbCents: 42,
      categories: {}
    });

    const result = await budgetStatusHandler(fakePorts(kv))({ month: "2026-07" });
    expect((result.state as { tbbCents: number }).tbbCents).toBe(42);
  });

  it("rolls carry and TBB into a later month with no data of its own", async () => {
    const kv = fakeKv();
    await seedJuly(kv);

    const result = await budgetStatusHandler(fakePorts(kv))({ month: "2026-08" });
    const state = result.state as {
      tbbCents: number;
      categories: Record<string, { availableCents: number }>;
    };
    expect(state.tbbCents).toBe(150_000);
    expect(state.categories.groceries!.availableCents).toBe(37_655);
  });

  it("rejects a malformed month", async () => {
    const kv = fakeKv();
    await expect(budgetStatusHandler(fakePorts(kv))({ month: "July 2026" })).rejects.toThrow(
      "month must be YYYY-MM"
    );
  });
});

describe("finance budget.assign — tool path (#1148)", () => {
  it("sets the assignment total, preserving other categories in the ledger", async () => {
    const kv = fakeKv();
    await kv.set(NS.budgets, "ledger:2026-07", { assignments: { dining: 5_000 } });

    const result = await budgetAssignHandler(fakePorts(kv))({
      month: "2026-07",
      categoryId: "groceries",
      amountCents: 50_000
    });

    expect(result).toEqual({
      status: "ok",
      month: "2026-07",
      categoryId: "groceries",
      amountCents: 50_000
    });
    expect(await kv.get(NS.budgets, "ledger:2026-07")).toEqual({
      assignments: { dining: 5_000, groceries: 50_000 }
    });
  });

  it("replaces on re-assign — set semantics, never increment", async () => {
    const kv = fakeKv();
    const assign = budgetAssignHandler(fakePorts(kv));
    await assign({ month: "2026-07", categoryId: "groceries", amountCents: 50_000 });
    await assign({ month: "2026-07", categoryId: "groceries", amountCents: 20_000 });

    expect(await kv.get(NS.budgets, "ledger:2026-07")).toEqual({
      assignments: { groceries: 20_000 }
    });
  });

  it("invalidates later caches and warms the assigned month's cache", async () => {
    const kv = fakeKv();
    for (const month of ["2026-06", "2026-07", "2026-08"]) {
      await kv.set(NS.budgets, `state:${month}`, { computedAt: "x", tbbCents: 0, categories: {} });
    }

    await budgetAssignHandler(fakePorts(kv))({
      month: "2026-07",
      categoryId: "groceries",
      amountCents: 1_000
    });

    // June derives only from months ≤ June — untouched. August is stale and
    // stays deleted (status recomputes it on demand). July — the assigned
    // month — is re-derived and persisted HERE, because assign is the
    // write-risk path and status (read-risk) can never persist it.
    expect(await kv.get(NS.budgets, "state:2026-06")).not.toBeNull();
    expect(await kv.get(NS.budgets, "state:2026-07")).toEqual({
      computedAt: NOW.toISOString(),
      tbbCents: -1_000,
      categories: {
        groceries: { assignedCents: 1_000, activityCents: 0, availableCents: 1_000 }
      }
    });
    expect(await kv.get(NS.budgets, "state:2026-08")).toBeNull();
  });

  it("rejects an unknown category, a fractional amount, and out-of-range amounts", async () => {
    const kv = fakeKv();
    const assign = budgetAssignHandler(fakePorts(kv));
    await expect(
      assign({ month: "2026-07", categoryId: "yachts", amountCents: 1 })
    ).rejects.toThrow("not a live category");
    await expect(
      assign({ month: "2026-07", categoryId: "groceries", amountCents: 10.5 })
    ).rejects.toThrow();
    await expect(
      assign({ month: "2026-07", categoryId: "groceries", amountCents: 100_000_001 })
    ).rejects.toThrow();
    expect(await kv.get(NS.budgets, "ledger:2026-07")).toBeNull();
  });
});

describe("finance budget-apply — queue path (#1148)", () => {
  it("reads the host job envelope: params carry the command, never the top level", async () => {
    const kv = fakeKv();
    const apply = budgetApplyHandler(fakePorts(kv));

    const result = await apply({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      jobKind: "finance.budget-apply",
      idempotencyKey: "idem-1",
      params: { month: "2026-07", categoryId: "groceries", amountCents: 50_000 }
    });

    expect(result).toMatchObject({ status: "ok", categoryId: "groceries" });
    expect(await kv.get(NS.budgets, "ledger:2026-07")).toEqual({
      assignments: { groceries: 50_000 }
    });
    // The queue twin shares applyAssignment, so it warms the month's cache
    // too — this is what the UAT reload-poll reads back after the assign.
    expect(await kv.get(NS.budgets, "state:2026-07")).toMatchObject({ tbbCents: -50_000 });
  });

  it("rejects flat ids (the a6023cb7 regression) and a foreign jobKind", async () => {
    const kv = fakeKv();
    const apply = budgetApplyHandler(fakePorts(kv));
    await expect(
      apply({
        jobKind: "finance.budget-apply",
        month: "2026-07",
        categoryId: "groceries",
        amountCents: 1
      })
    ).rejects.toThrow("params must be an object");
    await expect(
      apply({
        jobKind: "finance.categorize-apply",
        params: { month: "2026-07", categoryId: "groceries", amountCents: 1 }
      })
    ).rejects.toThrow("jobKind is not supported");
  });
});

describe("invalidateBudgetStateFrom (#1148)", () => {
  it("deletes state caches ≥ the given month and leaves ledgers alone", async () => {
    const kv = fakeKv();
    await kv.set(NS.budgets, "ledger:2026-07", { assignments: {} });
    for (const month of ["2026-05", "2026-06", "2026-07"]) {
      await kv.set(NS.budgets, `state:${month}`, { computedAt: "x", tbbCents: 0, categories: {} });
    }

    await invalidateBudgetStateFrom(kv, "2026-06");

    expect(await kv.get(NS.budgets, "state:2026-05")).not.toBeNull();
    expect(await kv.get(NS.budgets, "state:2026-06")).toBeNull();
    expect(await kv.get(NS.budgets, "state:2026-07")).toBeNull();
    expect(await kv.get(NS.budgets, "ledger:2026-07")).not.toBeNull();
  });
});
