import { describe, expect, it } from "vitest";

import { sanitizeAssistantToolResult } from "../../packages/ai/src/gateway/output-validation.js";
import type { JsonSchema, ToolResult } from "@jarv1s/module-sdk";

// Direct unit tests for sanitizeAssistantToolResult. Before this file, the function had NO
// dedicated coverage anywhere in the repo — every existing exerciser (gateway-read-tool.test.ts,
// routes.ts's REST invoke path) hits it only incidentally, through a much larger call. Job-search
// is about to become the first module to actually declare an outputSchema (#1336: board.tsx casts
// matches.list's response with zero runtime validation, and job-search.matches.list currently has
// no outputSchema to trigger this function at all — see tsx-tests-not-typechecked memory / #1335),
// so its behavior needs to be pinned down explicitly rather than assumed correct.
describe("sanitizeAssistantToolResult", () => {
  it("throws naming the missing field when a required key is absent", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id", "url"],
      properties: { id: { type: "string" }, url: { type: "string" } }
    };
    const result: ToolResult = { data: { id: "m1" } };

    // This is the exact case that would have caught the stale job-search-web-root.test.tsx mock
    // (#1335's follow-up audit): a fixture/response missing a now-required field must fail loudly,
    // not pass through as if the field were merely absent-but-optional.
    expect(() => sanitizeAssistantToolResult(schema, result)).toThrow(/missing required output field "url"/);
  });

  it("strips an undeclared key rather than merely ignoring it", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } }
    };
    const result: ToolResult = { data: { id: "m1", secret: "should not survive" } };

    const sanitized = sanitizeAssistantToolResult(schema, result);

    expect(sanitized.data).toEqual({ id: "m1" });
    // Prove removal, not truthiness of some other check — the whole point is an allow-list
    // reconstruction, so the key must be structurally absent from the returned object.
    expect(Object.prototype.hasOwnProperty.call(sanitized.data, "secret")).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });

  it("returns the result untouched when no schema is declared (current no-op behavior)", () => {
    const result: ToolResult = { data: { anything: "goes", nested: { ok: true } } };

    const sanitized = sanitizeAssistantToolResult(undefined, result);

    // Pinning this explicitly: an absent outputSchema is the entire reason a wire-shape drift
    // (like #1336's unvalidated board.tsx cast) goes uncaught today. If this ever changes to
    // throw-on-missing-schema instead of no-op, that is a deliberate behavior change and this
    // test should fail loudly to force updating every caller that currently relies on the no-op.
    expect(sanitized).toBe(result);
  });

  it("passes a declared field through as null via the [scalar, null] anyOf form", () => {
    // Mirrors MatchDetail's fit/want: `number | null`, expressed in JSON Schema as an anyOf of
    // the scalar type and "null" (see getScalarTypes in output-validation.ts). A null value on
    // a declared nullable field is a real, meaningful value — not a missing one — and must not
    // be rejected as a type mismatch.
    const schema: JsonSchema = {
      type: "object",
      required: ["id", "fit"],
      properties: {
        id: { type: "string" },
        fit: { anyOf: [{ type: "number" }, { type: "null" }] }
      }
    };
    const result: ToolResult = { data: { id: "m1", fit: null } };

    const sanitized = sanitizeAssistantToolResult(schema, result);

    expect(sanitized.data).toEqual({ id: "m1", fit: null });
  });

  it("also accepts the non-null branch of a declared nullable field", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["fit"],
      properties: { fit: { anyOf: [{ type: "number" }, { type: "null" }] } }
    };
    const result: ToolResult = { data: { fit: 80 } };

    const sanitized = sanitizeAssistantToolResult(schema, result);

    expect(sanitized.data).toEqual({ fit: 80 });
  });

  it("rejects a nullable field's value when it matches neither branch", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["fit"],
      properties: { fit: { anyOf: [{ type: "number" }, { type: "null" }] } }
    };
    const result: ToolResult = { data: { fit: "eighty" } };

    expect(() => sanitizeAssistantToolResult(schema, result)).toThrow(/must be a number or null/);
  });

  it("recurses into arrays of objects, applying the same required-field check per item", () => {
    // Shape mirrors matches.list: { items: BoardMatch[] }, each item required to carry id/url.
    const schema: JsonSchema = {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "url"],
            properties: { id: { type: "string" }, url: { type: "string" } }
          }
        }
      }
    };
    const result: ToolResult = {
      data: { items: [{ id: "m1", url: "https://example.com/1" }, { id: "m2" }] }
    };

    expect(() => sanitizeAssistantToolResult(schema, result)).toThrow(/missing required output field "url"/);
  });

  it("filters columnOrder down to only the schema-declared keys", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } }
    };
    const result: ToolResult = { data: { id: "m1", secret: "x" }, columnOrder: ["id", "secret"] };

    const sanitized = sanitizeAssistantToolResult(schema, result);

    expect(sanitized.columnOrder).toEqual(["id"]);
  });
});
