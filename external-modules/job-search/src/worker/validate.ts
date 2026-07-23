export class InputError extends Error {
  readonly code: string;

  constructor(message: string, code = "invalid_input") {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}

export function readString(
  input: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxBytes?: number } = {}
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (options.required) throw new InputError(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new InputError(`${key} must be a string`);
  if (options.maxBytes !== undefined && Buffer.byteLength(value, "utf8") > options.maxBytes) {
    throw new InputError(`${key} exceeds ${options.maxBytes} bytes of UTF-8`);
  }
  return value;
}
