import Fastify from "fastify";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, type AccessContext } from "@jarv1s/db";
import { moodIndex, moodBand } from "@jarv1s/shared";
import { WellnessRepository, registerWellnessRoutes } from "@jarv1s/wellness";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const userId = "00000000-0000-4000-8000-000000000051";
const otherUserId = "00000000-0000-4000-8000-000000000052";

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:wellness-p2-test" };
}

let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'well-p2-a@example.test', false), ($2, 'well-p2-b@example.test', false)`,
      [userId, otherUserId]
    );
  } finally {
    await client.end();
  }
  const appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  // DataContextRunner does not own the pool — no close needed here.
});

describe("taxonomy persist/reject + moodIndex/moodBand", () => {
  it("all six emotion cores persist (taxonomy accept)", async () => {
    const repo = new WellnessRepository();
    const CORES = ["happy", "sad", "fear", "anger", "disgust", "surprise"] as const;
    for (const core of CORES) {
      await expect(
        dataContext.withDataContext(ctx(userId), (db) =>
          repo.createCheckin(db, { feelingCore: core })
        )
      ).resolves.toBeDefined();
    }
  });

  it("invalid emotion core is rejected (taxonomy reject)", async () => {
    await expect(
      dataContext.withDataContext(ctx(userId), (scopedDb) =>
        scopedDb.db
          .insertInto("app.wellness_checkins")
          .values({
            owner_user_id: sql<string>`app.current_actor_user_id()` as never,
            feeling_core: "not-a-valid-core" as never
          })
          .execute()
      )
    ).rejects.toThrow();
  });

  it("moodIndex returns correct values", () => {
    expect(moodIndex("happy", 5)).toBe(5.0);
    expect(moodIndex("sad", 5)).toBe(-5.0);
    expect(moodIndex("fear", 4)).toBe(-3.2);
    expect(moodIndex("anger", 3)).toBe(-2.1);
    expect(moodIndex("disgust", 2)).toBe(-1.4);
    expect(moodIndex("surprise", 5)).toBe(1.0);
  });

  it("moodBand maps correctly", () => {
    expect(moodBand(5)).toBe("bright");
    expect(moodBand(1.5)).toBe("lifted");
    expect(moodBand(0)).toBe("even");
    expect(moodBand(-2)).toBe("low");
    expect(moodBand(-4)).toBe("heavy");
  });
});

describe("WellnessRepository — therapy notes", () => {
  const repo = new WellnessRepository();

  it("createTherapyNote + listTherapyNotes owner-scoped CRUD", async () => {
    let noteId = "";
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const note = await repo.createTherapyNote(scopedDb, {
        body: "Feeling reflective today.",
        linkedEmotion: "sad"
      });
      noteId = note.id;
      expect(note.body).toBe("Feeling reflective today.");
      expect(note.linked_emotion).toBe("sad");
      expect(note.linked_checkin_id).toBeNull();
    });
    // owner can see it
    const ownNotes = await dataContext.withDataContext(ctx(userId), (db) =>
      repo.listTherapyNotes(db)
    );
    expect(ownNotes.some((n) => n.id === noteId)).toBe(true);
    // other user cannot see it (RLS)
    const otherNotes = await dataContext.withDataContext(ctx(otherUserId), (db) =>
      repo.listTherapyNotes(db)
    );
    expect(otherNotes.some((n) => n.id === noteId)).toBe(false);
  });

  it("deleteTherapyNote removes own note; returns false for other user's note (RLS)", async () => {
    let noteId = "";
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const note = await repo.createTherapyNote(db, { body: "To be deleted." });
      noteId = note.id;
    });
    // other user cannot delete userId's note (RLS)
    const otherDel = await dataContext.withDataContext(ctx(otherUserId), (db) =>
      repo.deleteTherapyNote(db, noteId)
    );
    expect(otherDel).toBe(false);
    // owner can delete their own note
    const ownerDel = await dataContext.withDataContext(ctx(userId), (db) =>
      repo.deleteTherapyNote(db, noteId)
    );
    expect(ownerDel).toBe(true);
  });

  it("cross-owner link rejected by trigger (actor B's checkin rejected for actor A's note)", async () => {
    // Create a check-in owned by otherUserId
    let otherCheckinId = "";
    await dataContext.withDataContext(ctx(otherUserId), async (db) => {
      const checkin = await new WellnessRepository().createCheckin(db, { feelingCore: "happy" });
      otherCheckinId = checkin.id;
    });
    // userId tries to link to otherUserId's check-in — trigger should reject
    await expect(
      dataContext.withDataContext(ctx(userId), (db) =>
        repo.createTherapyNote(db, {
          body: "Trying to link to someone else's check-in.",
          linkedCheckinId: otherCheckinId
        })
      )
    ).rejects.toThrow();
  });

  it("linked_checkin_id set to null when check-in is deleted (ON DELETE SET NULL)", async () => {
    let checkinId = "";
    let noteId = "";
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const checkin = await repo.createCheckin(db, { feelingCore: "fear" });
      checkinId = checkin.id;
      const note = await repo.createTherapyNote(db, {
        body: "Linked note.",
        linkedCheckinId: checkinId
      });
      noteId = note.id;
    });
    // Delete the check-in directly (bypassing RLS as owner)
    await dataContext.withDataContext(ctx(userId), (db) =>
      db.db.deleteFrom("app.wellness_checkins").where("id", "=", checkinId).execute()
    );
    // Note should still exist with linked_checkin_id = null
    const notes = await dataContext.withDataContext(ctx(userId), (db) => repo.listTherapyNotes(db));
    const note = notes.find((n) => n.id === noteId);
    expect(note).toBeDefined();
    expect(note?.linked_checkin_id).toBeNull();
  });
});

describe("WellnessRepository — listLogsRange", () => {
  const repo = new WellnessRepository();

  it("scheduled logs bucketed by scheduled_for (not logged_at); PRN logs included", async () => {
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const med = await repo.createMedication(db, {
        name: "RangeTest",
        frequencyType: "once_daily",
        scheduleTimes: ["08:00"]
      });
      // A scheduled log with scheduled_for within 30 days
      await repo.logDose(db, med.id, {
        status: "taken",
        scheduledFor: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      });
      // A PRN log within 30 days
      const prnMed = await repo.createMedication(db, {
        name: "RangePRN",
        frequencyType: "as_needed"
      });
      await repo.logDose(db, prnMed.id, { status: "prn", prnReason: "headache" });

      const logs = await repo.listLogsRange(db, { sinceDays: 30 });
      const hasTaken = logs.some((l) => l.medication_id === med.id && l.status === "taken");
      const hasPrn = logs.some((l) => l.medication_id === prnMed.id && l.status === "prn");
      expect(hasTaken).toBe(true);
      expect(hasPrn).toBe(true);
    });
  });
});

describe("wellness insights — owner-scoped", () => {
  it("GET /api/wellness/insights returns owner-scoped insights", async () => {
    const app = Fastify();
    registerWellnessRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:insights-test" }),
      dataContext
    });
    await app.ready();
    try {
      const res = await app.inject({ method: "GET", url: "/api/wellness/insights" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.insights)).toBe(true);
      // adherence insight always present
      expect(body.insights.some((i: { key: string }) => i.key === "adherence")).toBe(true);
    } finally {
      await app.close();
    }
  });
});
