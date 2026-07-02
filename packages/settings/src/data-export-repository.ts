import { sql } from "kysely";

import type {
  DataContextDb,
  DataExportJob,
  DataExportJobFormat,
  DataExportJobStatus
} from "@jarv1s/db";

export class DataExportRepository {
  async createJob(
    scopedDb: DataContextDb,
    actorUserId: string,
    format: DataExportJobFormat = "json",
    params?: Record<string, unknown>
  ): Promise<DataExportJob> {
    const row = await scopedDb.db
      .insertInto("app.data_export_jobs")
      .values({ owner_user_id: actorUserId, format, params: params ?? undefined })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as DataExportJob;
  }

  async findActiveJobForUser(
    scopedDb: DataContextDb,
    actorUserId: string,
    format?: DataExportJobFormat
  ): Promise<DataExportJob | undefined> {
    let query = scopedDb.db
      .selectFrom("app.data_export_jobs")
      .selectAll()
      .where("owner_user_id", "=", actorUserId)
      .where("status", "in", ["pending", "building"]);
    if (format) query = query.where("format", "=", format);
    return query.orderBy("created_at", "desc").limit(1).executeTakeFirst() as Promise<
      DataExportJob | undefined
    >;
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

  // #671: the worker-role status-transition methods below never touch app.data_export_jobs
  // directly — jarvis_worker_runtime has no table-level SELECT/UPDATE grant on it (see
  // 0137_data_export_jobs_worker_bounded_functions.sql). Each call routes through a
  // SECURITY DEFINER function that re-derives ownership from app.current_actor_user_id()
  // inside the function body, so it's no broader than the RLS-filtered access the caller's
  // own actor context would already allow.

  async workerGetJobById(
    scopedDb: DataContextDb,
    jobId: string
  ): Promise<DataExportJob | undefined> {
    const result = await sql<DataExportJob>`
      SELECT * FROM app.worker_get_data_export_job(${jobId})
    `.execute(scopedDb.db);
    return result.rows[0];
  }

  async workerUpdateJobStatus(
    scopedDb: DataContextDb,
    jobId: string,
    status: DataExportJobStatus
  ): Promise<void> {
    await sql`SELECT app.worker_update_data_export_job_status(${jobId}, ${status})`.execute(
      scopedDb.db
    );
  }

  async workerCompleteJob(
    scopedDb: DataContextDb,
    jobId: string,
    completedAt: Date,
    expiresAt: Date
  ): Promise<void> {
    await sql`
      SELECT app.worker_complete_data_export_job(${jobId}, ${completedAt}, ${expiresAt})
    `.execute(scopedDb.db);
  }

  async workerFailJob(scopedDb: DataContextDb, jobId: string, errorMessage: string): Promise<void> {
    await sql`SELECT app.worker_fail_data_export_job(${jobId}, ${errorMessage})`.execute(
      scopedDb.db
    );
  }
}
