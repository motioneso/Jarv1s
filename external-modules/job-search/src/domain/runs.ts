// external-modules/job-search/src/domain/runs.ts
//
// JS-02 (#931): run history repo. Canonical-first write ordering: the run
// record lands before the derived monitor/<id>/latest summary, so an
// interrupted recordRun leaves rebuildable state and a retry converges.
// Run records carry counts and error codes ONLY — never prose, titles, or
// posting content (they flow into logs/summaries outside the record itself).
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";

export interface RunRecord {
  schemaVersion: 1;
  monitorId: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: "ok" | "error" | "partial";
  counts: Record<string, number>;
  errorCode?: string;
}

export interface RunSummary {
  schemaVersion: 1;
  monitorId: string;
  lastRunId: string;
  lastStatus: RunRecord["status"];
  lastFinishedAt?: string;
  counts: Record<string, number>;
}

export async function recordRun(kv: JobSearchKv, run: RunRecord): Promise<void> {
  assertId(run.monitorId);
  assertId(run.runId);
  // Canonical record first, derived summary second (write-ordering rule).
  await writeRecord(kv, NS.runs, keys.run(run.monitorId, run.runId), run);
  const summary: RunSummary = {
    schemaVersion: 1,
    monitorId: run.monitorId,
    lastRunId: run.runId,
    lastStatus: run.status,
    ...(run.finishedAt !== undefined ? { lastFinishedAt: run.finishedAt } : {}),
    counts: run.counts
  };
  await writeRecord(kv, NS.runs, keys.runLatest(run.monitorId), summary);
}

export async function listRuns(kv: JobSearchKv, monitorId: string): Promise<readonly RunRecord[]> {
  assertId(monitorId);
  // Trailing slash keeps m1 from matching m10's keys.
  const prefix = `run/${monitorId}/`;
  const allKeys = await kv.list(NS.runs);
  const runs: RunRecord[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const record = await readRecord(kv, NS.runs, key);
    if (record !== null) {
      runs.push(record as unknown as RunRecord);
    }
  }
  return runs;
}

export async function getRunSummary(
  kv: JobSearchKv,
  monitorId: string
): Promise<RunSummary | null> {
  assertId(monitorId);
  const record = await readRecord(kv, NS.runs, keys.runLatest(monitorId));
  return record as RunSummary | null;
}
