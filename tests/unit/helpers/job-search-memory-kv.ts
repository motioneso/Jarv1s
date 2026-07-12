// tests/unit/helpers/job-search-memory-kv.ts
//
// In-memory JobSearchKv fake for the JS-02 domain unit suites (#931).
// Mirrors the platform's app.module_kv DB size check (octet_length <= 65536,
// migration 0154) so unit tests can prove the domain cap (65_535, strictly
// tighter) always fires FIRST: a 65_536-byte value passes this fake but must
// be rejected by the domain envelope before set() is ever called.
import type { JobSearchKv } from "../../../external-modules/job-search/src/domain/kv-port.js";

// Matches the DB CHECK constraint bound, NOT the domain cap — intentional.
const DB_VALUE_MAX_BYTES = 65_536;

export interface MemoryKv extends JobSearchKv {
  /** Snapshot of stored state keyed "namespace key" — for deep-equal convergence asserts. */
  dump(): ReadonlyMap<string, Record<string, unknown>>;
  /**
   * Arm interrupted-write injection: the n-th upcoming set() call throws
   * (n=1 means the very next set). Disarms after firing so a retry heals.
   */
  failAfterSets(n: number): void;
}

export function createMemoryKv(): MemoryKv {
  const store = new Map<string, Record<string, unknown>>();
  // 0 = disarmed. Counts down on each set(); throws when it reaches the armed call.
  let failCountdown = 0;

  const storageKey = (namespace: string, key: string) => `${namespace} ${key}`;

  // JSON round-trip clone: the real KV path serializes to jsonb, so stored
  // values must not alias caller objects (mutations after set() must not leak).
  const clone = (value: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  return {
    async get(namespace, key) {
      const value = store.get(storageKey(namespace, key));
      return value === undefined ? null : clone(value);
    },
    async set(namespace, key, value) {
      if (failCountdown > 0) {
        failCountdown -= 1;
        if (failCountdown === 0) {
          throw new Error("memory-kv: injected write failure (failAfterSets)");
        }
      }
      const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
      if (bytes > DB_VALUE_MAX_BYTES) {
        // Same failure surface as module_kv_value_size_ck — proves the domain
        // cap (65_535) fired first whenever this is unreachable from domain code.
        throw new Error("memory-kv: value exceeds DB octet-length check (65536)");
      }
      store.set(storageKey(namespace, key), clone(value));
    },
    async delete(namespace, key) {
      return store.delete(storageKey(namespace, key));
    },
    async list(namespace) {
      const prefix = `${namespace} `;
      // Sorted for determinism; domain code must never rely on listing order.
      return [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
    dump() {
      return new Map(store);
    },
    failAfterSets(n: number) {
      failCountdown = n;
    }
  };
}
