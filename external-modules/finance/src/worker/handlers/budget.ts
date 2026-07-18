// external-modules/finance/src/worker/handlers/budget.ts
//
// FIN-03 (#1148) Task 3: the envelope-budget handlers over the pure
// derivation in domain/envelope.ts (spec delta §"Worker delta").
//
// Storage contract (namespace finance.budgets):
//   ledger:{YYYY-MM} — assignment SOURCE OF TRUTH; assign SETS a total per
//     category (never increments), which keeps the budget-apply queue
//     replay-safe at retryLimit 1.
//   state:{YYYY-MM}  — cached BudgetMonthState, a pure performance
//     projection OWNED BY THE WRITE PATHS. budget.status is a read-risk
//     tool: the host rpc rejects kv.set from read tools with
//     `forbidden_kv_mutation` (worker-rpc-host.ts — surfaced as the UAT
//     run-2 handler_failed), so status recomputes on miss and returns the
//     result WITHOUT persisting. Every write path (assign here, chunk
//     writes in sync.ts) deletes caches ≥ the affected month — carry/TBB
//     flow forward, so deleting is always safe — and assign then re-derives
//     and warms the assigned month's cache.
//
// Two write paths, one apply: the assistant tool (budget.assign) and the
// web queue twin (finance.budget-apply) both converge on applyAssignment.
// The queue handler receives the HOST job envelope {actorUserId, jobKind,
// idempotencyKey, params} — command fields ride in params, never flat
// (the a6023cb7 regression from FIN-02).

import {
  deriveBudgetMonths,
  NS,
  type BudgetLedger,
  type BudgetMonthState,
  type TransactionRecord
} from "../../domain/index.js";
import type { FinanceKv } from "../../domain/index.js";
import type { ToolFactory } from "../registry.js";
import type { WorkerPorts } from "../ports.js";
import { InputError, readInt, readString } from "../validate.js";
import { loadCategories } from "./feed.js";

const MONTH = /^[0-9]{4}-[0-9]{2}$/;
// Mirrors the manifest bound on finance.budget-apply's amountCents param —
// ±$1M in cents. The manifest gate runs host-side; this re-check covers the
// tool path, which never crosses the queue params schema.
const AMOUNT_BOUND = 100_000_000;

const ledgerKey = (month: string) => `ledger:${month}`;
const stateKey = (month: string) => `state:${month}`;

function readMonth(input: Record<string, unknown>): string {
  const month = readString(input, "month", { required: true });
  if (!MONTH.test(month)) {
    throw new InputError("month must be YYYY-MM");
  }
  return month;
}

/**
 * Delete every cached `state:` projection for `month` and all later months.
 * Earlier months are untouched: a month's state derives only from months ≤
 * itself, so a write at `month` cannot stale anything before it.
 */
export async function invalidateBudgetStateFrom(kv: FinanceKv, month: string): Promise<void> {
  const target = stateKey(month);
  for (const key of await kv.list(NS.budgets)) {
    // YYYY-MM is lexicographically ordered, so plain string ≥ is correct.
    if (key.startsWith("state:") && key >= target) {
      await kv.delete(NS.budgets, key);
    }
  }
}

/**
 * Load the full derivation input: every assignment ledger plus every
 * transaction chunk, grouped by the chunk key's month suffix
 * (`{accountId}:{YYYY-MM}` — the reducer files each txn under its date's
 * month, so the key month IS the txn month).
 */
async function loadDerivationInput(kv: FinanceKv): Promise<{
  ledgers: Record<string, BudgetLedger>;
  transactionsByMonth: Record<string, TransactionRecord[]>;
}> {
  const ledgers: Record<string, BudgetLedger> = {};
  for (const key of await kv.list(NS.budgets)) {
    if (!key.startsWith("ledger:")) continue;
    const stored = await kv.get(NS.budgets, key);
    if (stored) ledgers[key.slice("ledger:".length)] = stored as BudgetLedger;
  }

  const transactionsByMonth: Record<string, TransactionRecord[]> = {};
  for (const key of await kv.list(NS.transactions)) {
    const month = key.slice(-7);
    if (!MONTH.test(month)) continue;
    const chunk = (await kv.get(NS.transactions, key)) as {
      transactions?: TransactionRecord[];
    } | null;
    if (!chunk?.transactions?.length) continue;
    (transactionsByMonth[month] ??= []).push(...chunk.transactions);
  }
  return { ledgers, transactionsByMonth };
}

async function computeMonthState(ports: WorkerPorts, month: string): Promise<BudgetMonthState> {
  const input = await loadDerivationInput(ports.kv);
  // Inject the requested month into the derivation union when it has no data
  // of its own: the derivation then rolls carry/TBB forward into it (or
  // yields the all-zero state when there is no data at all).
  if (!input.ledgers[month] && !input.transactionsByMonth[month]) {
    input.ledgers[month] = { assignments: {} };
  }
  const core = deriveBudgetMonths(input)[month]!;
  return { computedAt: ports.now().toISOString(), ...core };
}

export const budgetStatusHandler: ToolFactory = (ports) => async (input) => {
  const month = readMonth(input);
  const cached = (await ports.kv.get(NS.budgets, stateKey(month))) as BudgetMonthState | null;
  // Compute-on-miss, never persist: this tool is risk "read", and the host
  // rejects kv.set from read tools (see storage contract above). The cache
  // only exists when a write path warmed it.
  const state = cached ?? (await computeMonthState(ports, month));
  // Taxonomy rides along so the web budget screen renders names and group
  // order from a single call (same shape transactions.query ships).
  return { month, state, categories: await loadCategories(ports) };
};

/** Shared write path: validate, RMW the ledger, invalidate stale caches. */
async function applyAssignment(
  ports: WorkerPorts,
  args: { month: string; categoryId: string; amountCents: number }
): Promise<Record<string, unknown>> {
  const live = await loadCategories(ports);
  if (!live.some((category) => category.id === args.categoryId)) {
    throw new InputError("invalid_category", "categoryId is not a live category");
  }

  const key = ledgerKey(args.month);
  const ledger = ((await ports.kv.get(NS.budgets, key)) as BudgetLedger | null) ?? {
    assignments: {}
  };
  ledger.assignments[args.categoryId] = args.amountCents;
  await ports.kv.set(NS.budgets, key, ledger);
  await invalidateBudgetStateFrom(ports.kv, args.month);
  // Warm the assigned month's cache from here — the write-risk path — since
  // read-risk status can never persist it. Later months stay cold and are
  // recomputed on demand by status.
  await ports.kv.set(NS.budgets, stateKey(args.month), await computeMonthState(ports, args.month));

  return { status: "ok", ...args };
}

export const budgetAssignHandler: ToolFactory = (ports) => async (input) => {
  const month = readMonth(input);
  const categoryId = readString(input, "categoryId", { required: true });
  const amountCents = readInt(input, "amountCents", {
    required: true,
    min: -AMOUNT_BOUND,
    max: AMOUNT_BOUND
  });
  return applyAssignment(ports, { month, categoryId, amountCents });
};

/** Queue twin of budget.assign — consumes the host job envelope. */
export const budgetApplyHandler: ToolFactory = (ports) => async (input) => {
  const jobKind = readString(input, "jobKind", { required: true });
  if (jobKind !== "finance.budget-apply") {
    throw new InputError("jobKind is not supported by this handler");
  }
  const params = input.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new InputError("params must be an object");
  }
  const command = params as Record<string, unknown>;
  const month = readMonth(command);
  const categoryId = readString(command, "categoryId", { required: true });
  const amountCents = readInt(command, "amountCents", {
    required: true,
    min: -AMOUNT_BOUND,
    max: AMOUNT_BOUND
  });
  return applyAssignment(ports, { month, categoryId, amountCents });
};
