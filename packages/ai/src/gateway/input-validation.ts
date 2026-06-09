import type { JsonSchema, ToolInput } from "@jarv1s/module-sdk";

export class ToolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputValidationError";
  }
}

const JSON_TYPE_OF: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v)
};

/**
 * Deliberately minimal, dependency-free structural validation (required keys +
 * declared scalar/object/array types). Sufficient for Phase 2 + the fixture; a
 * full JSON-schema validator can replace this when real modules need it.
 */
export function validateToolInput(schema: JsonSchema | undefined, input: unknown): ToolInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputValidationError("Tool input must be an object");
  }
  const value = input as ToolInput;
  if (!schema) {
    return value;
  }

  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in value)) {
      throw new ToolInputValidationError(`Missing required field: ${key}`);
    }
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [key, declared] of Object.entries(properties)) {
    if (!(key in value) || declared.type === undefined) {
      continue;
    }
    const check = JSON_TYPE_OF[declared.type];
    if (check && !check(value[key])) {
      throw new ToolInputValidationError(`Field ${key} must be a ${declared.type}`);
    }
  }

  return value;
}
