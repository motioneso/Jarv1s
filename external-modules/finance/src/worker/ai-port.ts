// external-modules/finance/src/worker/ai-port.ts
//
// FIN-02 (#1147) Task 9: bridge from the structural ctx.ai port (ports.ts,
// job-search ai-port pattern) to the pipeline's CategorizeAi callback. The
// prompt carries id/payee/amount/date ONLY (AiTxInput is the privacy
// boundary), the schema pins every value to the live category ids, and any
// failure degrades to an empty map — categorization is best-effort by design.
import type { AiTxInput, CategorizeAi } from "../domain/index.js";
import type { FinanceAi } from "./ports.js";

export function buildCategorizeAi(ai: FinanceAi | null): CategorizeAi | null {
  if (ai === null) return null;
  return async (batch: AiTxInput[], categoryIds: string[]) => {
    const result = await ai.generateStructured({
      schema: {
        type: "object",
        additionalProperties: { type: "string", enum: categoryIds }
      },
      prompt: [
        "Assign a budget category to each personal bank transaction below.",
        `Valid category ids: ${categoryIds.join(", ")}.`,
        "Respond with a JSON object mapping each transaction id to one",
        "category id. Omit any transaction you are not confident about.",
        `Transactions: ${JSON.stringify(batch)}`
      ].join("\n"),
      maxOutputTokens: 2000,
      tierHint: "economy"
    });
    if (!result.ok || typeof result.object !== "object" || result.object === null) return {};
    const out: Record<string, string> = {};
    for (const [txId, categoryId] of Object.entries(result.object as Record<string, unknown>)) {
      // Non-string values are dropped here; unknown-id validation stays in
      // the pipeline so the rule lives in exactly one place.
      if (typeof categoryId === "string") out[txId] = categoryId;
    }
    return out;
  };
}
