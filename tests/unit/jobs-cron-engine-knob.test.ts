import { describe, expect, it, vi } from "vitest";

const ctorOptions: Array<Record<string, unknown>> = [];
// pg-boss is imported as a NAMED export in packages/jobs/src/pg-boss.ts (`import { PgBoss }
// from "pg-boss"`), so the mock must expose `PgBoss`, not `default`.
vi.mock("pg-boss", () => ({
  PgBoss: class {
    constructor(opts: Record<string, unknown>) {
      ctorOptions.push(opts);
    }
    on() {}
  }
}));

describe("createPgBossClient cron-engine knob", () => {
  it("defaults schedule:false and honors a schedule:true override", async () => {
    const { createPgBossClient } = await import("@jarv1s/jobs");
    createPgBossClient("postgres://x");
    expect(ctorOptions.at(-1)).toMatchObject({ schedule: false });
    createPgBossClient("postgres://x", { schedule: true });
    expect(ctorOptions.at(-1)).toMatchObject({ schedule: true });
  });
});
