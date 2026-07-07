/**
 * Bounded LRU + dual-horizon TTL cache backing the dataset runtime client. Generalizes the
 * former `packages/sports/src/sports-cache.ts` `SportsCache`, with one behavior change required
 * by the spec: entries now carry a separate `evictAt` horizon distinct from `expiresAt`, so
 * "serve-stale-on-error" datasets can still be read (as stale/degraded) after TTL expiry, up to
 * `staleRetentionMs` later — the old cache deleted on TTL expiry unconditionally.
 */

export const DEFAULT_STALE_RETENTION_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_ENTRIES_PER_SOURCE = 500;

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
  readonly evictAt: number;
}

export interface DatasetCacheHit<T> {
  readonly value: T;
  /** True when the entry is still within its TTL (expiresAt); false when serving stale. */
  readonly fresh: boolean;
}

export interface DatasetCacheOptions {
  readonly maxEntries?: number;
}

export class DatasetCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(options: DatasetCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES_PER_SOURCE;
  }

  get<T>(key: string, now: number): DatasetCacheHit<T> | undefined {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (now >= entry.evictAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Bump recency for LRU: re-insert so it sorts last in Map iteration order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, fresh: now < entry.expiresAt };
  }

  set<T>(key: string, value: T, expiresAt: number, evictAt: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt, evictAt });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
