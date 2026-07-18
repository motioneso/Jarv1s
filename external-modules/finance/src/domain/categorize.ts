// external-modules/finance/src/domain/categorize.ts
//
// FIN-02 (#1147) Task 9: the categorization pipeline. PURE apart from the
// injected ai callback so it unit-tests without a worker context. Precedence
// per uncategorized record: payee rule → PFC map → AI. AI is strictly
// best-effort: a null port, a thrown call, or an unknown category id leaves
// the record uncategorized — categorization must never block the sync run
// that carries the records (they land in the feed either way).
import { normalizePayee } from "./keys.js";
import type { TransactionRecord } from "./records.js";
import type { Category } from "./taxonomy.js";
import { PFC_MAP } from "./taxonomy.js";

export type Rule = { payeeKey: string; categoryId: string; createdAt: string };

/**
 * The AI input surface is a hard privacy boundary: id (for correlating the
 * response), payee, amount, date — never notes, merchant enrichments, or
 * account ids. Keep this type closed; adding a field here widens what leaves
 * the machine in prompts.
 */
export type AiTxInput = { id: string; payee: string; amountCents: number; date: string };

export type CategorizeAi = (
  batch: AiTxInput[],
  categoryIds: string[]
) => Promise<Record<string, string>>;

/** Plaid batches at count:100; 40 keeps prompts small on economy-tier models. */
const AI_BATCH_SIZE = 40;

export async function categorize(
  records: TransactionRecord[],
  rules: Rule[],
  categories: Category[],
  ai: CategorizeAi | null
): Promise<TransactionRecord[]> {
  const ruleByPayee = new Map(rules.map((rule) => [rule.payeeKey, rule.categoryId]));
  const liveIds = categories.filter((entry) => !entry.archived).map((entry) => entry.id);
  const liveIdSet = new Set(liveIds);

  const out: TransactionRecord[] = [];
  const pendingAi: TransactionRecord[] = [];
  for (const record of records) {
    // Anything already placed — by the user, or by an earlier pipeline run —
    // is settled; re-running categorize over a chunk must be idempotent.
    if (record.categoryId !== null || record.categorizedBy !== null) {
      out.push(record);
      continue;
    }
    const ruleCategory = ruleByPayee.get(normalizePayee(record.name));
    if (ruleCategory !== undefined) {
      out.push({ ...record, categoryId: ruleCategory, categorizedBy: "rule" });
      continue;
    }
    const mapped = record.plaidCategory === null ? undefined : PFC_MAP[record.plaidCategory];
    if (mapped !== undefined) {
      out.push({ ...record, categoryId: mapped, categorizedBy: "plaid-map" });
      continue;
    }
    out.push(record);
    pendingAi.push(record);
  }

  if (ai === null || pendingAi.length === 0) return out;

  const assigned = new Map<string, string>();
  for (let start = 0; start < pendingAi.length; start += AI_BATCH_SIZE) {
    const batch = pendingAi.slice(start, start + AI_BATCH_SIZE).map((record) => ({
      id: record.id,
      payee: record.name,
      amountCents: record.amountCents,
      date: record.date
    }));
    try {
      const result = await ai(batch, liveIds);
      for (const [txId, categoryId] of Object.entries(result)) {
        // Unknown/archived ids are dropped, not "closest-matched": a wrong
        // auto-category is worse than an uncategorized row the user can fix.
        if (liveIdSet.has(categoryId)) assigned.set(txId, categoryId);
      }
    } catch {
      // This batch stays uncategorized; later batches still get their shot.
    }
  }
  if (assigned.size === 0) return out;
  return out.map((record) => {
    const categoryId = assigned.get(record.id);
    if (categoryId === undefined || record.categoryId !== null) return record;
    return { ...record, categoryId, categorizedBy: "ai" };
  });
}
