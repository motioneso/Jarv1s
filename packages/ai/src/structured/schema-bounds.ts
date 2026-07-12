// #915 D6: resource bounds for module-supplied structured-output schemas and prompts. Input
// violations throw because they are module contract bugs; runtime outcomes remain typed results.

export const STRUCTURED_PROMPT_MAX_BYTES = 65_536;
export const STRUCTURED_SCHEMA_MAX_BYTES = 16_384;
export const STRUCTURED_SCHEMA_MAX_DEPTH = 8;
export const STRUCTURED_SCHEMA_MAX_PROPERTIES = 100;
export const STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES = 16;
export const STRUCTURED_RESULT_MAX_BYTES = 131_072;
export const STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const FORBIDDEN_KEYWORDS = new Set([
  "$ref",
  "$dynamicRef",
  "$defs",
  "definitions",
  "pattern",
  "patternProperties"
]);

const COMBINATOR_KEYWORDS: readonly string[] = ["oneOf", "anyOf", "allOf"];

export function assertBoundedStructuredPrompt(prompt: string): void {
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (bytes > STRUCTURED_PROMPT_MAX_BYTES) {
    throw new Error(
      `structured prompt exceeds ${STRUCTURED_PROMPT_MAX_BYTES} bytes (got ${bytes})`
    );
  }
}

export function assertBoundedStructuredSchema(schema: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(schema) ?? "", "utf8");
  if (bytes > STRUCTURED_SCHEMA_MAX_BYTES) {
    throw new Error(
      `structured schema exceeds ${STRUCTURED_SCHEMA_MAX_BYTES} bytes (got ${bytes})`
    );
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("structured schema must be a JSON object");
  }
  if ((schema as Record<string, unknown>).type !== "object") {
    throw new Error('structured schema root must have type: "object"');
  }

  let totalProperties = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > STRUCTURED_SCHEMA_MAX_DEPTH) {
      throw new Error(`structured schema exceeds max depth ${STRUCTURED_SCHEMA_MAX_DEPTH}`);
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth);
      return;
    }
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYWORDS.has(key)) {
        throw new Error(`structured schema keyword "${key}" is not allowed`);
      }
      if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
        totalProperties += Object.keys(value).length;
        if (totalProperties > STRUCTURED_SCHEMA_MAX_PROPERTIES) {
          throw new Error(
            `structured schema exceeds ${STRUCTURED_SCHEMA_MAX_PROPERTIES} total properties`
          );
        }
      }
      if (COMBINATOR_KEYWORDS.includes(key) && Array.isArray(value)) {
        if (value.length > STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES) {
          throw new Error(
            `structured schema combinator exceeds ${STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES} branches`
          );
        }
      }
      walk(value, depth + 1);
    }
  };
  walk(schema, 0);
}
