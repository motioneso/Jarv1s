/**
 * Unit test for the one-cron-owner invariant (P3 real-briefings, F14).
 *
 * Exactly ONE process runs the pg-boss cron engine: the worker constructs its
 * boss with `{ schedule: true }`; the API process leaves it at the default
 * (`schedule: false`). This test pins the worker's boss-construction options and
 * the startup `pgboss.schedule_mode` log so "who owns cron" is observable, and
 * asserts the shared boss-options resolver keeps cron OFF by default (so the API,
 * which passes no override, never starts a second cron engine) and ON only with
 * the worker's options.
 */
import { describe, expect, it, vi } from "vitest";

import { WORKER_BOSS_OPTIONS, logScheduleMode } from "../../apps/worker/src/worker.js";
import { resolvePgBossConstructorOptions } from "../../packages/jobs/src/pg-boss.js";

describe("worker cron-engine ownership (F14 one-cron-owner)", () => {
  it("builds the worker boss with schedule:true and only schedule:true", () => {
    // The worker is the SOLE cron owner. supervise/migrate/createSchema stay at
    // createPgBossClient's defaults (false) — the worker only flips `schedule`.
    expect(WORKER_BOSS_OPTIONS).toEqual({ schedule: true });
  });

  it("emits an observable pgboss.schedule_mode startup log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      logScheduleMode();
      const emitted = logSpy.mock.calls.map((c) => String(c[0]));
      expect(emitted).toContain(JSON.stringify({ event: "pgboss.schedule_mode", schedule: true }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("defaults cron OFF (API process) and ON only with the worker options", () => {
    // The API process (apps/api/src/server.ts) constructs its boss via
    // createPgBossClient with NO overrides, so cron must default OFF. A future flip
    // of this default would silently give the API a second cron engine.
    const apiOptions = resolvePgBossConstructorOptions("postgres://unused:5432/none");
    expect(apiOptions.schedule).toBe(false);

    // The worker passes WORKER_BOSS_OPTIONS — must flip cron ON without enabling any
    // other background engine.
    const workerOptions = resolvePgBossConstructorOptions(
      "postgres://unused:5432/none",
      WORKER_BOSS_OPTIONS
    );
    expect(workerOptions.schedule).toBe(true);
    expect(workerOptions.supervise).toBe(false);
    expect(workerOptions.migrate).toBe(false);
    expect(workerOptions.createSchema).toBe(false);
  });
});
