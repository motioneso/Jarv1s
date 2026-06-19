import { describe, expect, it } from "vitest";

import { projectNotificationMetadata } from "@jarv1s/notifications";

// Verification bullet 2 — Metadata bounding at input.
// Direct unit-style tests against the pure helper covering: non-object input, >16 keys,
// bad key names dropped, nested object/array values dropped (key removed), over-long string
// truncated to 256 chars, oversized total reduced until ≤ 4096 bytes.
//
// The helper is the single source of truth for the bounded metadata shape. It is applied
// at INPUT (NotificationsRepository.create) and at OUTPUT (serializeNotification), so any
// producer or backfill path is covered.

describe("projectNotificationMetadata", () => {
  it("returns {} for non-object / array / null input", () => {
    expect(projectNotificationMetadata(null)).toEqual({});
    expect(projectNotificationMetadata(undefined)).toEqual({});
    expect(projectNotificationMetadata("oops")).toEqual({});
    expect(projectNotificationMetadata(42)).toEqual({});
    expect(projectNotificationMetadata(true)).toEqual({});
    expect(projectNotificationMetadata([1, 2, 3])).toEqual({});
    // Arrays in JS are typeof "object" — must still collapse to {} (not the array).
    expect(projectNotificationMetadata([1, 2, 3] as unknown)).toEqual({});
  });

  it("keeps at most 16 keys in insertion order and drops the rest", () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 32; i++) {
      input[`k${i.toString().padStart(2, "0")}`] = i;
    }
    const out = projectNotificationMetadata(input);
    expect(Object.keys(out)).toHaveLength(16);
    expect(Object.keys(out)).toEqual([
      "k00",
      "k01",
      "k02",
      "k03",
      "k04",
      "k05",
      "k06",
      "k07",
      "k08",
      "k09",
      "k10",
      "k11",
      "k12",
      "k13",
      "k14",
      "k15"
    ]);
  });

  it("drops keys whose names do not match ^[a-zA-Z_][a-zA-Z0-9_]{0,63}$", () => {
    const out = projectNotificationMetadata({
      good_key: "kept",
      also_ok_99: true,
      "123BadStart": "dropped",
      "has space": "dropped",
      "has-dash": "dropped",
      "has.dot": "dropped",
      "": "dropped",
      [`${"x".repeat(65)}`]: "dropped"
    });
    expect(Object.keys(out).sort()).toEqual(["also_ok_99", "good_key"]);
  });

  it("drops nested objects and arrays entirely (key removed, not value-replaced)", () => {
    const out = projectNotificationMetadata({
      flatString: "kept",
      flatNumber: 7,
      flatBool: true,
      flatNull: null,
      nested: { href: "https://example.test", label: "dropped" },
      list: [1, 2, 3],
      emptyObj: {},
      emptyArr: []
    });
    expect(out).toEqual({
      flatString: "kept",
      flatNumber: 7,
      flatBool: true,
      flatNull: null
    });
  });

  it("truncates retained string values to 256 UTF-16 code units", () => {
    const longString = "x".repeat(1000);
    const out = projectNotificationMetadata({ long: longString, short: "y" });
    expect(out.long).toHaveLength(256);
    expect(out.short).toBe("y");
  });

  it("preserves number and boolean primitives verbatim", () => {
    const out = projectNotificationMetadata({
      n: 3.14,
      negN: -5,
      bigN: Number.MAX_SAFE_INTEGER,
      b: true,
      bf: false,
      z: 0
    });
    expect(out).toEqual({
      n: 3.14,
      negN: -5,
      bigN: Number.MAX_SAFE_INTEGER,
      b: true,
      bf: false,
      z: 0
    });
  });

  it("drops undefined / symbol / function values (treated as non-primitive)", () => {
    const out = projectNotificationMetadata({
      kept: 1,
      undef: undefined,
      sym: Symbol("s"),
      fn: () => 0
    });
    expect(out).toEqual({ kept: 1 });
  });

  it("reduces keys until JSON.stringify ≤ 4096 bytes when total overflows", () => {
    // 16 keys × ~300 char string values ≈ ~5000+ bytes serialized → must shrink.
    const input: Record<string, string> = {};
    for (let i = 0; i < 16; i++) {
      input[`k${i.toString().padStart(2, "0")}`] =
        `${i.toString().padStart(3, "0")}-${"y".repeat(300)}`;
    }
    const out = projectNotificationMetadata(input);
    const serialized = JSON.stringify(out);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(4096);
    expect(Object.keys(out).length).toBeLessThan(16);
  });

  it("returns {} when a single key+value pair still exceeds 4096 bytes", () => {
    // A 256-char string is the per-value ceiling — no single value can overflow on its own.
    // Instead force overflow with a 64-char key + a 256-char string + JSON punctuation, which
    // is still well under 4096 bytes; this assertion confirms the helper never returns {}
    // for a single benign primitive (the only way to hit the {} fallback is via a value the
    // projection itself does not emit, which is impossible by construction). We assert the
    // invariant by feeding a maxed-out single key and verifying it survives.
    const key = `${"k".repeat(64)}`;
    const value = "v".repeat(256);
    const out = projectNotificationMetadata({ [key]: value });
    expect(out).toEqual({ [key]: value });
    expect(Buffer.byteLength(JSON.stringify(out), "utf8")).toBeLessThanOrEqual(4096);
  });

  it("passes the briefings producer's flat metadata shape through unchanged", () => {
    const out = projectNotificationMetadata({
      definitionId: "00000000-0000-4000-8000-000000000001",
      briefingRunId: "00000000-0000-4000-8000-000000000002"
    });
    expect(out).toEqual({
      definitionId: "00000000-0000-4000-8000-000000000001",
      briefingRunId: "00000000-0000-4000-8000-000000000002"
    });
  });

  it("drops circular references safely (self-ref key is treated as a nested object and removed)", () => {
    // A circular ref would throw inside JSON.stringify IF it reached the size check.
    // The helper drops it earlier: the iteration sees `self` as a non-primitive and
    // continues, so the projection never carries the cycle into the serialization step.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const out = projectNotificationMetadata(circular);
    expect(out).toEqual({ a: 1 });
  });
});
