// external-modules/finance/src/worker/handlers/sync.ts
//
// FIN-01 (#1146) Task 6: the sync engine. ONE handler serves both the
// finance.sync-run queue (posted by the finance.sync-sweep schedule) and the
// finance.sync.run-now assistant tool (D3) — the queue's one-job-per-user
// singleton policy is what serializes token-map and chunk access, so the
// handler itself stays a plain sequential loop over connected items.
//
// Durability model: /transactions/sync pages are applied via the pure,
// idempotent reducer (domain/reduce.ts) and the item's cursor is persisted
// only AFTER that page's chunks are written. A crash between the two writes
// replays the page on the next run; the reducer makes the replay a no-op.
import { PlaidError } from "../../adapters/plaid.js";
import type {
  Category,
  CategorizeAi,
  ChunkMap,
  FinanceKv,
  ItemRecord,
  Rule,
  TransactionChunk
} from "../../domain/index.js";
import {
  categorize,
  cursorKey,
  DEFAULT_CATEGORIES,
  itemKey,
  monthKey,
  NS,
  prevMonthKey,
  reduceSyncPage
} from "../../domain/index.js";
import { buildCategorizeAi } from "../ai-port.js";
import type { WorkerPorts } from "../ports.js";
import type { ToolFactory } from "../registry.js";
import { InputError } from "../validate.js";
import { buildPlaid, loadItems } from "./connect.js";

// Plaid pages are capped at count:100 (adapter), so 20 pages = 2000
// transactions per item per run — far above a personal account's churn, low
// enough to bound a runaway loop. Progress is durable (cursor per page), so
// a truncated run simply resumes at the next sweep.
const MAX_PAGES_PER_RUN = 20;

type ItemResult = {
  itemId: string;
  status: ItemRecord["status"];
  added: number;
  modified: number;
  removed: number;
  pages: number;
};

/** Loaded once per run and shared across items/pages. */
type CategorizeCtx = { rules: Rule[]; categories: Category[]; ai: CategorizeAi | null };

/**
 * FIN-02 (#1147) Task 9: load the categorization inputs, seeding the default
 * taxonomy on first read — the feed and rules always need a category list to
 * resolve against, and seeding here (the only writer besides the user's own
 * edits) keeps the read path elsewhere side-effect free.
 */
async function loadCategorizeCtx(ports: WorkerPorts): Promise<CategorizeCtx> {
  let stored = (await ports.kv.get(NS.categories, "taxonomy")) as {
    categories: Category[];
  } | null;
  if (stored === null) {
    stored = { categories: [...DEFAULT_CATEGORIES] };
    await ports.kv.set(NS.categories, "taxonomy", stored);
  }
  const rules: Rule[] = [];
  for (const key of await ports.kv.list(NS.rules)) {
    const rule = await ports.kv.get(NS.rules, key);
    if (rule) rules.push(rule as Rule);
  }
  return { rules, categories: stored.categories, ai: buildCategorizeAi(ports.ai) };
}

/**
 * Run the pipeline over every record in this page's touched chunks. Settled
 * records (user/prior-run) pass through untouched, so replaying a page stays
 * idempotent; AI failure leaves records uncategorized without blocking sync.
 */
async function categorizeChunks(
  chunks: ChunkMap,
  touched: readonly string[],
  ctx: CategorizeCtx
): Promise<ChunkMap> {
  const records = touched.flatMap((key) => chunks[key]?.transactions ?? []);
  const updated = await categorize(records, ctx.rules, ctx.categories, ctx.ai);
  const byId = new Map(updated.map((record) => [record.id, record]));
  const next: ChunkMap = { ...chunks };
  for (const key of touched) {
    next[key] = {
      transactions: (chunks[key]?.transactions ?? []).map((record) => byId.get(record.id) ?? record)
    };
  }
  return next;
}

async function readCursor(kv: FinanceKv, itemId: string): Promise<string | null> {
  const record = await kv.get(NS.connections, cursorKey(itemId));
  return typeof record?.cursor === "string" ? record.cursor : null;
}

/** Write today's balance into the account's month snapshot, once per day. */
async function appendSnapshots(
  kv: FinanceKv,
  accounts: { accountId: string; balanceCents: number }[],
  today: string
): Promise<void> {
  for (const account of accounts) {
    const key = monthKey(account.accountId, today);
    const chunk = ((await kv.get(NS.snapshots, key)) ?? { days: {} }) as {
      days: Record<string, number>;
    };
    // First write of the day wins: the sweep runs every 6 hours and run-now
    // is user-triggered — re-recording would rewrite history mid-day.
    if (chunk.days[today] !== undefined) continue;
    chunk.days[today] = account.balanceCents;
    await kv.set(NS.snapshots, key, chunk);
  }
}

async function syncItem(
  ports: WorkerPorts,
  plaid: Awaited<ReturnType<typeof buildPlaid>>,
  item: ItemRecord,
  accessToken: string,
  categorizeCtx: CategorizeCtx
): Promise<Omit<ItemResult, "itemId" | "status">> {
  const nowIso = ports.now().toISOString();
  const today = nowIso.slice(0, 10);

  // Balances first: cheap, and the feed's account cards should be fresh
  // even when the transaction loop later truncates at the page bound.
  const { accounts } = await plaid.accountsBalanceGet(accessToken);
  for (const account of accounts) {
    await ports.kv.set(NS.accounts, account.accountId, {
      ...account,
      itemId: item.itemId,
      updatedAt: nowIso
    });
  }
  await appendSnapshots(ports.kv, accounts, today);

  let cursor = await readCursor(ports.kv, item.itemId);
  const counts = { added: 0, modified: 0, removed: 0, pages: 0 };
  let hasMore = true;
  while (hasMore && counts.pages < MAX_PAGES_PER_RUN) {
    const page = await plaid.transactionsSync(accessToken, cursor);
    counts.pages += 1;

    // Load exactly the months this page touches, plus each month's
    // predecessor — the only chunk where a posted tx's pending twin can hide.
    const keys = new Set<string>();
    for (const tx of [...page.added, ...page.modified]) {
      keys.add(monthKey(tx.account_id, tx.date));
      keys.add(prevMonthKey(tx.account_id, tx.date));
    }
    const chunks: ChunkMap = {};
    for (const key of keys) {
      const stored = await ports.kv.get(NS.transactions, key);
      if (stored) chunks[key] = stored as TransactionChunk;
    }

    const reduced = reduceSyncPage(chunks, page);
    const next = await categorizeChunks(reduced.chunks, reduced.touched, categorizeCtx);
    for (const key of reduced.touched) {
      await ports.kv.set(NS.transactions, key, next[key]!);
    }
    // Cursor LAST (see header): only after this page's chunks are durable.
    await ports.kv.set(NS.connections, cursorKey(item.itemId), { cursor: page.nextCursor });

    counts.added += page.added.length;
    counts.modified += page.modified.length;
    counts.removed += page.removed.length;
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }
  return counts;
}

export const syncRunHandler: ToolFactory = (ports) => async () => {
  const items = await loadItems(ports.kv);
  if (items.length === 0) return { status: "ok", items: [] };

  // D5 clobber guard (same rule as connect.poll): a null token read with
  // items on record is indistinguishable from a transient credential-store
  // failure — abort the run rather than treating every item as token-less.
  const tokens = await ports.tokens.read();
  if (tokens === null) {
    throw new InputError("token_read_failed", "credential read failed; retry sync");
  }

  const plaid = await buildPlaid(ports);
  const categorizeCtx = await loadCategorizeCtx(ports);
  const results: ItemResult[] = [];
  for (const item of items) {
    const entry = tokens[item.itemId];
    if (entry === undefined) {
      // Item on record but no token: unrecoverable without a reconnect.
      // TOKEN_MISSING is our own code (Plaid-style casing), not provider prose.
      await ports.kv.set(NS.connections, itemKey(item.itemId), {
        ...item,
        status: "error",
        lastError: "TOKEN_MISSING"
      });
      results.push({
        itemId: item.itemId,
        status: "error",
        added: 0,
        modified: 0,
        removed: 0,
        pages: 0
      });
      continue;
    }
    try {
      const counts = await syncItem(ports, plaid, item, entry.accessToken, categorizeCtx);
      // Success clears any prior failure state — this is also how a
      // reauth-required item returns to connected after Hosted Link update.
      const { lastError: _cleared, ...rest } = item;
      await ports.kv.set(NS.connections, itemKey(item.itemId), {
        ...rest,
        status: "connected",
        lastSyncAt: ports.now().toISOString()
      });
      results.push({ itemId: item.itemId, status: "connected", ...counts });
    } catch (error) {
      // Item-level isolation: one bank's outage or expired login never
      // blocks the others. Only the Plaid error CODE is recorded (secret
      // hygiene); everything non-Plaid still aborts the run via wrap.
      if (!(error instanceof PlaidError)) throw error;
      const status: ItemRecord["status"] =
        error.code === "ITEM_LOGIN_REQUIRED" ? "reauth-required" : "error";
      await ports.kv.set(NS.connections, itemKey(item.itemId), {
        ...item,
        status,
        lastError: error.code
      });
      results.push({ itemId: item.itemId, status, added: 0, modified: 0, removed: 0, pages: 0 });
    }
  }
  return { status: "ok", items: results };
};
