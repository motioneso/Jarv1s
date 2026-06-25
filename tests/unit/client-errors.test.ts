import { describe, expect, it } from "vitest";

import {
  MAX_CLIENT_STACK_CHARS,
  parseClientErrorPayload
} from "../../apps/api/src/error-handling.js";

/**
 * Unit tests for parseClientErrorPayload — the structural allowlist validator
 * for the POST /api/errors sink (#413). Security boundary: malformed/hostile
 * inputs MUST degrade to null (→ 400, not logged), never throw.
 */
describe("parseClientErrorPayload", () => {
  it("accepts a well-formed payload with type + message", () => {
    const out = parseClientErrorPayload({ type: "react_error", message: "boom" });
    expect(out).toEqual({ type: "react_error", message: "boom", stack: undefined });
  });

  it("accepts a payload including a stack", () => {
    const out = parseClientErrorPayload({
      type: "uncaught_error",
      message: "x",
      stack: "at foo (bar.ts:1)"
    });
    expect(out).toEqual({
      type: "uncaught_error",
      message: "x",
      stack: "at foo (bar.ts:1)"
    });
  });

  it("drops unknown fields (allowlist enforcement)", () => {
    const out = parseClientErrorPayload({
      type: "react_error",
      message: "boom",
      extra: "ignored",
      userId: "should-not-survive",
      headers: "attacker-attempt"
    });
    expect(out).toEqual({ type: "react_error", message: "boom", stack: undefined });
    expect(JSON.stringify(out)).not.toContain("ignored");
    expect(JSON.stringify(out)).not.toContain("should-not-survive");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", [1, 2, 3]],
    ["string", "not-an-object"],
    ["number", 42],
    ["boolean", true]
  ])("rejects non-plain-object body: %s", (_label, value) => {
    expect(parseClientErrorPayload(value)).toBeNull();
  });

  it.each([
    ["missing type", { message: "x" }],
    ["empty type", { type: "", message: "x" }],
    ["non-string type", { type: 1, message: "x" }],
    ["missing message", { type: "t" }],
    ["empty message", { type: "t", message: "" }],
    ["non-string message", { type: "t", message: 5 }]
  ])("rejects malformed shape: %s", (_label, value) => {
    expect(parseClientErrorPayload(value)).toBeNull();
  });

  it("rejects non-string stack", () => {
    expect(parseClientErrorPayload({ type: "t", message: "m", stack: 123 })).toBeNull();
  });

  it("accepts a long stack up to and beyond the cap (truncation happens at log time)", () => {
    // The validator does not truncate stack — it just bounds acceptability to "is a string".
    // Truncation to MAX_CLIENT_STACK_CHARS happens in the route handler before logging.
    const longStack = "x".repeat(MAX_CLIENT_STACK_CHARS * 3);
    const out = parseClientErrorPayload({ type: "t", message: "m", stack: longStack });
    expect(out?.stack).toBe(longStack);
  });

  it("rejects overlong type (>100 chars)", () => {
    expect(parseClientErrorPayload({ type: "x".repeat(101), message: "m" })).toBeNull();
  });

  it("rejects overlong message (>500 chars)", () => {
    expect(parseClientErrorPayload({ type: "t", message: "x".repeat(501) })).toBeNull();
  });

  it("never throws on a poisoned object (throws toString/valueOf)", () => {
    const hostile = {
      type: "t",
      message: "m",
      get stack() {
        throw new Error("boom");
      }
    };
    // Accessing .stack to validate would throw a getter; the validator reads it
    // via property access, so this verifies it does NOT crash. If the getter
    // throws during typeof check, that's the hostile case — we still expect null
    // or a payload, but never an uncaught throw crashing the handler.
    let result: unknown;
    expect(() => {
      result = parseClientErrorPayload(hostile);
    }).not.toThrow();
    // Either null (getter threw inside typeof) or a payload without stack — both safe.
    expect(result === null || (typeof result === "object" && result !== null)).toBe(true);
  });
});
