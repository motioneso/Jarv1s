// external-modules/finance/src/domain/taxonomy.ts
//
// FIN-02 (#1147) Task 9: the seed category taxonomy and the Plaid
// personal_finance_category.primary → category map. The taxonomy is seeded
// into finance.categories (key "taxonomy") on first read and owned by the
// user from then on — categories are archived, never deleted, so stored
// transactions keep resolving their categoryId.

export type Category = {
  id: string;
  group: string;
  name: string;
  archived: boolean;
};

const category = (id: string, group: string, name: string): Category => ({
  id,
  group,
  name,
  archived: false
});

export const DEFAULT_CATEGORIES: readonly Category[] = [
  category("rent-mortgage", "fixed", "Rent & mortgage"),
  category("utilities", "fixed", "Utilities"),
  category("insurance", "fixed", "Insurance"),
  category("subscriptions", "fixed", "Subscriptions & services"),
  category("groceries", "everyday", "Groceries"),
  category("dining", "everyday", "Dining & coffee"),
  category("transport", "everyday", "Transport"),
  category("shopping", "everyday", "Shopping"),
  category("fuel", "everyday", "Fuel"),
  category("entertainment", "personal", "Entertainment"),
  category("health", "personal", "Health"),
  category("personal-care", "personal", "Personal care"),
  category("travel", "personal", "Travel"),
  category("savings", "savings-goals", "Savings"),
  category("income", "income", "Income"),
  category("transfers", "transfers", "Transfers")
];

/**
 * Plaid PFC primary → seed category id. Coarse on purpose: the primary tier
 * is stable across Plaid versions, and anything unmapped simply falls through
 * to the AI pass (or stays uncategorized) rather than guessing.
 */
export const PFC_MAP: Readonly<Record<string, string>> = {
  FOOD_AND_DRINK: "dining",
  GENERAL_MERCHANDISE: "shopping",
  RENT_AND_UTILITIES: "utilities",
  TRANSPORTATION: "transport",
  TRAVEL: "travel",
  MEDICAL: "health",
  ENTERTAINMENT: "entertainment",
  INCOME: "income",
  TRANSFER_IN: "transfers",
  TRANSFER_OUT: "transfers",
  LOAN_PAYMENTS: "rent-mortgage",
  BANK_FEES: "subscriptions",
  PERSONAL_CARE: "personal-care",
  GENERAL_SERVICES: "subscriptions",
  GOVERNMENT_AND_NON_PROFIT: "subscriptions",
  HOME_IMPROVEMENT: "shopping"
};
