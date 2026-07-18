// tests/unit/external-module-finance-categorize.test.ts
import { describe, expect, it } from "vitest";

import { categorize } from "../../external-modules/finance/src/domain/categorize.js";
import type { AiTxInput, Rule } from "../../external-modules/finance/src/domain/categorize.js";
import type { TransactionRecord } from "../../external-modules/finance/src/domain/index.js";
import { DEFAULT_CATEGORIES, PFC_MAP } from "../../external-modules/finance/src/domain/taxonomy.js";
import { buildCategorizeAi } from "../../external-modules/finance/src/worker/ai-port.js";
import type { FinanceAiInput } from "../../external-modules/finance/src/worker/ports.js";

// FIN-02 (#1147) Task 9: the categorization pipeline. PURE apart from the
// injected ai callback: precedence is rule → PFC map → AI, user-categorized
// records are never touched, and AI is best-effort only — a null port, a
// thrown call, or a bogus category id must never block the sync that carries
// the records.

function tx(over: Partial<TransactionRecord> & { id: string }): TransactionRecord {
  return {
    accountId: "acc-1",
    date: "2026-07-10",
    amountCents: 1234,
    isoCurrency: "USD",
    name: "ACME",
    merchant: null,
    plaidCategory: null,
    categoryId: null,
    pending: false,
    pendingTransactionId: null,
    categorizedBy: null,
    ...over
  };
}

const RULES: Rule[] = [
  { payeeKey: "trader joes", categoryId: "groceries", createdAt: "2026-07-01T00:00:00Z" }
];

describe("finance categorization pipeline (#1147)", () => {
  it("applies precedence: rule beats PFC map beats AI", async () => {
    const calls: AiTxInput[][] = [];
    const ai = async (batch: AiTxInput[]) => {
      calls.push(batch);
      return { "t-ai": "entertainment" };
    };
    const result = await categorize(
      [
        // Rule match AND a mappable Plaid category: the rule must win.
        tx({ id: "t-rule", name: "TRADER JOE'S #123", plaidCategory: "GENERAL_MERCHANDISE" }),
        tx({ id: "t-pfc", name: "Some Diner", plaidCategory: "FOOD_AND_DRINK" }),
        tx({ id: "t-ai", name: "Mystery Vendor" })
      ],
      RULES,
      [...DEFAULT_CATEGORIES],
      ai
    );
    const byId = Object.fromEntries(result.map((record) => [record.id, record]));
    expect(byId["t-rule"]).toMatchObject({ categoryId: "groceries", categorizedBy: "rule" });
    expect(byId["t-pfc"]).toMatchObject({ categoryId: "dining", categorizedBy: "plaid-map" });
    expect(byId["t-ai"]).toMatchObject({ categoryId: "entertainment", categorizedBy: "ai" });
    // Only the record neither stage could place reaches the AI.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((item) => item.id)).toEqual(["t-ai"]);
  });

  it("never touches user-categorized or already-categorized records", async () => {
    const calls: AiTxInput[][] = [];
    const ai = async (batch: AiTxInput[]) => {
      calls.push(batch);
      return {};
    };
    const user = tx({
      id: "t-user",
      name: "TRADER JOE'S #9",
      categoryId: "dining",
      categorizedBy: "user"
    });
    const prior = tx({ id: "t-prior", categoryId: "transport", categorizedBy: "ai" });
    const result = await categorize([user, prior], RULES, [...DEFAULT_CATEGORIES], ai);
    expect(result.find((record) => record.id === "t-user")).toEqual(user);
    expect(result.find((record) => record.id === "t-prior")).toEqual(prior);
    expect(calls).toHaveLength(0);
  });

  it("chunks AI batches at 40 and sends payee/amount/date only", async () => {
    const calls: Array<{ batch: AiTxInput[]; categoryIds: string[] }> = [];
    const ai = async (batch: AiTxInput[], categoryIds: string[]) => {
      calls.push({ batch, categoryIds });
      return {};
    };
    const records = Array.from({ length: 85 }, (_, index) =>
      tx({ id: `t-${index}`, name: `Vendor ${index}`, notes: "PRIVATE NOTE" })
    );
    await categorize(records, [], [...DEFAULT_CATEGORIES], ai);
    expect(calls.map((call) => call.batch.length)).toEqual([40, 40, 5]);
    // The AI input surface is a hard privacy boundary: id for correlation,
    // then payee/amount/date — never notes, merchant, or account ids.
    for (const call of calls) {
      for (const item of call.batch) {
        expect(Object.keys(item).sort()).toEqual(["amountCents", "date", "id", "payee"]);
      }
      expect(call.categoryIds).toEqual(DEFAULT_CATEGORIES.map((category) => category.id));
    }
  });

  it("leaves records uncategorized when the AI callback throws", async () => {
    const result = await categorize(
      [tx({ id: "t-1" }), tx({ id: "t-2", plaidCategory: "TRAVEL" })],
      [],
      [...DEFAULT_CATEGORIES],
      async () => {
        throw new Error("provider_error");
      }
    );
    const byId = Object.fromEntries(result.map((record) => [record.id, record]));
    // The mapped record is still applied — AI failure only affects its batch.
    expect(byId["t-2"]).toMatchObject({ categoryId: "travel", categorizedBy: "plaid-map" });
    expect(byId["t-1"]).toMatchObject({ categoryId: null, categorizedBy: null });
  });

  it("leaves records uncategorized when no AI port exists", async () => {
    const result = await categorize([tx({ id: "t-1" })], [], [...DEFAULT_CATEGORIES], null);
    expect(result[0]).toMatchObject({ categoryId: null, categorizedBy: null });
  });

  it("drops unknown category ids returned by the AI", async () => {
    const result = await categorize(
      [tx({ id: "t-1" }), tx({ id: "t-2" })],
      [],
      [...DEFAULT_CATEGORIES],
      async () => ({ "t-1": "not-a-category", "t-2": "dining" })
    );
    const byId = Object.fromEntries(result.map((record) => [record.id, record]));
    expect(byId["t-1"]).toMatchObject({ categoryId: null, categorizedBy: null });
    expect(byId["t-2"]).toMatchObject({ categoryId: "dining", categorizedBy: "ai" });
  });

  it("bridge asks ctx.ai for a schema-constrained id map on the economy tier", async () => {
    const inputs: FinanceAiInput[] = [];
    const call = buildCategorizeAi({
      generateStructured: async (input) => {
        inputs.push(input);
        return { ok: true, object: { "t-1": "dining", "t-2": 42 } };
      }
    })!;
    const result = await call(
      [{ id: "t-1", payee: "Corner Bakery", amountCents: 850, date: "2026-07-02" }],
      ["dining", "travel"]
    );
    // Non-string values are dropped at the bridge; id validation happens in
    // the pipeline (single place for the unknown-id rule).
    expect(result).toEqual({ "t-1": "dining" });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.tierHint).toBe("economy");
    expect(inputs[0]!.prompt).toContain("Corner Bakery");
    // The schema constrains every value to the live category ids.
    expect(JSON.stringify(inputs[0]!.schema)).toContain('"dining","travel"');
  });

  it("bridge degrades to an empty map on a failed or malformed AI result", async () => {
    const failed = buildCategorizeAi({
      generateStructured: async () => ({ ok: false, error: "provider_error" })
    })!;
    expect(await failed([], ["dining"])).toEqual({});
    const malformed = buildCategorizeAi({
      generateStructured: async () => ({ ok: true, object: "dining" })
    })!;
    expect(await malformed([], ["dining"])).toEqual({});
    expect(buildCategorizeAi(null)).toBeNull();
  });

  it("seed taxonomy covers every PFC map target with unique live ids", () => {
    const ids = DEFAULT_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of DEFAULT_CATEGORIES) expect(category.archived).toBe(false);
    for (const [pfc, categoryId] of Object.entries(PFC_MAP)) {
      expect(ids, `PFC_MAP[${pfc}]`).toContain(categoryId);
    }
  });
});
