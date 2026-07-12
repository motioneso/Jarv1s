import { describe, expect, it } from "vitest";

import {
  STRUCTURED_PROMPT_MAX_BYTES,
  STRUCTURED_SCHEMA_MAX_DEPTH,
  assertBoundedStructuredPrompt,
  assertBoundedStructuredSchema
} from "../../packages/ai/src/structured/schema-bounds.js";

const okSchema = {
  type: "object",
  additionalProperties: false,
  properties: { a: { type: "string" } }
};

describe("assertBoundedStructuredSchema", () => {
  it("accepts a small object schema", () => {
    expect(() => assertBoundedStructuredSchema(okSchema)).not.toThrow();
  });

  it("rejects non-object roots", () => {
    expect(() => assertBoundedStructuredSchema({ type: "string" })).toThrow(/root/);
    expect(() => assertBoundedStructuredSchema("x")).toThrow();
    expect(() => assertBoundedStructuredSchema(null)).toThrow();
    expect(() => assertBoundedStructuredSchema([okSchema])).toThrow();
  });

  it("rejects forbidden keywords anywhere in the tree", () => {
    const forbidden = [
      "$ref",
      "$dynamicRef",
      "$defs",
      "definitions",
      "pattern",
      "patternProperties"
    ];
    for (const key of forbidden) {
      expect(() =>
        assertBoundedStructuredSchema({
          type: "object",
          properties: { a: { type: "string", [key]: "x" } }
        })
      ).toThrow(/not allowed/);
    }
  });

  it("rejects schemas over the byte cap", () => {
    const big = {
      type: "object",
      properties: { a: { type: "string", description: "x".repeat(17_000) } }
    };
    expect(() => assertBoundedStructuredSchema(big)).toThrow(/bytes/);
  });

  it("rejects nesting deeper than the cap", () => {
    let leaf: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < STRUCTURED_SCHEMA_MAX_DEPTH + 2; index += 1) {
      leaf = { type: "object", properties: { nested: leaf } };
    }
    expect(() => assertBoundedStructuredSchema(leaf)).toThrow(/depth/);
  });

  it("rejects more than the total property cap", () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 101; index += 1) properties[`p${index}`] = { type: "string" };
    expect(() => assertBoundedStructuredSchema({ type: "object", properties })).toThrow(
      /properties/
    );
  });

  it("rejects combinators with too many branches", () => {
    const branches = Array.from({ length: 17 }, () => ({ type: "string" }));
    expect(() =>
      assertBoundedStructuredSchema({ type: "object", properties: { a: { oneOf: branches } } })
    ).toThrow(/branches/);
  });
});

describe("assertBoundedStructuredPrompt", () => {
  it("accepts prompts under the cap and rejects over", () => {
    expect(() => assertBoundedStructuredPrompt("hello")).not.toThrow();
    expect(() =>
      assertBoundedStructuredPrompt("x".repeat(STRUCTURED_PROMPT_MAX_BYTES + 1))
    ).toThrow(/bytes/);
  });
});
