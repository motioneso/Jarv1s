// tests/unit/external-module-finance-handlers-sync.test.ts
import { describe, expect, it } from "vitest";

import type {
  PlaidAccount,
  PlaidClient,
  PlaidTx
} from "../../external-modules/finance/src/adapters/plaid.js";
import { PlaidError } from "../../external-modules/finance/src/adapters/plaid.js";
import { NS } from "../../external-modules/finance/src/domain/index.js";
import type { FinanceKv } from "../../external-modules/finance/src/domain/index.js";
import { syncRunHandler } from "../../external-modules/finance/src/worker/handlers/sync.js";
import type { TokenMap, WorkerPorts } from "../../external-modules/finance/src/worker/ports.js";
import { InputError } from "../../external-modules/finance/src/worker/validate.js";

// FIN-01 (#1146) Task 6: sync.run — one handler behind both the
// finance.sync-run queue and the finance.sync.run-now tool (D3). Contracts
// pinned here: the cursor for a page is persisted only AFTER that page's
// chunks are written (at-least-once + idempotent reducer = no data loss),
// balance snapshots append once per day, item failures are isolated (a
// broken bank never blocks the others), the D5 token-map guard aborts the
// whole run, and the per-run page loop is bounded at 20.

const NOW = new Date("2026-07-18T12:00:00Z");
const TODAY = "2026-07-18";

type KvOp = { key: string; namespace: string; value: Record<string, unknown> };

function fakeKv(): FinanceKv & { ops: KvOp[] } {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const ops: KvOp[] = [];
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
      ops.push({ namespace, key, value: structuredClone(value) });
      ns(namespace).set(key, structuredClone(value));
    },
    delete: async (namespace, key) => ns(namespace).delete(key),
    list: async (namespace) => [...ns(namespace).keys()],
    ops
  };
}

function balanceAccount(over: Partial<PlaidAccount> = {}): PlaidAccount {
  return {
    accountId: "acc-1",
    name: "Checking",
    officialName: null,
    type: "depository",
    subtype: "checking",
    mask: "0000",
    balanceCents: 500000,
    isoCurrency: "USD",
    ...over
  };
}

function tx(over: Partial<PlaidTx> & { transaction_id: string }): PlaidTx {
  return {
    account_id: "acc-1",
    date: "2026-07-10",
    amount: 12.34,
    iso_currency_code: "USD",
    name: "COFFEE SHOP",
    merchant_name: "Coffee Shop",
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
    pending: false,
    pending_transaction_id: null,
    ...over
  };
}

type SyncPageResult = Awaited<ReturnType<PlaidClient["transactionsSync"]>>;

function syncPage(over: Partial<SyncPageResult> = {}): SyncPageResult {
  return { added: [], modified: [], removed: [], nextCursor: "c-end", hasMore: false, ...over };
}

type PlaidOverrides = Partial<PlaidClient>;

function fakePlaid(overrides: PlaidOverrides = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, impl: (...args: never[]) => unknown) =>
    (...args: never[]) => {
      calls.push({ method, args: [...args] });
      return impl(...args);
    };
  const client: PlaidClient = {
    linkTokenCreate: record(
      "linkTokenCreate",
      overrides.linkTokenCreate ?? (async () => ({ linkToken: "l", hostedLinkUrl: "u" }))
    ) as PlaidClient["linkTokenCreate"],
    linkTokenGet: record(
      "linkTokenGet",
      overrides.linkTokenGet ?? (async () => ({ status: "pending" as const, publicTokens: [] }))
    ) as PlaidClient["linkTokenGet"],
    itemPublicTokenExchange: record(
      "itemPublicTokenExchange",
      overrides.itemPublicTokenExchange ?? (async () => ({ accessToken: "a", itemId: "i" }))
    ) as PlaidClient["itemPublicTokenExchange"],
    accountsGet: record(
      "accountsGet",
      overrides.accountsGet ?? (async () => ({ institutionId: null, accounts: [] }))
    ) as PlaidClient["accountsGet"],
    accountsBalanceGet: record(
      "accountsBalanceGet",
      overrides.accountsBalanceGet ?? (async () => ({ accounts: [balanceAccount()] }))
    ) as PlaidClient["accountsBalanceGet"],
    transactionsSync: record(
      "transactionsSync",
      overrides.transactionsSync ?? (async () => syncPage())
    ) as PlaidClient["transactionsSync"]
  };
  const callsTo = (method: string) => calls.filter((c) => c.method === method);
  return { client, calls, callsTo };
}

function fakePorts(opts: { kv?: FinanceKv; plaid?: PlaidClient | null; tokens?: TokenMap | null }) {
  const kv = opts.kv ?? fakeKv();
  const plaidFactoryCalls: { env: string }[] = [];
  const ports: WorkerPorts = {
    kv,
    ai: null,
    plaid:
      opts.plaid === null || opts.plaid === undefined
        ? null
        : (env) => {
            plaidFactoryCalls.push({ env });
            return opts.plaid!;
          },
    tokens: {
      read: async () => opts.tokens ?? null,
      write: async () => {
        throw new Error("sync must never write the token map");
      }
    },
    creds: { get: async () => ({ clientId: "client-id-7f3a", secret: "secret-9b2c" }) },
    settings: { getEnvironment: async () => "sandbox" },
    isAdmin: false,
    now: () => NOW
  };
  return { ports, kv, plaidFactoryCalls };
}

async function seedItem(
  kv: FinanceKv,
  itemId: string,
  status: "connected" | "reauth-required" | "error" = "connected"
) {
  await kv.set(NS.connections, `item:${itemId}`, {
    itemId,
    institutionId: "ins_1",
    connectedAt: "2026-07-01T00:00:00Z",
    status
  });
}

const TOKENS: TokenMap = { "item-1": { accessToken: "access-1", institutionId: "ins_1" } };

describe("finance.sync.run (#1146, D3 shared queue/tool handler)", () => {
  it("returns ok with no items and never builds a Plaid client", async () => {
    const { ports, plaidFactoryCalls } = fakePorts({ plaid: fakePlaid().client, tokens: null });
    const result = await syncRunHandler(ports)({});
    expect(result).toEqual({ status: "ok", items: [] });
    expect(plaidFactoryCalls).toHaveLength(0);
  });

  it("D5: aborts the whole run when the token read fails with items on record", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    const { ports } = fakePorts({ kv, plaid: fakePlaid().client, tokens: null });
    const error = await syncRunHandler(ports)({}).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).code).toBe("token_read_failed");
    // No partial writes: the abort happens before any item is touched.
    expect(kv.ops).toHaveLength(1); // just the seed
  });

  it("syncs a multi-page run, persisting each cursor only after its chunks", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    const pages = [
      syncPage({
        added: [tx({ transaction_id: "t1", date: "2026-07-10" })],
        nextCursor: "c1",
        hasMore: true
      }),
      syncPage({
        added: [tx({ transaction_id: "t2", date: "2026-07-11" })],
        nextCursor: "c2",
        hasMore: false
      })
    ];
    let call = 0;
    const plaid = fakePlaid({ transactionsSync: async () => pages[call++]! });
    const { ports } = fakePorts({ kv, plaid: plaid.client, tokens: TOKENS });

    const result = await syncRunHandler(ports)({});
    expect(result).toEqual({
      status: "ok",
      items: [
        { itemId: "item-1", status: "connected", added: 2, modified: 0, removed: 0, pages: 2 }
      ]
    });

    // Cursor discipline: each page's chunk writes strictly precede that
    // page's cursor write (crash between them = replay, reducer no-ops it).
    const ordered = kv.ops
      .filter((op) => op.namespace === NS.transactions || op.key === "cursor:item-1")
      .map((op) => op.key);
    expect(ordered).toEqual(["acc-1:2026-07", "cursor:item-1", "acc-1:2026-07", "cursor:item-1"]);
    const cursorValues = kv.ops.filter((op) => op.key === "cursor:item-1").map((op) => op.value);
    expect(cursorValues).toEqual([{ cursor: "c1" }, { cursor: "c2" }]);

    // Cursor threading: first call starts fresh (null), second resumes at c1.
    const syncCalls = plaid.callsTo("transactionsSync").map((c) => c.args[1]);
    expect(syncCalls).toEqual([null, "c1"]);

    // Both transactions landed in the July chunk.
    const chunk = await kv.get(NS.transactions, "acc-1:2026-07");
    expect((chunk as { transactions: { id: string }[] }).transactions.map((r) => r.id)).toEqual([
      "t2",
      "t1"
    ]);

    // Balances → account record + daily snapshot + item bookkeeping.
    expect(await kv.get(NS.accounts, "acc-1")).toMatchObject({
      accountId: "acc-1",
      itemId: "item-1",
      balanceCents: 500000,
      updatedAt: NOW.toISOString()
    });
    expect(await kv.get(NS.snapshots, "acc-1:2026-07")).toEqual({
      days: { [TODAY]: 500000 }
    });
    expect(await kv.get(NS.connections, "item:item-1")).toMatchObject({
      status: "connected",
      lastSyncAt: NOW.toISOString()
    });
  });

  it("resumes from a stored cursor", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    await kv.set(NS.connections, "cursor:item-1", { cursor: "c-stored" });
    const plaid = fakePlaid();
    const { ports } = fakePorts({ kv, plaid: plaid.client, tokens: TOKENS });
    await syncRunHandler(ports)({});
    expect(plaid.callsTo("transactionsSync")[0]!.args[1]).toBe("c-stored");
  });

  it("appends the balance snapshot only once per day", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    await kv.set(NS.snapshots, "acc-1:2026-07", { days: { [TODAY]: 123 } });
    const seedOps = kv.ops.length;
    const { ports } = fakePorts({ kv, plaid: fakePlaid().client, tokens: TOKENS });
    await syncRunHandler(ports)({});
    const snapshotWrites = kv.ops.slice(seedOps).filter((op) => op.namespace === NS.snapshots);
    expect(snapshotWrites).toHaveLength(0);
    // The stale value survives — today's balance was already recorded.
    expect(await kv.get(NS.snapshots, "acc-1:2026-07")).toEqual({ days: { [TODAY]: 123 } });
  });

  it("isolates item failures: ITEM_LOGIN_REQUIRED marks reauth, others still sync", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    await seedItem(kv, "item-2");
    const plaid = fakePlaid({
      accountsBalanceGet: async (accessToken: string) => {
        if (accessToken === "access-1") throw new PlaidError("ITEM_LOGIN_REQUIRED", 400);
        return { accounts: [balanceAccount({ accountId: "acc-2" })] };
      }
    });
    const { ports } = fakePorts({
      kv,
      plaid: plaid.client,
      tokens: {
        "item-1": { accessToken: "access-1", institutionId: "ins_1" },
        "item-2": { accessToken: "access-2", institutionId: "ins_2" }
      }
    });

    const result = await syncRunHandler(ports)({});
    expect(result.items).toEqual([
      { itemId: "item-1", status: "reauth-required", added: 0, modified: 0, removed: 0, pages: 0 },
      { itemId: "item-2", status: "connected", added: 0, modified: 0, removed: 0, pages: 1 }
    ]);
    expect(await kv.get(NS.connections, "item:item-1")).toMatchObject({
      status: "reauth-required",
      lastError: "ITEM_LOGIN_REQUIRED"
    });
    expect(await kv.get(NS.connections, "item:item-2")).toMatchObject({
      status: "connected",
      lastSyncAt: NOW.toISOString()
    });
  });

  it("marks other Plaid errors as error with the code only", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    const plaid = fakePlaid({
      transactionsSync: async () => {
        throw new PlaidError("INTERNAL_SERVER_ERROR", 500);
      }
    });
    const { ports } = fakePorts({ kv, plaid: plaid.client, tokens: TOKENS });
    const result = await syncRunHandler(ports)({});
    expect(result.items).toEqual([
      { itemId: "item-1", status: "error", added: 0, modified: 0, removed: 0, pages: 0 }
    ]);
    expect(await kv.get(NS.connections, "item:item-1")).toMatchObject({
      status: "error",
      lastError: "INTERNAL_SERVER_ERROR"
    });
  });

  it("marks an item with no token entry as error without calling Plaid for it", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    await seedItem(kv, "item-2");
    const plaid = fakePlaid();
    const { ports } = fakePorts({
      kv,
      plaid: plaid.client,
      tokens: { "item-2": { accessToken: "access-2", institutionId: "ins_2" } }
    });
    const result = await syncRunHandler(ports)({});
    expect(result.items).toEqual([
      { itemId: "item-1", status: "error", added: 0, modified: 0, removed: 0, pages: 0 },
      { itemId: "item-2", status: "connected", added: 0, modified: 0, removed: 0, pages: 1 }
    ]);
    expect(await kv.get(NS.connections, "item:item-1")).toMatchObject({
      status: "error",
      lastError: "TOKEN_MISSING"
    });
  });

  it("recovers a reauth-required item to connected after a successful sync", async () => {
    const kv = fakeKv();
    await kv.set(NS.connections, "item:item-1", {
      itemId: "item-1",
      institutionId: "ins_1",
      connectedAt: "2026-07-01T00:00:00Z",
      status: "reauth-required",
      lastError: "ITEM_LOGIN_REQUIRED"
    });
    const { ports } = fakePorts({ kv, plaid: fakePlaid().client, tokens: TOKENS });
    const result = await syncRunHandler(ports)({});
    expect(result.items[0]).toMatchObject({ itemId: "item-1", status: "connected" });
    const item = await kv.get(NS.connections, "item:item-1");
    expect(item).toMatchObject({ status: "connected", lastSyncAt: NOW.toISOString() });
    expect(item).not.toHaveProperty("lastError");
  });

  it("bounds a runaway sync at 20 pages per item per run", async () => {
    const kv = fakeKv();
    await seedItem(kv, "item-1");
    let call = 0;
    const plaid = fakePlaid({
      transactionsSync: async () =>
        syncPage({
          added: [tx({ transaction_id: `t-${call}` })],
          nextCursor: `c-${call++}`,
          hasMore: true
        })
    });
    const { ports } = fakePorts({ kv, plaid: plaid.client, tokens: TOKENS });
    const result = await syncRunHandler(ports)({});
    expect(plaid.callsTo("transactionsSync")).toHaveLength(20);
    expect(result.items[0]).toMatchObject({ status: "connected", pages: 20, added: 20 });
    // Progress is durable: the 20th cursor is persisted, the next run resumes.
    expect(await kv.get(NS.connections, "cursor:item-1")).toEqual({ cursor: "c-19" });
  });
});
