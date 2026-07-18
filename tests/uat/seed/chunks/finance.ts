import type { DataContextRunner } from "@jarv1s/db";
import { setModuleKvValue } from "@jarv1s/settings";

/**
 * FIN-02 (#1147) Task 12: finance module-KV fixtures for the feed UAT.
 *
 * Unlike job-search (#1087 finding 3), this chunk is safe in the always-on
 * admin+data ladder: it writes ONLY user-scoped `app.module_kv` data rows and
 * never touches `app.external_modules` — the module stays uninstalled, so the
 * #1026 absent-module default is preserved and these rows are invisible to
 * every spec that doesn't activate the module itself. Real activation is the
 * finance-feed spec's job (docker-cp package + admin enable through the UI,
 * decision D7 in docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md).
 *
 * SECRET HYGIENE (binding, spec §security): no credentials of any kind here.
 * The UAT never talks to Plaid; `finance.plaid-tokens` is never seeded.
 *
 * Record/key shapes are inlined rather than imported from
 * external-modules/finance/src/domain/{records,keys,kv-port}.ts — the harness
 * must not couple to module internals (module-isolation invariant), and the
 * shapes below are the module's persisted KV contract, asserted end-to-end by
 * the spec itself. Keep in sync with those files if the contract ever changes.
 *
 * Deliberate wall-clock use: the feed web surface opens on the browser's
 * CURRENT month, so the seeded transaction chunk must live under the current
 * month at seed time (seed container and browser share the host clock; the
 * fixed UAT_SEED_BASE_TIMESTAMP would land the data in a month the feed never
 * shows by default). The previous month is intentionally left unseeded — the
 * spec navigates back one month to assert the authored empty state.
 */

const MODULE_ID = "finance";

// Namespaces: external-modules/finance/src/domain/kv-port.ts NS map.
const NS_CONNECTIONS = "finance.connections";
const NS_ACCOUNTS = "finance.accounts";
const NS_TRANSACTIONS = "finance.transactions";

const ITEM_ID = "uat-item-first-platypus";
const CHECKING_ID = "uat-acc-checking";
const SAVINGS_ID = "uat-acc-savings";

/** Current month ("YYYY-MM") at seed time — see wall-clock note above. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** A YYYY-MM-DD date inside `month`; day is 2-digit and always valid (<= 28). */
function dayInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

export async function seedFinanceChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const month = currentMonth();

  // ItemRecord — keys.ts itemKey(): connections rows live at `item:${itemId}`.
  const item = {
    itemId: ITEM_ID,
    institutionId: "ins_uat_first_platypus",
    connectedAt: `${dayInMonth(month, 1)}T09:00:00.000Z`,
    status: "connected"
  };

  // AccountRecord — stored keyed by accountId in NS_ACCOUNTS.
  const accounts = [
    {
      accountId: CHECKING_ID,
      itemId: ITEM_ID,
      name: "Everyday Checking",
      officialName: "First Platypus Everyday Checking",
      type: "depository",
      subtype: "checking",
      mask: "4321",
      balanceCents: 254_317,
      isoCurrency: "USD",
      updatedAt: `${dayInMonth(month, 2)}T09:00:00.000Z`
    },
    {
      accountId: SAVINGS_ID,
      itemId: ITEM_ID,
      name: "Rainy Day Savings",
      officialName: "First Platypus Rainy Day Savings",
      type: "depository",
      subtype: "savings",
      mask: "8765",
      balanceCents: 1_200_000,
      isoCurrency: "USD",
      updatedAt: `${dayInMonth(month, 2)}T09:00:00.000Z`
    }
  ];

  // TransactionChunk at `${accountId}:${month}` (keys.ts monthKey), sorted
  // date desc then id asc — the module's persisted ordering contract.
  // amountCents is spending-positive. "Blue Bottle Coffee" is the spec's
  // search target AND its recategorize target (categoryId null → picks
  // "dining" through the UI, proving the categorize-apply queue end-to-end).
  const checkingTransactions = [
    {
      id: "uat-txn-grocer-2",
      accountId: CHECKING_ID,
      date: dayInMonth(month, 6),
      amountCents: 8_432,
      isoCurrency: "USD",
      name: "GREEN HILLS MARKET #204",
      merchant: "Green Hills Market",
      plaidCategory: "FOOD_AND_DRINK_GROCERIES",
      categoryId: "groceries",
      pending: false,
      pendingTransactionId: null,
      categorizedBy: "plaid-map"
    },
    {
      id: "uat-txn-coffee-1",
      accountId: CHECKING_ID,
      date: dayInMonth(month, 5),
      amountCents: 675,
      isoCurrency: "USD",
      name: "BLUE BOTTLE COFFEE OAK",
      merchant: "Blue Bottle Coffee",
      plaidCategory: null,
      categoryId: null,
      pending: false,
      pendingTransactionId: null,
      categorizedBy: null
    },
    {
      id: "uat-txn-rent-1",
      accountId: CHECKING_ID,
      date: dayInMonth(month, 3),
      amountCents: 185_000,
      isoCurrency: "USD",
      name: "OAKWOOD PROPERTY MGMT",
      merchant: "Oakwood Property Management",
      plaidCategory: "RENT_AND_UTILITIES_RENT",
      categoryId: "rent-mortgage",
      pending: false,
      pendingTransactionId: null,
      categorizedBy: "plaid-map"
    }
  ];

  const savingsTransactions = [
    {
      id: "uat-txn-interest-1",
      accountId: SAVINGS_ID,
      date: dayInMonth(month, 4),
      amountCents: -1_250,
      isoCurrency: "USD",
      name: "INTEREST PAYMENT",
      merchant: null,
      plaidCategory: "INCOME_INTEREST_EARNED",
      categoryId: null,
      pending: false,
      pendingTransactionId: null,
      categorizedBy: null
    }
  ];

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const userKey = (namespace: string, key: string) => ({
      moduleId: MODULE_ID,
      namespace,
      scope: "user" as const,
      ownerUserId: actorUserId,
      key
    });

    await setModuleKvValue(scopedDb, userKey(NS_CONNECTIONS, `item:${ITEM_ID}`), item);
    for (const account of accounts) {
      await setModuleKvValue(scopedDb, userKey(NS_ACCOUNTS, account.accountId), account);
    }
    await setModuleKvValue(scopedDb, userKey(NS_TRANSACTIONS, `${CHECKING_ID}:${month}`), {
      transactions: checkingTransactions
    });
    await setModuleKvValue(scopedDb, userKey(NS_TRANSACTIONS, `${SAVINGS_ID}:${month}`), {
      transactions: savingsTransactions
    });
  });
}
