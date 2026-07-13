import { describe, expect, it } from "vitest";
import { UAT_SEED_BASE_TIMESTAMP, daysBefore, daysAfter } from "./timestamps.js";

describe("uat seed timestamps", () => {
  it("derives dates from the fixed base timestamp, never the wall clock", () => {
    // #1025/#1000: the seed must be deterministic — any "recent" date is an offset
    // from a fixed epoch, never Date.now(), or the seed (and any assertion built
    // against it) flakes run to run.
    expect(UAT_SEED_BASE_TIMESTAMP.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(daysBefore(UAT_SEED_BASE_TIMESTAMP, 3).toISOString()).toBe("2026-01-12T12:00:00.000Z");
    expect(daysAfter(UAT_SEED_BASE_TIMESTAMP, 2).toISOString()).toBe("2026-01-17T12:00:00.000Z");
  });
});
