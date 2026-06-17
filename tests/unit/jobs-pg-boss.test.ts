import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobWithMetadata, Queue } from "pg-boss";
import type { ActorScopedJobPayload } from "@jarv1s/jobs";

const bossInstances: PgBossMock[] = [];
const ctorOptions: Array<Record<string, unknown>> = [];

class PgBossMock {
  readonly events: Array<{ event: string; handler: (error: unknown) => void }> = [];
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  queues = new Map<string, Queue>();
  jobs = new Map<string, JobWithMetadata<ActorScopedJobPayload>>();
  cancelResult = { jobs: [{ id: "job-1", state: "cancelled" }] };

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

  async getJobById<T>(name: string, id: string): Promise<JobWithMetadata<T> | null> {
    this.calls.push({ method: "getJobById", args: [name, id] });
    return (this.jobs.get(`${name}:${id}`) as JobWithMetadata<T> | undefined) ?? null;
  }

  async cancel(name: string, id: string): Promise<typeof this.cancelResult> {
    this.calls.push({ method: "cancel", args: [name, id] });
    return this.cancelResult;
  }
}

vi.mock("pg-boss", () => ({ PgBoss: PgBossMock }));

function job(actorUserId: string): JobWithMetadata<ActorScopedJobPayload> {
  return {
    id: "job-1",
    name: "queue",
    data: { actorUserId },
    expireInSeconds: 60,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
    priority: 0,
    state: "created",
    retryLimit: 0,
    retryCount: 0,
    retryDelay: 0,
    retryBackoff: false,
    startAfter: new Date(0),
    startedOn: new Date(0),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 60,
    createdOn: new Date(0),
    completedOn: null,
    keepUntil: new Date(0),
    policy: "standard",
    heartbeatOn: null,
    deadLetter: "",
    output: {}
  };
}

describe("jobs pg-boss actor-owned helpers (#158)", () => {
  const actorUserId = "11111111-1111-4111-8111-111111111111";
  const otherActorUserId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    bossInstances.length = 0;
    ctorOptions.length = 0;
  });

  it("returns an owned job and null for an absent job", async () => {
    const { createPgBossClient, getOwnedJob } = await import("@jarv1s/jobs");
    const boss = createPgBossClient("postgres://x");
    const mock = bossInstances.at(-1)!;
    mock.jobs.set("queue:job-1", job(actorUserId));

    await expect(getOwnedJob(boss, "queue", "job-1", actorUserId)).resolves.toMatchObject({
      id: "job-1",
      data: { actorUserId }
    });
    await expect(getOwnedJob(boss, "queue", "missing", actorUserId)).resolves.toBeNull();
  });

  it("throws before cancellation when a job belongs to another actor", async () => {
    const { cancelOwnedJob, createPgBossClient } = await import("@jarv1s/jobs");
    const boss = createPgBossClient("postgres://x");
    const mock = bossInstances.at(-1)!;
    mock.jobs.set("queue:job-1", job(otherActorUserId));

    await expect(cancelOwnedJob(boss, "queue", "job-1", actorUserId)).rejects.toThrow(
      /not owned by actor/i
    );
    expect(mock.calls.some((call) => call.method === "cancel")).toBe(false);
  });

  it("returns null for absent jobs and cancels only after ownership is proven", async () => {
    const { cancelOwnedJob, createPgBossClient } = await import("@jarv1s/jobs");
    const boss = createPgBossClient("postgres://x");
    const mock = bossInstances.at(-1)!;

    await expect(cancelOwnedJob(boss, "queue", "missing", actorUserId)).resolves.toBeNull();
    expect(mock.calls.some((call) => call.method === "cancel")).toBe(false);

    mock.jobs.set("queue:job-1", job(actorUserId));
    await expect(cancelOwnedJob(boss, "queue", "job-1", actorUserId)).resolves.toEqual(
      mock.cancelResult
    );
    expect(mock.calls.at(-1)).toEqual({ method: "cancel", args: ["queue", "job-1"] });
  });
});

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
