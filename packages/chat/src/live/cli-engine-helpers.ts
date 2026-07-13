import { DEFAULT_MODEL_SENTINEL, redactSecrets } from "@jarv1s/ai";

import type { EngineLaunchOpts } from "./types.js";

export function sanitizeInput(text: string): string {
  return text.replace(/^(\s*)!+/, "$1");
}

export function modelOverrideFlag(opts: EngineLaunchOpts): string | null {
  if (!opts.model || opts.model === DEFAULT_MODEL_SENTINEL) return null;
  return `--model ${shellQuote(opts.model)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function redactCause(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const sanitized = new Error(redactSecrets(message));
  sanitized.name = err instanceof Error ? err.name : "Error";
  sanitized.stack = undefined;
  return sanitized;
}
