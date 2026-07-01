import { describe, expect, it } from "vitest";

import { formatInZone, isValidTimeZone, localDay, resolveTimeZone } from "@jarv1s/shared";

// Regression for #636 — single source of truth for timezone-aware day/time derivation.

describe("localDay", () => {
  it("derives the US-local day for a late-evening instant (DST edge, not the UTC day)", () => {
    // 2026-06-20T01:00:00Z = 2026-06-19 21:00 America/New_York (EDT, UTC-4) → Friday, not Saturday.
    expect(localDay("2026-06-20T01:00:00Z", "America/New_York")).toBe("2026-06-19");
  });

  it("derives the correct day across the date line (UTC+13/+14)", () => {
    // 2026-06-19T23:00:00Z = 2026-06-20T12:00:00+13 Pacific/Auckland → next calendar day.
    expect(localDay("2026-06-19T23:00:00Z", "Pacific/Auckland")).toBe("2026-06-20");
  });

  it("falls back to the ambient zone for an invalid timezone instead of throwing", () => {
    expect(() => localDay("2026-06-20T01:00:00Z", "Not/AZone")).not.toThrow();
  });

  it("echoes the raw string for an unparseable instant", () => {
    expect(localDay("not-a-date", "America/New_York")).toBe("not-a-date");
  });
});

describe("formatInZone", () => {
  it("formats an instant in the given IANA timezone", () => {
    const result = formatInZone("2026-06-20T01:00:00Z", "America/New_York", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    expect(result.toLowerCase()).toContain("9:00");
  });

  it("returns a raw-string echo on an unparseable instant", () => {
    expect(formatInZone("not-a-date", "America/New_York", { hour: "numeric" })).toBe("not-a-date");
  });

  it("returns an empty string for a non-string unparseable instant", () => {
    expect(formatInZone(NaN, "America/New_York", { hour: "numeric" })).toBe("");
  });
});

describe("isValidTimeZone", () => {
  it("accepts a valid IANA zone", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("rejects an invalid zone", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });
});

describe("resolveTimeZone", () => {
  it("uses a valid header timezone before stored settings", () => {
    expect(resolveTimeZone("America/New_York", "America/Los_Angeles")).toBe("America/New_York");
  });

  it("falls back to stored settings when the header is invalid", () => {
    expect(resolveTimeZone("Not/AZone", "America/Los_Angeles")).toBe("America/Los_Angeles");
  });

  it("falls back to UTC when both inputs are blank or invalid", () => {
    expect(resolveTimeZone(" ", "Not/AZone")).toBe("UTC");
  });

  it("trims valid inputs before returning them", () => {
    expect(resolveTimeZone("  America/Chicago  ", "America/Los_Angeles")).toBe("America/Chicago");
    expect(resolveTimeZone(null, "  Europe/London  ")).toBe("Europe/London");
  });
});
