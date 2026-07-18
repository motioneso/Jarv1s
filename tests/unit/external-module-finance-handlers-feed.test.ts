// tests/unit/external-module-finance-handlers-feed.test.ts
import { describe, expect, it } from "vitest";

import {
  categorize,
  contentHash,
  DEFAULT_CATEGORIES,
  itemKey,
  normalizePayee,
  NS
} from "../../external-modules/finance/src/domain/index.js";
import type {
  FinanceKv,
  Rule,
  TransactionRecord
} from "../../external-modules/finance/src/domain/index.js";
import {
  categorizeApplyHandler,
  transactionCategorizeHandler,
  transactionsQueryHandler
} from "../../external-modules/finance/src/worker/handlers/feed.js";
import type { WorkerPorts } from "../../external-modules/finance/src/worker/ports.js";

// FIN-02 (#1147) Task 10: the feed surface. Contracts pinned here:
// transactions.query is a one-call read (transactions + categories +
// accounts) that defaults to the current month and NEVER writes (the sync
// run owns taxonomy seeding); the categorize tool is the only writer of
// user provenance and notes; the categorize-apply QUEUE path accepts the
// four identifier ids only — notes stay off job payloads (D6).

const NOW = new Date("2026-07-18T12:00:00Z");

function fakeKv(): FinanceKv & { ops: { namespace: string; key: string }[] } {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const ops: { namespace: string; key: string }[] = [];
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
      ops.push({ namespace, key });
      ns(namespace).set(key, structuredClone(value));
    },
    delete: async (namespace, key) => ns(namespace).delete(key),
    list: async (namespace) => [...ns(namespace).keys()],
    ops
  };
}

// Feed handlers are pure KV reads/writes: any touch of Plaid credentials,
// the token map, or instance settings is a contract violation, so every
// non-kv port throws on use.
function fakePorts(kv: FinanceKv): WorkerPorts {
  return {
    kv,
    // FIN-04 (#1149): mirror writes are share/sync-handler territory only.
    mirror: {
      get: async () => {
        throw new Error("feed handlers must not read the household mirror");
      },
      set: async () => {
        throw new Error("feed handlers must not write the household mirror");
      },
      delete: async () => {
        throw new Error("feed handlers must not delete from the household mirror");
      },
      list: async () => {
        throw new Error("feed handlers must not list the household mirror");
      }
    },
    ai: null,
    plaid: null,
    tokens: {
      read: async () => {
        throw new Error("feed handlers must not read tokens");
      },
      write: async () => {
        throw new Error("feed handlers must not write tokens");
      }
    },
    creds: {
      get: async () => {
        throw new Error("feed handlers must not read creds");
      }
    },
    settings: {
      getEnvironment: async () => {
        throw new Error("feed handlers must not read settings");
      }
    },
    isAdmin: false,
    now: () => NOW
  };
}

function txRecord(over: Partial<TransactionRecord> & { id: string }): TransactionRecord {
  return {
    accountId: "acc-1",
    date: "2026-07-10",
    amountCents: 1234,
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

async function seedAccount(kv: FinanceKv, accountId: string): Promise<void> {
  await kv.set(NS.accounts, accountId, {
    accountId,
    itemId: "item-1",
    name: "Checking",
    officialName: null,
    type: "depository",
    subtype: "checking",
    mask: "0000",
    balanceCents: 500000,
    isoCurrency: "USD",
    updatedAt: "2026-07-18T00:00:00Z"
  });
}

async function seedFeed(kv: FinanceKv): Promise<void> {
  await seedAccount(kv, "acc-1");
  await seedAccount(kv, "acc-2");
  await kv.set(NS.connections, itemKey("item-1"), {
    itemId: "item-1",
    institutionId: "ins-1",
    connectedAt: "2026-07-01T00:00:00Z",
    status: "connected"
  });
  await kv.set(NS.transactions, "acc-1:2026-07", {
    transactions: [
      txRecord({ id: "t-a", date: "2026-07-15", name: "Some Diner" }),
      txRecord({ id: "t-b", date: "2026-07-10", categoryId: "dining", pending: true })
    ]
  });
  await kv.set(NS.transactions, "acc-2:2026-07", {
    transactions: [
      txRecord({ id: "t-c", accountId: "acc-2", date: "2026-07-12", merchant: "Coffee Shop" })
    ]
  });
  await kv.set(NS.transactions, "acc-1:2026-06", {
    transactions: [txRecord({ id: "t-old", date: "2026-06-20" })]
  });
}

function ids(result: Record<string, unknown>): string[] {
  return (result.transactions as TransactionRecord[]).map((record) => record.id);
}

describe("finance feed handlers (#1147)", () => {
  it("query defaults to the current month and returns the feed in one call", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    const writesBefore = kv.ops.length;
    const result = await transactionsQueryHandler(fakePorts(kv))({});
    // Cross-account merge, date desc then id asc; June stays out.
    expect(ids(result)).toEqual(["t-a", "t-c", "t-b"]);
    // One-call feed: categories + accounts ride along.
    const categories = result.categories as { id: string }[];
    expect(categories.map((category) => category.id)).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.id)
    );
    const accounts = result.accounts as { accountId: string }[];
    expect(accounts.map((account) => account.accountId)).toEqual(["acc-1", "acc-2"]);
    // Reads never write: taxonomy seeding belongs to the sync run alone.
    expect(kv.ops.length).toBe(writesBefore);
  });

  it("query filters by month, account, category, search, and pending", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    const handler = transactionsQueryHandler(fakePorts(kv));
    expect(ids(await handler({ month: "2026-06" }))).toEqual(["t-old"]);
    expect(ids(await handler({ accountId: "acc-1" }))).toEqual(["t-a", "t-b"]);
    expect(ids(await handler({ categoryId: "dining" }))).toEqual(["t-b"]);
    // Search is case-insensitive over name AND merchant.
    expect(ids(await handler({ search: "DINER" }))).toEqual(["t-a"]);
    expect(ids(await handler({ search: "coffee" }))).toEqual(["t-c"]);
    expect(ids(await handler({ pendingOnly: true }))).toEqual(["t-b"]);
  });

  it("query defaults limit to 50, allows up to 200, rejects beyond", async () => {
    const kv = fakeKv();
    await seedAccount(kv, "acc-1");
    await kv.set(NS.transactions, "acc-1:2026-07", {
      transactions: Array.from({ length: 60 }, (_, index) =>
        txRecord({ id: `t-${String(index).padStart(2, "0")}` })
      )
    });
    const handler = transactionsQueryHandler(fakePorts(kv));
    expect(ids(await handler({})).length).toBe(50);
    expect(ids(await handler({ limit: 200 })).length).toBe(60);
    await expect(handler({ limit: 201 })).rejects.toThrow("at most 200");
    await expect(handler({ month: "July 2026" })).rejects.toThrow("month must be YYYY-MM");
  });

  it("categorize tool sets user provenance and persists notes", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    const result = await transactionCategorizeHandler(fakePorts(kv))({
      transactionId: "t-a",
      accountId: "acc-1",
      month: "2026-07",
      categoryId: "groceries",
      notes: "weekly shop"
    });
    expect(result.status).toBe("ok");
    const chunk = (await kv.get(NS.transactions, "acc-1:2026-07")) as {
      transactions: TransactionRecord[];
    };
    const updated = chunk.transactions.find((record) => record.id === "t-a")!;
    expect(updated).toMatchObject({
      categoryId: "groceries",
      categorizedBy: "user",
      notes: "weekly shop"
    });
    // Sibling records untouched; no rule written without createRule.
    expect(chunk.transactions.find((record) => record.id === "t-b")!.categoryId).toBe("dining");
    expect(await kv.list(NS.rules)).toEqual([]);
  });

  it("createRule upserts the payee rule and a later pipeline run applies it", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    await kv.set(NS.transactions, "acc-1:2026-07", {
      transactions: [txRecord({ id: "t-tj", name: "TRADER JOE'S #123" })]
    });
    await transactionCategorizeHandler(fakePorts(kv))({
      transactionId: "t-tj",
      accountId: "acc-1",
      month: "2026-07",
      categoryId: "groceries",
      createRule: true
    });
    const key = contentHash(normalizePayee("TRADER JOE'S #123"));
    const rule = (await kv.get(NS.rules, key)) as Rule | null;
    expect(rule).toMatchObject({
      payeeKey: "trader joes",
      categoryId: "groceries",
      createdAt: NOW.toISOString()
    });
    // The stored rule feeds the Task 9 pipeline: the next sync categorizes
    // the same payee without AI.
    const next = await categorize(
      [txRecord({ id: "t-next", name: "Trader Joes 999" })],
      [rule as Rule],
      [...DEFAULT_CATEGORIES],
      null
    );
    expect(next[0]).toMatchObject({ categoryId: "groceries", categorizedBy: "rule" });
  });

  it("rejects unknown transaction ids and unknown or archived categories", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    await kv.set(NS.categories, "taxonomy", {
      categories: [
        ...DEFAULT_CATEGORIES,
        { id: "old-cat", group: "personal", name: "Old", archived: true }
      ]
    });
    const apply = categorizeApplyHandler(fakePorts(kv));
    // The queue envelope the host actually delivers (apps/worker/src/
    // external-module-job-handler.ts): ids ride in `params`, never top-level.
    const envelope = (params: Record<string, unknown>) => ({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      jobKind: "finance.categorize-apply",
      idempotencyKey: "finance:finance.categorize-apply:job-1",
      params
    });
    const base = { accountId: "acc-1", month: "2026-07", categoryId: "dining" };
    await expect(apply(envelope({ ...base, transactionId: "t-missing" }))).rejects.toMatchObject({
      code: "not_found"
    });
    await expect(
      apply(envelope({ ...base, transactionId: "t-a", categoryId: "nope" }))
    ).rejects.toMatchObject({ code: "invalid_category" });
    await expect(
      apply(envelope({ ...base, transactionId: "t-a", categoryId: "old-cat" }))
    ).rejects.toMatchObject({ code: "invalid_category" });
  });

  it("queue path reads ids from the job envelope's params and never persists notes (D6)", async () => {
    const kv = fakeKv();
    await seedFeed(kv);
    // Regression (#1147 UAT run 1): the host invokes queue handlers with the
    // full job envelope { actorUserId, jobKind, idempotencyKey, params } —
    // reading ids from the top level made every real queued job die with
    // invalid_input while the flat-input unit test stayed green. This test
    // now models the envelope exactly as external-module-job-handler.ts
    // builds it. The manifest paramsSchema already rejects extra keys
    // host-side; the handler ignoring notes is defense in depth.
    await categorizeApplyHandler(fakePorts(kv))({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      jobKind: "finance.categorize-apply",
      idempotencyKey: "finance:finance.categorize-apply:job-1",
      params: {
        transactionId: "t-a",
        accountId: "acc-1",
        month: "2026-07",
        categoryId: "transport",
        notes: "must not land"
      }
    });
    const chunk = (await kv.get(NS.transactions, "acc-1:2026-07")) as {
      transactions: TransactionRecord[];
    };
    const updated = chunk.transactions.find((record) => record.id === "t-a")!;
    expect(updated).toMatchObject({ categoryId: "transport", categorizedBy: "user" });
    expect(updated.notes).toBeUndefined();
    expect(await kv.list(NS.rules)).toEqual([]);
  });
});
