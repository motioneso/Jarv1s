import { describe, expect, it } from "vitest";

import { DatasetCache } from "@jarv1s/datasets";

describe("DatasetCache", () => {
  it("returns a fresh hit before expiresAt", () => {
    const cache = new DatasetCache();
    cache.set("k", "v", 1_000, 1_000);
    const hit = cache.get<string>("k", 500);
    expect(hit).toEqual({ value: "v", fresh: true });
  });

  it("returns a stale (not fresh) hit between expiresAt and evictAt", () => {
    const cache = new DatasetCache();
    cache.set("k", "v", 1_000, 5_000);
    const hit = cache.get<string>("k", 2_000);
    expect(hit).toEqual({ value: "v", fresh: false });
  });

  it("evicts and returns undefined once past evictAt (degrade-empty: evictAt === expiresAt)", () => {
    const cache = new DatasetCache();
    cache.set("k", "v", 1_000, 1_000);
    expect(cache.get("k", 1_000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts and returns undefined once past evictAt (serve-stale-on-error: evictAt > expiresAt)", () => {
    const cache = new DatasetCache();
    cache.set("k", "v", 1_000, 5_000);
    expect(cache.get("k", 4_999)).toEqual({ value: "v", fresh: false });
    expect(cache.get("k", 5_000)).toBeUndefined();
  });

  it("returns undefined for a key that was never set", () => {
    const cache = new DatasetCache();
    expect(cache.get("missing", 0)).toBeUndefined();
  });

  it("delete() removes a single key", () => {
    const cache = new DatasetCache();
    cache.set("a", 1, 1_000, 1_000);
    cache.set("b", 2, 1_000, 1_000);
    cache.delete("a");
    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toEqual({ value: 2, fresh: true });
  });

  it("clear() removes all entries", () => {
    const cache = new DatasetCache();
    cache.set("a", 1, 1_000, 1_000);
    cache.set("b", 2, 1_000, 1_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("evicts the least-recently-used entry once maxEntries is exceeded", () => {
    const cache = new DatasetCache({ maxEntries: 2 });
    cache.set("a", 1, 1_000, 1_000);
    cache.set("b", 2, 1_000, 1_000);
    cache.set("c", 3, 1_000, 1_000);
    expect(cache.size).toBe(2);
    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toEqual({ value: 2, fresh: true });
    expect(cache.get("c", 0)).toEqual({ value: 3, fresh: true });
  });

  it("re-reading an entry bumps its LRU recency", () => {
    const cache = new DatasetCache({ maxEntries: 2 });
    cache.set("a", 1, 1_000, 1_000);
    cache.set("b", 2, 1_000, 1_000);
    cache.get("a", 0); // touch "a" so "b" becomes the oldest
    cache.set("c", 3, 1_000, 1_000);
    expect(cache.get("b", 0)).toBeUndefined();
    expect(cache.get("a", 0)).toEqual({ value: 1, fresh: true });
    expect(cache.get("c", 0)).toEqual({ value: 3, fresh: true });
  });
});
