import type { ExternalSourceAdapter, ModuleExternalSourceManifest } from "@jarv1s/module-sdk";

import { DatasetCache, DEFAULT_STALE_RETENTION_MS } from "./cache.js";
import { createHostPinnedFetch } from "./host-pinning.js";

export interface DatasetEnvelope<T> {
  readonly data: T;
  /** True when this call served a fallback or a stale cache entry instead of a fresh fetch. */
  readonly degraded: boolean;
  readonly fetchedAt: string;
}

export interface GetDatasetOptions<T> {
  readonly fallback: T;
}

export interface DatasetClient {
  getDataset<T>(
    datasetKey: string,
    params: Record<string, unknown>,
    options: GetDatasetOptions<T>
  ): Promise<DatasetEnvelope<T>>;
}

export interface DatasetClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
  readonly maxEntriesPerSource?: number;
}

function buildCacheKey(
  sourceId: string,
  datasetKey: string,
  params: Record<string, unknown>
): string {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join("&");
  return `${sourceId}:${datasetKey}:${serialized}`;
}

/**
 * Builds the runtime host for one declared `ModuleExternalSourceManifest`. Composition roots
 * construct one `DatasetClient` per declared source and pass it to the module's route/service
 * wiring — modules never construct their own fetch/cache plumbing (docs/superpowers/specs/
 * 2026-07-04-module-dataset-connector-sdk.md).
 *
 * `credential: "api-key"` is rejected here defensively; registration-time validation
 * (`assertModuleRegistryConsistency`) is the primary gate and should make this unreachable.
 */
export function createDatasetClient(
  source: ModuleExternalSourceManifest,
  adapter: ExternalSourceAdapter,
  deps: DatasetClientDeps = {}
): DatasetClient {
  if (source.credential === "api-key") {
    throw new Error(
      `External source "${source.id}" declares credential "api-key"; this slice does not build ` +
        "secret storage, and registration must reject it before createDatasetClient is reached."
    );
  }

  const now = deps.now ?? (() => new Date());
  const cache = new DatasetCache({ maxEntries: deps.maxEntriesPerSource });
  const pinnedFetch = createHostPinnedFetch(source.fetchHosts, deps.fetchFn ?? fetch);
  const datasetsByKey = new Map(source.datasets.map((dataset) => [dataset.key, dataset]));
  let lastFetchAtMs = 0;

  async function waitForRateCourtesy(): Promise<void> {
    const minIntervalMs = source.minIntervalMs;
    if (!minIntervalMs) return;
    const elapsed = now().getTime() - lastFetchAtMs;
    const remaining = minIntervalMs - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  return {
    async getDataset<T>(
      datasetKey: string,
      params: Record<string, unknown>,
      options: GetDatasetOptions<T>
    ): Promise<DatasetEnvelope<T>> {
      const dataset = datasetsByKey.get(datasetKey);
      if (!dataset) {
        throw new Error(`Unknown dataset "${datasetKey}" for external source "${source.id}"`);
      }

      const cacheKey = buildCacheKey(source.id, datasetKey, params);
      const nowMs = now().getTime();
      const hit = cache.get<T>(cacheKey, nowMs);
      if (hit && hit.fresh) {
        return { data: hit.value, degraded: false, fetchedAt: new Date(nowMs).toISOString() };
      }

      try {
        await waitForRateCourtesy();
        lastFetchAtMs = now().getTime();
        const value = (await adapter.fetchDataset(datasetKey, params, {
          fetchFn: pinnedFetch
        })) as T;
        const expiresAt = now().getTime() + dataset.ttlMs;
        const evictAt =
          dataset.staleness === "serve-stale-on-error"
            ? expiresAt + (dataset.staleRetentionMs ?? DEFAULT_STALE_RETENTION_MS)
            : expiresAt;
        cache.set(cacheKey, value, expiresAt, evictAt);
        return { data: value, degraded: false, fetchedAt: new Date().toISOString() };
      } catch {
        if (hit) {
          // Only reachable for serve-stale-on-error datasets: degrade-empty entries are deleted
          // by DatasetCache.get once past evictAt (which equals expiresAt for that policy), so
          // `hit` would already be undefined there.
          return { data: hit.value, degraded: true, fetchedAt: new Date(nowMs).toISOString() };
        }
        return { data: options.fallback, degraded: true, fetchedAt: new Date(nowMs).toISOString() };
      }
    }
  };
}
