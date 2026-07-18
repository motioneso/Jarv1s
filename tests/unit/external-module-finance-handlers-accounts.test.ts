// tests/unit/external-module-finance-handlers-accounts.test.ts
import { describe, expect, it } from "vitest";

import { NS } from "../../external-modules/finance/src/domain/index.js";
import type { FinanceKv } from "../../external-modules/finance/src/domain/index.js";
import { accountsListHandler } from "../../external-modules/finance/src/worker/handlers/accounts.js";
import type { WorkerPorts } from "../../external-modules/finance/src/worker/ports.js";

// FIN-01 (#1146) Task 7: accounts.list — the read tool the assistant uses to
// answer "what are my balances". Pure KV read: joins NS.accounts records with
// their item's status/institution; never touches Plaid or the token map.

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

function ports(kv: FinanceKv): WorkerPorts {
  return {
    kv,
    // FIN-04 (#1149): mirror writes are share/sync-handler territory only.
    mirror: {
      get: async () => {
        throw new Error("accounts.list must not read the household mirror");
      },
      set: async () => {
        throw new Error("accounts.list must not write the household mirror");
      },
      delete: async () => {
        throw new Error("accounts.list must not delete from the household mirror");
      },
      list: async () => {
        throw new Error("accounts.list must not list the household mirror");
      }
    },
    ai: null,
    // Read tool: reaching for Plaid or credentials would be a design break.
    plaid: () => {
      throw new Error("accounts.list must not build a Plaid client");
    },
    tokens: {
      read: async () => {
        throw new Error("accounts.list must not read the token map");
      },
      write: async () => {
        throw new Error("accounts.list must not write the token map");
      }
    },
    creds: {
      get: async () => {
        throw new Error("accounts.list must not read credentials");
      }
    },
    settings: { getEnvironment: async () => "sandbox" },
    isAdmin: false,
    now: () => new Date("2026-07-18T12:00:00Z")
  };
}

async function seed(kv: FinanceKv) {
  await kv.set(NS.connections, "item:item-1", {
    itemId: "item-1",
    institutionId: "ins_1",
    connectedAt: "2026-07-01T00:00:00Z",
    status: "connected"
  });
  await kv.set(NS.connections, "item:item-2", {
    itemId: "item-2",
    institutionId: "ins_2",
    connectedAt: "2026-07-02T00:00:00Z",
    status: "reauth-required",
    lastError: "ITEM_LOGIN_REQUIRED"
  });
  await kv.set(NS.accounts, "acc-2", {
    accountId: "acc-2",
    itemId: "item-2",
    name: "Savings",
    officialName: "High Yield Savings",
    type: "depository",
    subtype: "savings",
    mask: "1111",
    balanceCents: 1250000,
    isoCurrency: "USD",
    updatedAt: "2026-07-18T06:00:00Z"
  });
  await kv.set(NS.accounts, "acc-1", {
    accountId: "acc-1",
    itemId: "item-1",
    name: "Checking",
    officialName: null,
    type: "depository",
    subtype: "checking",
    mask: "0000",
    balanceCents: 500000,
    isoCurrency: "USD",
    updatedAt: "2026-07-18T06:00:00Z"
  });
}

describe("finance.accounts.list (#1146)", () => {
  it("returns the connect nextStep when no accounts exist", async () => {
    const result = await accountsListHandler(ports(fakeKv()))({});
    expect(result).toEqual({
      accounts: [],
      nextStep: "connect a bank with finance.connect.start"
    });
  });

  it("lists accounts joined with their item's status and institution", async () => {
    const kv = fakeKv();
    await seed(kv);
    const result = (await accountsListHandler(ports(kv))({})) as {
      accounts: Record<string, unknown>[];
    };
    // Stable order: accountId asc (kv.list order is storage-dependent).
    expect(result.accounts.map((a) => a.accountId)).toEqual(["acc-1", "acc-2"]);
    expect(result.accounts[0]).toEqual({
      accountId: "acc-1",
      name: "Checking",
      mask: "0000",
      type: "depository",
      subtype: "checking",
      balanceCents: 500000,
      isoCurrency: "USD",
      institutionId: "ins_1",
      itemStatus: "connected",
      updatedAt: "2026-07-18T06:00:00Z"
    });
    expect(result.accounts[1]).toMatchObject({
      accountId: "acc-2",
      balanceCents: 1250000,
      institutionId: "ins_2",
      itemStatus: "reauth-required"
    });
  });

  it("surfaces an orphaned account (item record missing) rather than hiding it", async () => {
    const kv = fakeKv();
    await kv.set(NS.accounts, "acc-9", {
      accountId: "acc-9",
      itemId: "item-gone",
      name: "Old Checking",
      officialName: null,
      type: "depository",
      subtype: "checking",
      mask: "9999",
      balanceCents: 100,
      isoCurrency: "USD",
      updatedAt: "2026-07-01T00:00:00Z"
    });
    const result = (await accountsListHandler(ports(kv))({})) as {
      accounts: Record<string, unknown>[];
    };
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      accountId: "acc-9",
      institutionId: null,
      itemStatus: "error"
    });
  });
});
