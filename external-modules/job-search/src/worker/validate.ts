// external-modules/job-search/src/worker/validate.ts
//
// JS-03 (#932) Task 4: tool-input readers. Every error names the offending
// KEY and the violated CONSTRAINT only — never the value. Tool inputs carry
// pasted resume text, and validation errors flow back through RPC results
// where echoed content would leak (same discipline as JobSearchKvError).

export class InputError extends Error {
  readonly code = "invalid_input";

  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(
  input: Record<string, unknown>,
  key: string,
  opts: { required: true; maxBytes?: number }
): string;
export function readString(
  input: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean; maxBytes?: number }
): string | undefined;
export function readString(
  input: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; maxBytes?: number } = {}
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (opts.required) {
      throw new InputError(`${key} is required`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new InputError(`${key} must be a string`);
  }
  if (opts.maxBytes !== undefined && Buffer.byteLength(value, "utf8") > opts.maxBytes) {
    // Fixed copy — never the computed size, never the content.
    throw new InputError(`${key} exceeds ${opts.maxBytes} bytes of UTF-8`);
  }
  return value;
}

export function readBool(
  input: Record<string, unknown>,
  key: string,
  opts: { required: true }
): boolean;
export function readBool(
  input: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean }
): boolean | undefined;
export function readBool(
  input: Record<string, unknown>,
  key: string,
  opts: { required?: boolean } = {}
): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (opts.required) {
      throw new InputError(`${key} is required`);
    }
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new InputError(`${key} must be a boolean`);
  }
  return value;
}

export function readPlainObject(
  input: Record<string, unknown>,
  key: string,
  opts: { required: true }
): Record<string, unknown>;
export function readPlainObject(
  input: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean }
): Record<string, unknown> | undefined;
export function readPlainObject(
  input: Record<string, unknown>,
  key: string,
  opts: { required?: boolean } = {}
): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (opts.required) {
      throw new InputError(`${key} is required`);
    }
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new InputError(`${key} must be an object`);
  }
  return value;
}

export function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
  opts: { required: true }
): T;
export function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
  opts?: { required?: boolean }
): T | undefined;
export function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
  opts: { required?: boolean } = {}
): T | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (opts.required) {
      throw new InputError(`${key} is required`);
    }
    return undefined;
  }
  // Allowed values are our own constants — safe to name; the input is not.
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new InputError(`${key} must be one of: ${values.join(", ")}`);
  }
  return value as T;
}
