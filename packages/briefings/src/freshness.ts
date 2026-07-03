import type { DataContextDb } from "@jarv1s/db";
import type { FreshnessKind, SourceFreshnessEntry, SourceFreshnessV1 } from "@jarv1s/shared";

type ConnectorKind = "email" | "calendar";

interface ResolveFreshnessOpts {
  connectorSyncAt?: (scopedDb: DataContextDb, kind: ConnectorKind) => Promise<Date | null>;
  vaultLastWriteAt?: (scopedDb: DataContextDb) => Promise<Date | null>;
}

const CONNECTOR_SOURCE_KINDS = new Map<string, ConnectorKind>([
  ["email", "email"],
  ["calendar", "calendar"],
  ["email_today", "email"],
  ["calendar_tomorrow", "calendar"]
]);

const REALTIME_SOURCES = new Set<string>([
  "tasks",
  "commitments",
  "chats",
  "goals",
  "tasks_reconciliation",
  "morning_plan"
]);

export async function resolveBriefingFreshness(
  scopedDb: DataContextDb,
  sectionKeys: readonly string[],
  capturedAt: Date,
  opts: ResolveFreshnessOpts
): Promise<SourceFreshnessV1> {
  const capturedAtIso = capturedAt.toISOString();

  const sources: SourceFreshnessEntry[] = await Promise.all(
    sectionKeys.map(async (key): Promise<SourceFreshnessEntry> => {
      if (REALTIME_SOURCES.has(key)) {
        return { source: key, freshnessKind: "realtime", asOf: capturedAtIso };
      }
      const connectorKind = CONNECTOR_SOURCE_KINDS.get(key);
      if (connectorKind) {
        let asOf: string | null = null;
        try {
          const t = (await opts.connectorSyncAt?.(scopedDb, connectorKind)) ?? null;
          asOf = t ? t.toISOString() : null;
        } catch {
          // keep asOf as null on error
        }
        return { source: key, freshnessKind: "connector_sync", asOf };
      }
      if (key === "vault") {
        let asOf: string | null = null;
        try {
          const t = (await opts.vaultLastWriteAt?.(scopedDb)) ?? null;
          asOf = t ? t.toISOString() : null;
        } catch {
          // keep asOf as null on error
        }
        return { source: key, freshnessKind: "vault_write", asOf };
      }
      return { source: key, freshnessKind: "realtime" as FreshnessKind, asOf: capturedAtIso };
    })
  );

  return { version: 1, capturedAt: capturedAtIso, sources };
}
