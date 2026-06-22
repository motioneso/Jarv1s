import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Queue } from "pg-boss";

const bossInstances: PgBossMock[] = [];
const ctorOptions: Array<Record<string, unknown>> = [];

class PgBossMock {
  readonly events: Array<{ event: string; handler: (error: unknown) => void }> = [];
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  queues = new Map<string, Queue>();

  constructor(options: Record<string, unknown>) {
    ctorOptions.push(options);
    bossInstances.push(this);
  }

  on(event: string, handler: (error: unknown) => void): void {
    this.events.push({ event, handler });
  }

  async start(): Promise<void> {
    this.calls.push({ method: "start", args: [] });
  }

  async stop(options?: unknown): Promise<void> {
    this.calls.push({ method: "stop", args: [options] });
  }

  async getQueue(name: string): Promise<Queue | null> {
    this.calls.push({ method: "getQueue", args: [name] });
    return this.queues.get(name) ?? null;
  }

  async createQueue(name: string, options?: Omit<Queue, "name">): Promise<void> {
    this.calls.push({ method: "createQueue", args: [name, options] });
    if (!this.queues.has(name)) {
      this.queues.set(name, { name, policy: options?.policy ?? "standard", ...(options ?? {}) });
    }
  }

  async updateQueue(name: string, options?: unknown): Promise<void> {
    this.calls.push({ method: "updateQueue", args: [name, options] });
  }

  async deleteQueue(name: string): Promise<void> {
    this.calls.push({ method: "deleteQueue", args: [name] });
    this.queues.delete(name);
  }

}

vi.mock("pg-boss", () => ({ PgBoss: PgBossMock }));

describe("migratePgBoss queue convergence (#158)", () => {
  beforeEach(() => {
    bossInstances.length = 0;
    ctorOptions.length = 0;
  });

  it("uses the shared constructor path and honors caller overrides", async () => {
    const { migratePgBoss } = await import("@jarv1s/jobs");

    await migratePgBoss("postgres://migration", [], { schedule: true });

    expect(ctorOptions.at(-1)).toMatchObject({
      connectionString: "postgres://migration",
      schema: "pgboss",
      migrate: true,
      createSchema: true,
      schedule: true
    });
    expect(bossInstances.at(-1)!.calls.map((call) => call.method)).toEqual(["start", "stop"]);
  });

  it("creates first and then applies updatable options so concurrent migrators converge", async () => {
    const { migratePgBoss } = await import("@jarv1s/jobs");

    await migratePgBoss("postgres://migration", [
      {
        name: "queue",
        options: {
          policy: "standard",
          retryLimit: 3,
          retentionSeconds: 60
        }
      }
    ]);

    expect(bossInstances.at(-1)!.calls.map((call) => call.method)).toEqual([
      "start",
      "getQueue",
      "createQueue",
      "updateQueue",
      "stop"
    ]);
    expect(bossInstances.at(-1)!.calls.find((call) => call.method === "updateQueue")).toEqual({
      method: "updateQueue",
      args: ["queue", { retryLimit: 3, retentionSeconds: 60 }]
    });
  });
});
