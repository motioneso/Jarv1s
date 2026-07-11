// external-modules/job-search/src/worker/wrap.ts
//
// JS-03 (#932) Task 6: error envelope for tool handlers, extracted from
// index.ts so tests can pin the handler+envelope contract without importing
// the dispatch module (whose defineModuleWorker call is side-effecting).
import { JobSearchFetchError } from "../adapters/types.js";
import { JobSearchKvError } from "../domain/index.js";
import { InputError } from "./validate.js";

export type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Converts the three scrubbed-by-construction error types into structured
 * results and rethrows everything else (→ generic handler_failed at the
 * protocol layer, no accidental message leak).
 */
export function wrap(handler: ToolHandler): ToolHandler {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      if (
        error instanceof JobSearchKvError ||
        error instanceof InputError ||
        error instanceof JobSearchFetchError
      ) {
        // Both error types name keys/constraints only, never record content.
        return { status: "error", code: error.code, message: error.message };
      }
      throw error;
    }
  };
}
