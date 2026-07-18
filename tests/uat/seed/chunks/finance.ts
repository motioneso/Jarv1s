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
const NS_SNAPSHOTS = "finance.snapshots";
const NS_BUDGETS = "finance.budgets";

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

/** "YYYY-MM" one month before `month` (UTC arithmetic, year rollover safe). */
function previousMonth(month: string): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthIndex - 2, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
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
  // FIN-05 (#1150): a checking→savings transfer pair, ≤3 days apart with
  // opposite amounts, for the auto-pairing heuristic. The checking side is
  // "transfers" (already skipped by the envelope derivation) and the savings
  // side is null (also skipped as uncategorized) — so FIN-03's budget UAT
  // numbers are IDENTICAL pre/post pairing. The reports spec proves pairing
  // happened by the savings leg NOT appearing in uncategorized spending
  // (which stays coffee 675 + interest −1_250 = −575).
  const checkingTransactions = [
    {
      id: "uat-txn-transfer-out-1",
      accountId: CHECKING_ID,
      date: dayInMonth(month, 8),
      amountCents: 50_000,
      isoCurrency: "USD",
      name: "ONLINE TRANSFER TO SAVINGS",
      merchant: null,
      plaidCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      categoryId: "transfers",
      pending: false,
      pendingTransactionId: null,
      categorizedBy: "plaid-map"
    },
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
      id: "uat-txn-transfer-in-1",
      accountId: SAVINGS_ID,
      date: dayInMonth(month, 9),
      amountCents: -50_000,
      isoCurrency: "USD",
      name: "ONLINE TRANSFER FROM CHECKING",
      merchant: null,
      plaidCategory: null,
      categoryId: null,
      pending: false,
      pendingTransactionId: null,
      categorizedBy: null
    },
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

    // FIN-05 (#1150): balance snapshots for the net-worth report. Latest day
    // per account equals the seeded balanceCents, so the derived headline is
    // 254_317 + 1_200_000 = $14,543.17 — a number the spec can assert came
    // from the snapshot series (gaps in the day sequence prove carry-forward,
    // not a live-balance echo).
    await setModuleKvValue(scopedDb, userKey(NS_SNAPSHOTS, `${CHECKING_ID}:${month}`), {
      days: {
        [dayInMonth(month, 2)]: 248_000,
        [dayInMonth(month, 3)]: 250_500,
        [dayInMonth(month, 6)]: 252_100,
        [dayInMonth(month, 9)]: 254_317
      }
    });
    await setModuleKvValue(scopedDb, userKey(NS_SNAPSHOTS, `${SAVINGS_ID}:${month}`), {
      days: {
        [dayInMonth(month, 2)]: 1_198_750,
        [dayInMonth(month, 9)]: 1_200_000
      }
    });

    // FIN-03 (#1148) Task 5: a PRIOR-month assignment ledger (BudgetLedger
    // shape, envelope.ts) — the only budget row seeded. No transactions exist
    // in that month (the feed spec's empty-state assertion depends on that),
    // so the derivation carries both balances forward untouched: current-month
    // groceries available = 20000 − 8432 spent = 11568, rent available =
    // 185000 − 185000 = 0, TBB = −205000 (nothing categorized as income).
    // The budget spec asserts exactly those derived numbers, proving rollover.
    // `state:{month}` caches are deliberately NOT seeded — the status handler
    // must compute them. Still zero credentials (see hygiene note above).
    await setModuleKvValue(scopedDb, userKey(NS_BUDGETS, `ledger:${previousMonth(month)}`), {
      assignments: { groceries: 20_000, "rent-mortgage": 185_000 }
    });
  });
}
