import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { AiRepository } from "./repository.js";

const repository = new AiRepository();
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const SCAN_LIMIT = 50;
const NO_DATA_MESSAGE =
  "No matching structured error data was found. The feature may not have emitted instrumentation for this error yet.";

function numberLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(1, Math.floor(value)), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function queryTokens(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .split(/[^a-z0-9_/-]+/)
        .filter(Boolean)
    : [];
}

export const aiExplainRecentErrorsExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  const limit = numberLimit(input.limit);
  const tokens = queryTokens(input.query);
  const rows = await repository.listRecentErrors(scopedDb, { limit: SCAN_LIMIT });
  const matches =
    tokens.length === 0
      ? rows
      : rows.filter((row) => {
          const haystack = [
            row.feature,
            row.operation,
            row.error_category,
            row.user_message,
            row.internal_summary
          ]
            .join(" ")
            .toLowerCase();
          return tokens.every((token) => haystack.includes(token));
        });

  if (matches.length === 0) {
    return { data: { errors: [], message: NO_DATA_MESSAGE } };
  }

  return {
    data: {
      errors: matches.slice(0, limit).map((row) => ({
        occurredAt:
          row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
        feature: row.feature,
        operation: row.operation,
        errorCategory: row.error_category,
        retryable: row.retryable,
        userMessage: row.user_message,
        internalSummary: row.internal_summary,
        requestId: row.request_id
      }))
    }
  };
};
