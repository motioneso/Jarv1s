import { describe, expect, it, vi, afterEach } from "vitest";
import { SportsCache } from "../../packages/sports/src/sports-cache.js";

afterEach(() => vi.useRealTimers());

describe("SportsCache", () => {
  it("returns a value before TTL and undefined after", () => {
    vi.useFakeTimers();
    const cache = new SportsCache<number>();
    cache.set("k", 42, 1000);
    expect(cache.get("k")).toBe(42);
    vi.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeUndefined();
  });

  it("delete and clear remove entries", () => {
    const cache = new SportsCache<string>();
    cache.set("a", "x", 10_000);
    cache.set("b", "y", 10_000);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("y");
    cache.clear();
    expect(cache.get("b")).toBeUndefined();
  });
});
