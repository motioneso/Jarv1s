export {
  createDatasetClient,
  type DatasetClient,
  type DatasetClientDeps,
  type DatasetEnvelope,
  type GetDatasetOptions
} from "./client.js";
export {
  DatasetCache,
  DEFAULT_MAX_ENTRIES_PER_SOURCE,
  DEFAULT_STALE_RETENTION_MS
} from "./cache.js";
export type { DatasetCacheHit, DatasetCacheOptions } from "./cache.js";
export {
  assertValidFetchHosts,
  createHostPinnedFetch,
  HostPinningViolationError,
  isPinnableHost
} from "./host-pinning.js";
