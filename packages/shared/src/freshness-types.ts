export type FreshnessKind = "connector_sync" | "vault_write" | "memory_update" | "realtime";

export interface SourceFreshnessEntry {
  readonly source: string;
  readonly freshnessKind: FreshnessKind;
  readonly asOf: string | null;
}

export interface SourceFreshnessV1 {
  readonly version: 1;
  readonly capturedAt: string;
  readonly sources: readonly SourceFreshnessEntry[];
}
