// external-modules/finance/src/worker/handlers/accounts.ts
//
// FIN-01 (#1146) Task 7: finance.accounts.list — the read tool behind "what
// are my balances". Pure KV read (NS.accounts joined with each account's
// item record for status/institution); never builds a Plaid client and never
// touches the token map. Balances are as-of the last sync (updatedAt says
// when), which is the module's design: reads are instant, freshness comes
// from the 6-hour sweep or finance.sync.run-now.
import { itemKey, NS } from "../../domain/index.js";
import type { AccountRecord, ItemRecord } from "../../domain/index.js";
import type { ToolFactory } from "../registry.js";

type AccountView = {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balanceCents: number;
  isoCurrency: string;
  institutionId: string | null;
  itemStatus: ItemRecord["status"];
  updatedAt: string;
};

export const accountsListHandler: ToolFactory = (ports) => async () => {
  const accountIds = await ports.kv.list(NS.accounts);
  if (accountIds.length === 0) {
    return { accounts: [], nextStep: "connect a bank with finance.connect.start" };
  }

  // Item records are few (one per bank); memoize per itemId so a bank with
  // many accounts costs one connections read.
  const itemCache = new Map<string, ItemRecord | null>();
  const loadItem = async (itemId: string): Promise<ItemRecord | null> => {
    if (!itemCache.has(itemId)) {
      const record = await ports.kv.get(NS.connections, itemKey(itemId));
      itemCache.set(itemId, record ? (record as unknown as ItemRecord) : null);
    }
    return itemCache.get(itemId)!;
  };

  const accounts: AccountView[] = [];
  for (const accountId of accountIds) {
    const stored = await ports.kv.get(NS.accounts, accountId);
    if (!stored) continue; // deleted between list and get — benign race
    const account = stored as unknown as AccountRecord;
    const item = await loadItem(account.itemId);
    accounts.push({
      accountId: account.accountId,
      name: account.name,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      balanceCents: account.balanceCents,
      isoCurrency: account.isoCurrency,
      // Orphaned account (item record gone) is surfaced as an error rather
      // than hidden — hiding money is worse than showing a broken link.
      institutionId: item?.institutionId ?? null,
      itemStatus: item?.status ?? "error",
      updatedAt: account.updatedAt
    });
  }
  // kv.list order is storage-dependent; pin a stable order for the assistant.
  accounts.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
  return { accounts };
};
