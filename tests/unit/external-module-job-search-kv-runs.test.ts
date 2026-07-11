// tests/unit/external-module-job-search-kv-runs.test.ts
//
// JS-02 (#931) Task 6: run history repo. Write ordering is canonical-first:
// the run record lands before the derived monitor/<id>/latest summary, so an
// interrupted write leaves rebuildable state (run present, summary stale or
// absent) and a retry converges. Run records carry counts/codes only — the
// suite never puts prose in them.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import type { RunRecord } from "../../external-modules/job-search/src/domain/runs.js";
import {
  getRunSummary,
  listRuns,
  recordRun
} from "../../external-modules/job-search/src/domain/runs.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

function run(monitorId: string, runId: string, startedAt: string): RunRecord {
  return {
    schemaVersion: 1,
    monitorId,
    runId,
    startedAt,
    finishedAt: "2026-07-11T09:05:00.000Z",
    status: "ok",
    counts: { fetched: 12, upserted: 3 }
  };
}

async function expectKvError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(JobSearchKvError);
  expect((error as JobSearchKvError).code).toBe(code);
}

describe("runs repo", () => {
  it("records a run and derives the latest summary", async () => {
    const kv = createMemoryKv();
    await recordRun(kv, run("m1", "r1", "2026-07-11T09:00:00.000Z"));
    expect(await getRunSummary(kv, "m1")).toEqual({
      schemaVersion: 1,
      monitorId: "m1",
      lastRunId: "r1",
      lastStatus: "ok",
      lastFinishedAt: "2026-07-11T09:05:00.000Z",
      counts: { fetched: 12, upserted: 3 }
    });
  });

  it("writes the run record before the summary; retry heals an interrupted write", async () => {
    const kv = createMemoryKv();
    // Second set() (the derived summary) throws — canonical run must be first.
    kv.failAfterSets(2);
    await expect(recordRun(kv, run("m1", "r1", "2026-07-11T09:00:00.000Z"))).rejects.toThrow();
    expect(await kv.get(NS.runs, keys.run("m1", "r1"))).not.toBeNull();
    expect(await kv.get(NS.runs, keys.runLatest("m1"))).toBeNull();

    await recordRun(kv, run("m1", "r1", "2026-07-11T09:00:00.000Z"));
    expect((await getRunSummary(kv, "m1"))?.lastRunId).toBe("r1");
  });

  it("scopes listRuns to the monitor prefix (m1 never matches m10)", async () => {
    const kv = createMemoryKv();
    await recordRun(kv, run("m1", "r1", "2026-07-11T09:00:00.000Z"));
    await recordRun(kv, run("m1", "r2", "2026-07-11T10:00:00.000Z"));
    await recordRun(kv, run("m10", "r9", "2026-07-11T11:00:00.000Z"));

    const runs = await listRuns(kv, "m1");
    expect(runs.map((r) => r.runId).sort()).toEqual(["r1", "r2"]);
  });

  it("returns empty/null when nothing is recorded", async () => {
    const kv = createMemoryKv();
    expect(await listRuns(kv, "m1")).toEqual([]);
    expect(await getRunSummary(kv, "m1")).toBeNull();
  });

  it("enforces assertId on monitor and run ids", async () => {
    const kv = createMemoryKv();
    await expectKvError(recordRun(kv, run("bad id", "r1", "t")), "invalid_record");
    await expectKvError(recordRun(kv, run("m1", "bad id", "t")), "invalid_record");
    await expectKvError(listRuns(kv, "bad id"), "invalid_record");
    await expectKvError(getRunSummary(kv, "bad id"), "invalid_record");
  });
});
