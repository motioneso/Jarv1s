import { beforeAll, describe, expect, it } from "vitest";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { sql } from "kysely";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { Kysely } from "kysely";

describe("Wellness export — migration 0114 (data_export_jobs.format + params)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  it("adds the format column with default 'json' and CHECK constraint", async () => {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'data_export_jobs' AND column_name = 'format'
    `.execute(appDb);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.data_type).toBe("text");
    expect(rows.rows[0]?.is_nullable).toBe("NO");
  });

  it("adds the params jsonb column (nullable)", async () => {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'data_export_jobs' AND column_name = 'params'
    `.execute(appDb);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.data_type).toBe("jsonb");
    expect(rows.rows[0]?.is_nullable).toBe("YES");
  });

  it("rejects an unknown format value via the CHECK constraint", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:mig-test" },
        (scopedDb) =>
          scopedDb.db
            .insertInto("app.data_export_jobs")
            .values({ owner_user_id: ids.userA, format: "csv" as never })
            .execute()
      )
    ).rejects.toThrow();
  });

  it("accepts 'json' and 'html' format values", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:mig-test" },
      async (scopedDb) => {
        const jsonRow = await scopedDb.db
          .insertInto("app.data_export_jobs")
          .values({ owner_user_id: ids.userA, format: "json" })
          .returning("format")
          .executeTakeFirstOrThrow();
        expect(jsonRow.format).toBe("json");

        const htmlRow = await scopedDb.db
          .insertInto("app.data_export_jobs")
          .values({ owner_user_id: ids.userA, format: "html" })
          .returning(["format", "params"])
          .executeTakeFirstOrThrow();
        expect(htmlRow.format).toBe("html");
        expect(htmlRow.params).toBeNull();
      }
    );
  });

  it("defaults format to 'json' when omitted (backward-compat for existing pipeline)", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:mig-test" },
      async (scopedDb) => {
        const row = await scopedDb.db
          .insertInto("app.data_export_jobs")
          .values({ owner_user_id: ids.userA })
          .returning("format")
          .executeTakeFirstOrThrow();
        expect(row.format).toBe("json");
      }
    );
  });
});

