import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { wellnessModuleManifest, WELLNESS_MODULE_ID } from "@jarv1s/wellness";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const userId = "00000000-0000-4000-8000-000000000041";
const otherUserId = "00000000-0000-4000-8000-000000000042";

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:wellness-test" };
}

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'well-a@example.test', false), ($2, 'well-b@example.test', false)`,
      [userId, otherUserId]
    );
  } finally {
    await client.end();
  }
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb?.destroy();
});

describe("Wellness module — manifest", () => {
  it("is the first required:false / user-toggleable module", () => {
    expect(WELLNESS_MODULE_ID).toBe("wellness");
    expect(wellnessModuleManifest.lifecycle).toBe("user-toggleable");
    expect(wellnessModuleManifest.availability?.defaultEnabled).toBe(true);
    expect(wellnessModuleManifest.availability?.required).toBe(false);
    expect(wellnessModuleManifest.availability?.supportsUserDisable).toBe(true);
    expect(wellnessModuleManifest.compatibility.jarv1s).toBe(">=0.0.0");
  });
});

describe("wellness_checkins table + RLS", () => {
  it("owner can insert multiple check-ins same day; lists own only; RLS blocks other user", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      for (let i = 0; i < 2; i++) {
        await scopedDb.db
          .insertInto("app.wellness_checkins")
          .values({
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            feeling_core: "scared",
            feeling_secondary: "anxious",
            sensations: sql<string[]>`ARRAY['tight chest']::text[]`,
            intensity: 4,
            note: `note-${i.toString()}`
          })
          .execute();
      }
    });

    const ownRows = await dataContext.withDataContext(ctx(userId), (scopedDb) =>
      scopedDb.db.selectFrom("app.wellness_checkins").selectAll().execute()
    );
    expect(ownRows.length).toBe(2);
    expect(ownRows[0]?.wheel_version).toBe("willcox-1982");

    const otherRows = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      scopedDb.db.selectFrom("app.wellness_checkins").selectAll().execute()
    );
    expect(otherRows.length).toBe(0);
  });

  it("rejects a feeling_core outside the enum", async () => {
    await expect(
      dataContext.withDataContext(ctx(userId), (scopedDb) =>
        scopedDb.db
          .insertInto("app.wellness_checkins")
          .values({
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            feeling_core: "not-a-feeling" as never
          })
          .execute()
      )
    ).rejects.toThrow();
  });
});
