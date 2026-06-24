import type { DataContextDb, DataExportJob, DataExportJobStatus } from "@jarv1s/db";

export class DataExportRepository {
  async createJob(scopedDb: DataContextDb, actorUserId: string): Promise<DataExportJob> {
    const row = await scopedDb.db
      .insertInto("app.data_export_jobs")
      .values({ owner_user_id: actorUserId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as DataExportJob;
  }

  async findActiveJobForUser(
    scopedDb: DataContextDb,
    actorUserId: string
  ): Promise<DataExportJob | undefined> {
    return scopedDb.db
      .selectFrom("app.data_export_jobs")
      .selectAll()
      .where("owner_user_id", "=", actorUserId)
      .where("status", "in", ["pending", "building"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst() as Promise<DataExportJob | undefined>;
  }

  async getJobById(scopedDb: DataContextDb, jobId: string): Promise<DataExportJob | undefined> {
    return scopedDb.db
      .selectFrom("app.data_export_jobs")
      .selectAll()
      .where("id", "=", jobId)
      .executeTakeFirst() as Promise<DataExportJob | undefined>;
  }

  async updateJobStatus(
    scopedDb: DataContextDb,
    jobId: string,
    status: DataExportJobStatus
  ): Promise<void> {
    await scopedDb.db
      .updateTable("app.data_export_jobs")
      .set({ status })
      .where("id", "=", jobId)
      .execute();
  }

  async completeJob(
    scopedDb: DataContextDb,
    jobId: string,
    completedAt: Date,
    expiresAt: Date
  ): Promise<void> {
    await scopedDb.db
      .updateTable("app.data_export_jobs")
      .set({
        status: "ready",
        completed_at: completedAt,
        expires_at: expiresAt
      })
      .where("id", "=", jobId)
      .execute();
  }

  async failJob(scopedDb: DataContextDb, jobId: string, errorMessage: string): Promise<void> {
    await scopedDb.db
      .updateTable("app.data_export_jobs")
      .set({ status: "failed", error_message: errorMessage })
      .where("id", "=", jobId)
      .execute();
  }
}
