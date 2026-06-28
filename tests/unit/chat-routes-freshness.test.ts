import { describe, expect, it } from "vitest";
import { readSourceFreshness } from "../../packages/chat/src/routes.js";
import type { SourceFreshnessV1 } from "@jarv1s/shared";

describe("readSourceFreshness", () => {
  it("returns null for undefined input", () => {
    expect(readSourceFreshness(undefined)).toBeNull();
  });
  it("returns null for non-object input", () => {
    expect(readSourceFreshness("string")).toBeNull();
    expect(readSourceFreshness(42)).toBeNull();
  });
  it("returns null when version is not 1", () => {
    expect(readSourceFreshness({ version: 2, capturedAt: "x", sources: [] })).toBeNull();
  });
  it("parses a valid SourceFreshnessV1 blob", () => {
    const blob: SourceFreshnessV1 = {
      version: 1,
      capturedAt: "2026-06-28T09:00:00.000Z",
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" }
      ]
    };
    const result = readSourceFreshness(blob);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.sources[0]!.source).toBe("email");
  });
  it("filters out malformed source entries", () => {
    const blob = {
      version: 1,
      capturedAt: "2026-06-28T09:00:00.000Z",
      sources: [
        { source: "email", freshnessKind: "connector_sync", asOf: "2026-06-27T22:00:00.000Z" },
        { source: 42, freshnessKind: "realtime", asOf: null },
        { source: "tasks", freshnessKind: "realtime", asOf: "2026-06-28T09:00:00.000Z" }
      ]
    };
    expect(readSourceFreshness(blob)!.sources).toHaveLength(2);
  });
});
