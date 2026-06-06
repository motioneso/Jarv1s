import type { Kysely } from "kysely";

import type { DataContextDb } from "./data-context.js";
import { DataContextRunner } from "./data-context.js";
import type { SpikeDatabase } from "./types.js";

export class SpikeWorkerRunner {
  private readonly dataContextRunner: DataContextRunner;

  constructor(private readonly workerDb: Kysely<SpikeDatabase>) {
    this.dataContextRunner = new DataContextRunner(workerDb);
  }

  async unsafeSelectVisibleProbeIdsForTest(): Promise<string[]> {
    return this.dataContextRunner.unsafeSelectVisibleProbeIdsForTest();
  }

  async runJob<T>(jobId: string, work: (scopedDb: DataContextDb) => Promise<T>): Promise<T> {
    const job = await this.workerDb
      .selectFrom("app.spike_jobs")
      .select(["id", "actor_user_id", "workspace_id"])
      .where("id", "=", jobId)
      .executeTakeFirstOrThrow();

    await this.workerDb
      .updateTable("app.spike_jobs")
      .set({ status: "running" })
      .where("id", "=", jobId)
      .execute();

    try {
      const result = await this.dataContextRunner.withDataContext(
        {
          actorUserId: job.actor_user_id,
          workspaceId: job.workspace_id,
          requestId: `job:${job.id}`
        },
        work
      );

      await this.workerDb
        .updateTable("app.spike_jobs")
        .set({ status: "done" })
        .where("id", "=", jobId)
        .execute();

      return result;
    } catch (error) {
      await this.workerDb
        .updateTable("app.spike_jobs")
        .set({ status: "failed" })
        .where("id", "=", jobId)
        .execute();

      throw error;
    }
  }
}
