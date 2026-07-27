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
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/** Compiled `pattern` cache — manifests are static, so each pattern compiles once per process
 *  instead of once per tool call. Patterns come from module manifests, which are trusted code
 *  (a manifest also supplies `execute`), so a manifest author who wanted to burn CPU has far more
 *  direct means than a backtracking regex — this is not a new trust boundary. */
const patternCache = new Map<string, RegExp | null>();

function compilePattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    // Anchored on both ends: an unanchored manifest pattern must not be satisfied by a matching
    // substring of a hostile value ("ok/../../etc" vs `[a-z]+`). `(?:...)` keeps any top-level
    // alternation in the manifest pattern inside the anchors.
    compiled = new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    // An unparseable pattern is a manifest bug, not caller input — ignore it here rather than
    // failing every call to that tool. Nothing lints inputSchema patterns at install/build time
    // today (external/validate.ts validates manifest structure only, not inputSchema keywords),
    // so a broken pattern silently degrades that field to unvalidated rather than being caught
    // before it ships. Tracked in #1274.
    compiled = null;
  }
  patternCache.set(pattern, compiled);
  return compiled;
}

/** String bounds (#1265 security QA BLOCKING-1b). These are enforced because modules declare them
 *  as a real safety belt — the sports follow tools bound their catalog keys so a model-supplied
 *  key cannot be arbitrary before it reaches a persisted row and, later, an outbound URL. A
 *  declared bound that nothing enforces is worse than no bound: it reads as protection in review. */
function validateStringBounds(schema: SchemaNode, value: string, path: string): void {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    throw new ToolInputValidationError(
      `Field ${path} must be at least ${schema.minLength} characters`
    );
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    throw new ToolInputValidationError(
      `Field ${path} must be at most ${schema.maxLength} characters`
    );
  }
  if (typeof schema.pattern === "string") {
    const compiled = compilePattern(schema.pattern);
    if (compiled && !compiled.test(value)) {
      throw new ToolInputValidationError(`Field ${path} has an invalid format`);
    }
  }
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

  if (typeof value === "string") {
    validateStringBounds(schema, value, path);
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
 *   - `enum` membership, and `array` `items` types, recursively;
 *   - string `minLength`/`maxLength`/`pattern` (added for #1265 — see below).
 *
 * It deliberately does NOT enforce `format`, numeric bounds (minimum/maximum),
 * `additionalProperties`, or composition keywords (`oneOf`/`anyOf`/`allOf`/`$ref`).
 * Callers MUST NOT treat a passing result as full JSON-Schema conformance. When a
 * real module ships a schema that needs those, swap in a full validator (ajv)
 * rather than extending this by hand (#133).
 *
 * String bounds are the one deliberate exception to that "don't extend by hand"
 * rule (#1265 security QA). The sports follow tools auto-run under a
 * granted_at_install grant and bound their catalog keys with minLength/maxLength/
 * pattern as a safety belt; leaving those keywords unenforced would have shipped a
 * bound that reads as protection in review and does nothing at runtime. Three
 * string keywords are a far smaller change than adopting ajv, and this is the
 * chokepoint every module's tool input passes through.
 *
 * MANIFEST AUTHORS, note two consequences of that change (#1265):
 *   1. `pattern` is matched against the WHOLE string — it is anchored here even
 *      if you wrote it unanchored. An unanchored pattern that used to be
 *      satisfied by a matching substring now requires a full-string match. This
 *      is deliberate: a substring match would let "ok/../../etc" satisfy
 *      `[a-z]+`. Write patterns as if `^...$` were implied, because it is.
 *   2. This applies to EXTERNAL installed modules too. A third-party manifest
 *      that already declares string bounds now has them enforced where it
 *      previously did not, so a bound that was decorative becomes a real
 *      rejection.
 * An unparseable `pattern` is treated as a manifest bug and skipped rather than
 * failing every call to that tool.
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
