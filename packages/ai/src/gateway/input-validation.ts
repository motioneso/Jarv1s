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

interface SchemaNode {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly required?: readonly string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
}

function joinPath(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

function validateObject(schema: SchemaNode, value: ToolInput, basePath: string): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in value)) {
      throw new ToolInputValidationError(`Missing required field: ${joinPath(basePath, key)}`);
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, declared] of Object.entries(properties)) {
    if (!(key in value)) {
      continue;
    }
    validateValue(declared, value[key], joinPath(basePath, key));
  }
}

function validateValue(schema: SchemaNode, value: unknown, path: string): void {
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    const allowed = schema.enum.map((option) => JSON.stringify(option)).join(", ");
    throw new ToolInputValidationError(`Field ${path} must be one of: ${allowed}`);
  }

  if (schema.type !== undefined) {
    const check = JSON_TYPE_OF[schema.type];
    if (check && !check(value)) {
      throw new ToolInputValidationError(`Field ${path} must be a ${schema.type}`);
    }
  }

  if (schema.type === "object" && schema.properties) {
    validateObject(schema, value as ToolInput, path);
  }

  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, index) =>
      validateValue(schema.items as SchemaNode, item, `${path}[${index}]`)
    );
  }
}

/**
 * Dependency-free structural validation for assistant-tool input. This is the
 * security chokepoint for caller-supplied tool input on the gateway/REST paths,
 * so it enforces the structural constraints that matter for safety:
 *   - the top-level input is a JSON object;
 *   - all `required` keys are present, recursively into nested objects;
 *   - each declared property matches its `type`
 *     (string/number/boolean/object/array);
 *   - `enum` membership, and `array` `items` types, recursively.
 *
 * It deliberately does NOT enforce `format`, `pattern`, numeric bounds
 * (minimum/maximum), `additionalProperties`, or composition keywords
 * (`oneOf`/`anyOf`/`allOf`/`$ref`). Callers MUST NOT treat a passing result as
 * full JSON-Schema conformance. When a real module ships a schema that needs
 * those, swap in a full validator (ajv) rather than extending this by hand (#133).
 */
export function validateToolInput(schema: JsonSchema | undefined, input: unknown): ToolInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputValidationError("Tool input must be an object");
  }
  const value = input as ToolInput;
  if (!schema) {
    return value;
  }

  validateObject(schema as SchemaNode, value, "");

  return value;
}
