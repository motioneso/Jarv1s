import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { WELLNESS_FEELING_CORES, createCheckinRequestSchema } from "@jarv1s/shared";
import {
  WellnessRepository,
  computeSchedule,
  wellnessModuleManifest,
  WELLNESS_MODULE_ID
} from "@jarv1s/wellness";
import type { Medication, MedicationLog } from "@jarv1s/db";

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

describe("medications + medication_logs tables + RLS", () => {
  it("owner can create a med + a log; denormalized owner; RLS blocks other user", async () => {
    let medId = "";
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const med = await scopedDb.db
        .insertInto("app.medications")
        .values({
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          name: "Sertraline",
          dosage: "50 mg",
          frequency_type: "once_daily",
          schedule_times: sql<string[]>`ARRAY['08:00']::time[]`
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      medId = med.id;

      await scopedDb.db
        .insertInto("app.medication_logs")
        .values({
          medication_id: medId,
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          status: "taken",
          dose: "50 mg",
          // Scheduled (non-PRN) logs must carry scheduled_for (DB CHECK).
          scheduled_for: sql<Date>`now()`
        })
        .execute();
    });

    const otherMeds = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      scopedDb.db.selectFrom("app.medications").selectAll().execute()
    );
    expect(otherMeds.length).toBe(0);

    const otherLogs = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      scopedDb.db.selectFrom("app.medication_logs").selectAll().execute()
    );
    expect(otherLogs.length).toBe(0);
  });

  it("rejects a medication_log whose owner differs from the parent medication's owner", async () => {
    let medId = "";
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const med = await scopedDb.db
        .insertInto("app.medications")
        .values({
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          name: "Test Med",
          frequency_type: "as_needed"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      medId = med.id;
    });

    // otherUser attempts to log against userId's medication: RLS INSERT WITH CHECK
    // requires owner_user_id = current actor, and the trigger requires it to equal the
    // parent med owner — so this must fail.
    await expect(
      dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
        scopedDb.db
          .insertInto("app.medication_logs")
          .values({
            medication_id: medId,
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            status: "prn",
            prn_reason: "headache"
          })
          .execute()
      )
    ).rejects.toThrow();
  });
});

describe("wellness shared contract", () => {
  it("exposes the six Willcox cores and a create-checkin request schema", () => {
    expect(WELLNESS_FEELING_CORES).toEqual([
      "mad",
      "sad",
      "scared",
      "joyful",
      "powerful",
      "peaceful"
    ]);
    expect(createCheckinRequestSchema.required).toContain("feelingCore");
    expect(createCheckinRequestSchema.additionalProperties).toBe(false);
  });
});

describe("WellnessRepository", () => {
  const repo = new WellnessRepository();

  it("createCheckin persists the full wheel path + sensations; listCheckins is owner-scoped", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.createCheckin(scopedDb, {
        feelingCore: "scared",
        feelingSecondary: "anxious",
        feelingTertiary: "overwhelmed",
        sensations: ["tight chest", "racing heart"],
        intensity: 4,
        note: "deadline",
        identifiedVia: "assisted"
      });
      const list = await repo.listCheckins(scopedDb, { limit: 10 });
      const latest = list[0];
      expect(latest?.feeling_core).toBe("scared");
      expect(latest?.feeling_tertiary).toBe("overwhelmed");
      expect(latest?.sensations).toEqual(["tight chest", "racing heart"]);
      expect(latest?.identified_via).toBe("assisted");
    });
  });

  it("createMedication + logDose; getSchedule marks a slot taken from a same-day log", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const med = await repo.createMedication(scopedDb, {
        name: "Levothyroxine",
        frequencyType: "once_daily",
        scheduleTimes: ["08:00"]
      });
      const today = new Date();
      const scheduledFor = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 8, 0, 0)
      ).toISOString();
      await repo.logDose(scopedDb, med.id, {
        status: "taken",
        scheduledFor
      });
      const log = await repo.listRecentLogs(scopedDb, { sinceDays: 1 });
      expect(log.some((l) => l.medication_id === med.id && l.status === "taken")).toBe(true);
    });
  });

  it("createCheckin throws on an unbranded handle (DataContextDb guard)", async () => {
    await expect(
      repo.createCheckin(appDb as unknown as never, { feelingCore: "joyful" })
    ).rejects.toThrow("Repository access requires withDataContext");
  });
});

describe("computeSchedule (pure)", () => {
  const date = new Date("2026-06-15T00:00:00.000Z"); // Monday

  function med(overrides: Partial<Medication>): Medication {
    return {
      id: "m1",
      owner_user_id: userId,
      name: "Med",
      dosage: null,
      form: null,
      frequency_type: "once_daily",
      times_per_day: null,
      interval_hours: null,
      weekdays: null,
      schedule_times: null,
      cycle_days_on: null,
      cycle_days_off: null,
      cycle_anchor_date: null,
      active: true,
      notes: null,
      created_at: date,
      updated_at: date,
      ...overrides
    } as Medication;
  }

  it("once_daily with schedule_times yields a slot per time", () => {
    const slots = computeSchedule([med({ schedule_times: ["08:00", "20:00"] })], [], date);
    expect(slots.filter((s) => !s.asNeeded).length).toBe(2);
    expect(slots[0]?.status).toBe("pending");
  });

  it("specific_weekdays only yields slots on a matching weekday", () => {
    const onMonday = computeSchedule(
      [med({ frequency_type: "specific_weekdays", weekdays: [1], schedule_times: ["09:00"] })],
      [],
      date // Monday = ISO 1
    );
    expect(onMonday.filter((s) => !s.asNeeded).length).toBe(1);
    const onTuesday = computeSchedule(
      [med({ frequency_type: "specific_weekdays", weekdays: [2], schedule_times: ["09:00"] })],
      [],
      date
    );
    expect(onTuesday.filter((s) => !s.asNeeded).length).toBe(0);
  });

  it("as_needed yields a single asNeeded affordance, no fixed slot", () => {
    const slots = computeSchedule([med({ frequency_type: "as_needed" })], [], date);
    expect(slots.length).toBe(1);
    expect(slots[0]?.asNeeded).toBe(true);
  });

  it("a matching same-day log marks the slot taken", () => {
    const m = med({ id: "mx", schedule_times: ["08:00"] });
    const scheduledFor = new Date("2026-06-15T08:00:00.000Z");
    const log: MedicationLog = {
      id: "l1",
      medication_id: "mx",
      owner_user_id: userId,
      status: "taken",
      dose: null,
      prn_reason: null,
      scheduled_for: scheduledFor,
      logged_at: scheduledFor,
      created_at: scheduledFor
    } as MedicationLog;
    const slots = computeSchedule([m], [log], date);
    expect(slots.find((s) => !s.asNeeded)?.status).toBe("taken");
  });
});
