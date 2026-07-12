// external-modules/job-search/src/domain/monitors.ts
//
// JS-02 (#931): monitor config + scan-cursor repo. Config is canonical;
// the cursor is derived scan state. deleteMonitor drops the cursor FIRST so
// an interrupted delete never leaves an orphan cursor that a re-created
// monitor with the same id could resume from (stale-state hazard).
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";

export interface MonitorConfig {
  schemaVersion: 1;
  monitorId: string;
  adapterId: string;
  enabled: boolean;
  query: Record<string, unknown>;
  /** IANA zone for the daily discovery run. Optional: pre-JS-05 records lack it (default UTC). */
  timezone?: string;
  /** Local due time "HH:MM" 24-hour. Optional: pre-JS-05 records lack it (default 07:00). */
  dueTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorCursor {
  schemaVersion: 1;
  monitorId: string;
  cursor: Record<string, unknown>;
  lastCheckedAt: string;
  lastSuccessAt?: string;
}

const MONITOR_PREFIX = "monitor/";

export async function saveMonitor(kv: JobSearchKv, config: MonitorConfig): Promise<void> {
  assertId(config.monitorId);
  await writeRecord(kv, NS.monitors, keys.monitor(config.monitorId), config);
}

export async function getMonitor(
  kv: JobSearchKv,
  monitorId: string
): Promise<MonitorConfig | null> {
  assertId(monitorId);
  const record = await readRecord(kv, NS.monitors, keys.monitor(monitorId));
  return record as MonitorConfig | null;
}

export async function listMonitorIds(kv: JobSearchKv): Promise<readonly string[]> {
  const allKeys = await kv.list(NS.monitors);
  return allKeys
    .filter((k) => k.startsWith(MONITOR_PREFIX))
    .map((k) => k.slice(MONITOR_PREFIX.length));
}

/** Deletes the monitor and its cursor. Returns whether the monitor existed. */
export async function deleteMonitor(kv: JobSearchKv, monitorId: string): Promise<boolean> {
  assertId(monitorId);
  await kv.delete(NS.monitors, keys.monitorCursor(monitorId));
  await kv.delete(NS.monitors, keys.monitorSchedule(monitorId));
  return kv.delete(NS.monitors, keys.monitor(monitorId));
}

export async function saveMonitorCursor(kv: JobSearchKv, cursor: MonitorCursor): Promise<void> {
  assertId(cursor.monitorId);
  await writeRecord(kv, NS.monitors, keys.monitorCursor(cursor.monitorId), cursor);
}

export async function getMonitorCursor(
  kv: JobSearchKv,
  monitorId: string
): Promise<MonitorCursor | null> {
  assertId(monitorId);
  const record = await readRecord(kv, NS.monitors, keys.monitorCursor(monitorId));
  return record as MonitorCursor | null;
}
