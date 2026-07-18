// external-modules/finance/src/worker/wrap.ts
//
// FIN-01 (#1146): error envelope for tool handlers (job-search wrap.ts
// pattern), extracted from index.ts so tests can pin the handler+envelope
// contract without importing the dispatch module (whose defineModuleWorker
// call is side-effecting at import time).
import { FinanceFetchError } from "../adapters/types.js";
import { FinanceKvError } from "../domain/index.js";
import { InputError } from "./validate.js";

export type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Converts the three scrubbed-by-construction error types into structured
 * results and rethrows everything else (→ generic handler_failed at the
 * protocol layer, no accidental message leak). PlaidError (Task 4, #1146)
 * deliberately stays OUT of this list until its message contract (Plaid
 * error code only, never response bodies) exists with tests.
 */
export function wrap(handler: ToolHandler): ToolHandler {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      if (
        error instanceof FinanceKvError ||
        error instanceof InputError ||
        error instanceof FinanceFetchError
      ) {
        // These error types name keys/constraints only, never record content.
        return { status: "error", code: error.code, message: error.message };
      }
      throw error;
    }
  };
}
