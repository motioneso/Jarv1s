import { JobSearchKvError } from "../domain/errors.js";
import { InputError } from "./validate.js";

export type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function wrap(handler: ToolHandler): ToolHandler {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      if (error instanceof InputError) {
        return { status: "error", code: error.code, message: error.message };
      }
      if (error instanceof JobSearchKvError) {
        return { status: "error", code: error.code, message: "Job Search data is unavailable" };
      }
      throw error;
    }
  };
}
