import type { ModuleParamsSchema } from "./index.js";

export function isValidModuleParamsSchema(value: unknown): value is ModuleParamsSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  if (["uuid", "identifier", "timestamp", "boolean", "null"].includes(String(schema.type))) {
    return Object.keys(schema).length === 1;
  }
  if (schema.type === "integer" || schema.type === "number") {
    return (
      Object.keys(schema).every((key) => ["type", "min", "max"].includes(key)) &&
      typeof schema.min === "number" &&
      typeof schema.max === "number" &&
      Number.isFinite(schema.min) &&
      Number.isFinite(schema.max) &&
      schema.min <= schema.max
    );
  }
  if (schema.type === "enum") {
    return (
      Object.keys(schema).every((key) => ["type", "values"].includes(key)) &&
      Array.isArray(schema.values) &&
      schema.values.length > 0 &&
      schema.values.every(
        (item) => typeof item === "string" && /^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(item)
      )
    );
  }
  if (schema.type === "array") {
    return (
      Object.keys(schema).every((key) => ["type", "items", "maxItems"].includes(key)) &&
      Number.isInteger(schema.maxItems) &&
      (schema.maxItems as number) > 0 &&
      isValidModuleParamsSchema(schema.items) &&
      !["array", "object"].includes(schema.items.type)
    );
  }
  if (schema.type !== "object") return false;
  if (
    !Object.keys(schema).every((key) => ["type", "fields"].includes(key)) ||
    !schema.fields ||
    typeof schema.fields !== "object" ||
    Array.isArray(schema.fields)
  ) {
    return false;
  }
  return Object.entries(schema.fields).every(
    ([key, field]) =>
      /^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) &&
      isValidModuleParamsSchema(field) &&
      (field as { type?: unknown }).type !== "object"
  );
}

export function matchesModuleParamsSchema(schema: ModuleParamsSchema, value: unknown): boolean {
  switch (schema.type) {
    case "uuid":
      return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      );
    case "identifier":
      return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(value);
    case "timestamp":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "integer":
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (schema.type !== "integer" || Number.isInteger(value)) &&
        value >= schema.min &&
        value <= schema.max
      );
    case "enum":
      return typeof value === "string" && schema.values.includes(value);
    case "array":
      return (
        Array.isArray(value) &&
        value.length <= schema.maxItems &&
        value.every((item) => matchesModuleParamsSchema(schema.items, item))
      );
    case "object":
      return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.entries(value as Record<string, unknown>).every(
          ([key, item]) =>
            schema.fields[key] !== undefined && matchesModuleParamsSchema(schema.fields[key], item)
        )
      );
  }
}
