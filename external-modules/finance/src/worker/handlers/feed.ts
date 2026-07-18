// external-modules/finance/src/worker/handlers/feed.ts
//
// FIN-02 (#1147) Task 10: the feed surface. transactions.query is the web
// page's single read (transactions + categories + accounts in one call, so
// the feed renders off one round-trip); transaction.categorize is the
// assistant write path (provenance "user", optional notes/createRule); and
// categorize.apply is the SAME category-set logic behind the
// finance.categorize-apply queue — the web path, which per D4/D6 carries the
// four identifier ids only. Notes never ride a job payload.
import type { Category, Rule, TransactionChunk, TransactionRecord } from "../../domain/index.js";
import { contentHash, DEFAULT_CATEGORIES, normalizePayee, NS } from "../../domain/index.js";
import type { WorkerPorts } from "../ports.js";
import type { ToolFactory } from "../registry.js";
import { InputError, readBool, readInt, readString } from "../validate.js";
import { accountsListHandler } from "./accounts.js";

const MONTH = /^\d{4}-\d{2}$/;

function readMonth(input: Record<string, unknown>, ports: WorkerPorts): string {
  const month = readString(input, "month");
  if (month === undefined) return ports.now().toISOString().slice(0, 7);
  if (!MONTH.test(month)) throw new InputError("month must be YYYY-MM");
  return month;
}

/**
 * Read the stored taxonomy without seeding it — the sync run is the only
 * writer (Task 9 loadCategorizeCtx), so a pre-first-sync feed just sees the
 * defaults. Keeping reads side-effect free also keeps query safe to retry.
 */
async function loadCategories(ports: WorkerPorts): Promise<Category[]> {
  const stored = (await ports.kv.get(NS.categories, "taxonomy")) as {
    categories: Category[];
  } | null;
  return stored?.categories ?? [...DEFAULT_CATEGORIES];
}

export const transactionsQueryHandler: ToolFactory = (ports) => async (input) => {
  const month = readMonth(input, ports);
  const accountId = readString(input, "accountId");
  const categoryId = readString(input, "categoryId");
  const search = readString(input, "search")?.toLowerCase();
  const pendingOnly = readBool(input, "pendingOnly") ?? false;
  const limit = readInt(input, "limit", { min: 1, max: 200 }) ?? 50;

  // Chunk keys are "accountId:YYYY-MM" (domain/keys.ts) — one get per
  // account for the requested month, or a suffix scan across all accounts.
  const keys = accountId
    ? [`${accountId}:${month}`]
    : (await ports.kv.list(NS.transactions)).filter((key) => key.endsWith(`:${month}`));

  let transactions: TransactionRecord[] = [];
  for (const key of keys) {
    const chunk = (await ports.kv.get(NS.transactions, key)) as TransactionChunk | null;
    if (chunk) transactions.push(...chunk.transactions);
  }
  if (categoryId !== undefined) {
    transactions = transactions.filter((record) => record.categoryId === categoryId);
  }
  if (search !== undefined) {
    transactions = transactions.filter(
      (record) =>
        record.name.toLowerCase().includes(search) ||
        (record.merchant ?? "").toLowerCase().includes(search)
    );
  }
  if (pendingOnly) transactions = transactions.filter((record) => record.pending);
  // Chunks are date-desc/id-asc internally; re-sort after the cross-account
  // merge so the feed order is stable regardless of kv.list order.
  transactions.sort((a, b) =>
    a.date !== b.date ? (a.date > b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  transactions = transactions.slice(0, limit);

  const accounts = await accountsListHandler(ports)({});
  return {
    month,
    transactions,
    categories: await loadCategories(ports),
    accounts: (accounts.accounts as unknown[] | undefined) ?? []
  };
};

type ApplyIds = { transactionId: string; accountId: string; month: string; categoryId: string };

function readApplyIds(input: Record<string, unknown>): ApplyIds {
  const month = readString(input, "month", { required: true });
  if (!MONTH.test(month)) throw new InputError("month must be YYYY-MM");
  return {
    transactionId: readString(input, "transactionId", { required: true }),
    accountId: readString(input, "accountId", { required: true }),
    month,
    categoryId: readString(input, "categoryId", { required: true })
  };
}

/**
 * The one category-set path shared by the assistant tool and the queue job:
 * validates the category against the LIVE taxonomy, stamps provenance
 * "user" (both paths are user-initiated), and returns the updated record so
 * callers can layer notes/rules on top before persisting.
 */
async function applyCategory(
  ports: WorkerPorts,
  ids: ApplyIds
): Promise<{ chunkKey: string; chunk: TransactionChunk; record: TransactionRecord }> {
  const live = (await loadCategories(ports)).filter((category) => !category.archived);
  if (!live.some((category) => category.id === ids.categoryId)) {
    throw new InputError("invalid_category", "categoryId is not a live category");
  }
  const chunkKey = `${ids.accountId}:${ids.month}`;
  const chunk = (await ports.kv.get(NS.transactions, chunkKey)) as TransactionChunk | null;
  const record = chunk?.transactions.find((entry) => entry.id === ids.transactionId);
  if (!chunk || !record) {
    // Names the condition only — ids from a queue payload are still inputs.
    throw new InputError("not_found", "no transaction matches the given ids");
  }
  record.categoryId = ids.categoryId;
  record.categorizedBy = "user";
  return { chunkKey, chunk, record };
}

export const transactionCategorizeHandler: ToolFactory = (ports) => async (input) => {
  const ids = readApplyIds(input);
  // Manifest caps notes at 500 chars; 2000 bytes covers 4-byte UTF-8 worst case.
  const notes = readString(input, "notes", { maxBytes: 2000 });
  const createRule = readBool(input, "createRule") ?? false;

  const { chunkKey, chunk, record } = await applyCategory(ports, ids);
  if (notes !== undefined) record.notes = notes;
  await ports.kv.set(NS.transactions, chunkKey, chunk);

  let rule: Rule | undefined;
  if (createRule) {
    // Rule key = hash of the normalized payee (never payee prose as key
    // material); upsert so re-ruling the same payee replaces the category.
    rule = {
      payeeKey: normalizePayee(record.name),
      categoryId: ids.categoryId,
      createdAt: ports.now().toISOString()
    };
    await ports.kv.set(NS.rules, contentHash(rule.payeeKey), rule);
  }
  return { status: "ok", transaction: record, ...(rule ? { rule } : {}) };
};

export const categorizeApplyHandler: ToolFactory = (ports) => async (input) => {
  // Queue path (D6): the four identifier ids only. The manifest paramsSchema
  // rejects extra keys host-side; ignoring the rest here is defense in depth.
  const ids = readApplyIds(input);
  const { chunkKey, chunk, record } = await applyCategory(ports, ids);
  await ports.kv.set(NS.transactions, chunkKey, chunk);
  return { status: "ok", transaction: record };
};
