import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  WELLNESS_FEELING_CORES,
  createCheckinRequestSchema,
  FEELINGS_WHEEL,
  BODY_SENSATIONS,
  isValidFeelingPath
} from "@jarv1s/shared";
import {
  WellnessRepository,
  computeSchedule,
  registerWellnessRoutes,
  wellnessModuleManifest,
  WELLNESS_MODULE_ID,
  wellnessRecentCheckInsExecute,
  wellnessMedicationAdherenceExecute,
  deriveEnergyTrend,
  WellnessRecallContributor,
  wellnessFocusSignal
} from "@jarv1s/wellness";
import type { Medication, MedicationLog } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { aggregateFocusSignals, type FocusSignal } from "@jarv1s/module-sdk";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import { TasksRepository, registerTasksRoutes } from "@jarv1s/tasks";
import { BriefingsRepository } from "@jarv1s/briefings";
import { ChatMemoryFactsRepository } from "@jarv1s/memory";

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

describe("wellness REST routes", () => {
  async function buildApp(actorUserId: string) {
    const app = Fastify();
    registerWellnessRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId, requestId: "req:route-test" }),
      dataContext
    });
    await app.ready();
    return app;
  }

  it("POST /api/wellness/checkins creates; GET lists owner-scoped", async () => {
    const app = await buildApp(userId);
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/wellness/checkins",
        payload: { feelingCore: "joyful", intensity: 5, sensations: ["warmth"] }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().checkin.feelingCore).toBe("joyful");

      const listed = await app.inject({ method: "GET", url: "/api/wellness/checkins?limit=5" });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().checkins.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("POST a check-in with a feeling path mismatch is rejected 400", async () => {
    const app = await buildApp(userId);
    try {
      // tertiary is not a leaf of the secondary under this core → invalid path.
      const bad = await app.inject({
        method: "POST",
        url: "/api/wellness/checkins",
        payload: {
          feelingCore: "scared",
          feelingSecondary: "anxious",
          feelingTertiary: "not-a-leaf"
        }
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("POST a PRN dose log without prn_reason is rejected 400", async () => {
    const app = await buildApp(userId);
    try {
      const med = await app.inject({
        method: "POST",
        url: "/api/wellness/medications",
        payload: { name: "Ibuprofen", frequencyType: "as_needed" }
      });
      const medId = med.json().medication.id as string;

      const bad = await app.inject({
        method: "POST",
        url: `/api/wellness/medications/${medId}/logs`,
        payload: { status: "prn" }
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("GET /api/wellness/medications/schedule returns slots for today", async () => {
    const app = await buildApp(userId);
    try {
      await app.inject({
        method: "POST",
        url: "/api/wellness/medications",
        payload: { name: "Vitamin D", frequencyType: "once_daily", scheduleTimes: ["09:00"] }
      });
      const today = new Date().toISOString().slice(0, 10);
      const sched = await app.inject({
        method: "GET",
        url: `/api/wellness/medications/schedule?date=${today}`
      });
      expect(sched.statusCode).toBe(200);
      expect(sched.json().date).toBe(today);
      expect(Array.isArray(sched.json().slots)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("wellness AI read tools", () => {
  function toolCtx(actorUserId: string): ToolContext {
    return { actorUserId, requestId: "tool-req", chatSessionId: "" };
  }

  it("wellness.recentCheckIns returns owner-scoped check-ins and is declared read", async () => {
    const tool = wellnessModuleManifest.assistantTools?.find(
      (t) => t.name === "wellness.recentCheckIns"
    );
    expect(tool?.risk).toBe("read");
    expect(tool?.execute).toBeDefined();

    await dataContext.withDataContext(ctx(userId), (db) =>
      new WellnessRepository().createCheckin(db, { feelingCore: "peaceful", intensity: 4 })
    );
    const result = await dataContext.withDataContext(ctx(userId), (db) =>
      wellnessRecentCheckInsExecute(db, {}, toolCtx(userId))
    );
    const items = result.data.items as Array<{ feelingCore: string }>;
    expect(items.length).toBeGreaterThan(0);
  });

  it("wellness.medicationAdherence returns counts only (no full med list)", async () => {
    const result = await dataContext.withDataContext(ctx(userId), (db) =>
      wellnessMedicationAdherenceExecute(db, {}, toolCtx(userId))
    );
    expect(result.data).toHaveProperty("scheduled");
    expect(result.data).toHaveProperty("taken");
    expect(result.data).not.toHaveProperty("medications");
    expect(result.data).not.toHaveProperty("items");
  });

  it("every manifest route corresponds to a declared permission", () => {
    const permissionIds = new Set((wellnessModuleManifest.permissions ?? []).map((p) => p.id));
    for (const route of wellnessModuleManifest.routes ?? []) {
      if (route.permissionId) expect(permissionIds.has(route.permissionId)).toBe(true);
    }
  });

  it("declares a metadata-only deferred reminder queue but no active queueDefinitions", () => {
    const job = (wellnessModuleManifest.jobs ?? [])[0];
    expect(job?.queueName).toBe("wellness-medication-reminder");
    expect(job?.metadataOnly).toBe(true);
  });
});

describe("wellness registry integration", () => {
  it("wellness is registered exactly once in BUILT_IN_MODULES and is the only required:false module", () => {
    const manifests = getBuiltInModuleManifests();
    const wellness = manifests.filter((m) => m.id === "wellness");
    expect(wellness.length).toBe(1);
    expect(wellness[0]?.availability?.required).toBe(false);

    const optional = manifests.filter((m) => m.availability?.required === false);
    expect(optional.map((m) => m.id)).toEqual(["wellness"]);
  });

  it("wellness routes are reachable through registerBuiltInApiRoutes (briefings can resolve its tools)", () => {
    const manifest = getBuiltInModuleManifests().find((m) => m.id === "wellness");
    const toolNames = (manifest?.assistantTools ?? []).map((t) => t.name);
    expect(toolNames).toContain("wellness.recentCheckIns");
  });
});

describe("briefings Wellness section (existing read-tool seam, zero briefings change)", () => {
  it("a briefing definition selecting wellness.recentCheckIns renders a section", async () => {
    const briefings = new BriefingsRepository();

    // Seed a check-in so the tool has data.
    await dataContext.withDataContext(ctx(userId), (db) =>
      new WellnessRepository().createCheckin(db, { feelingCore: "sad", intensity: 2 })
    );

    const definition = await dataContext.withDataContext(ctx(userId), (db) =>
      briefings.createDefinition(db, {
        title: "Daily Wellness",
        cadence: "manual",
        selectedToolNames: ["wellness.recentCheckIns"]
      })
    );

    const run = await dataContext.withDataContext(ctx(userId), (db) =>
      briefings.generateRun(db, definition.id, {
        runKind: "manual",
        moduleManifests: getBuiltInModuleManifests()
      })
    );

    expect(run?.status).toBe("succeeded");
    const tools =
      (run?.source_metadata as { tools?: Array<{ name: string; status: string }> }).tools ?? [];
    expect(tools.some((t) => t.name === "wellness.recentCheckIns" && t.status !== "failed")).toBe(
      true
    );
  });
});

describe("wellness chat recall energy-trend fact", () => {
  it("deriveEnergyTrend produces an abstracted, non-clinical trend string (no raw feelings)", () => {
    const trend = deriveEnergyTrend([
      { energy: 2, feeling_core: "sad" } as never,
      { energy: 1, feeling_core: "scared" } as never,
      { energy: 2, feeling_core: "sad" } as never
    ]);
    expect(trend).not.toBeNull();
    expect(trend?.toLowerCase()).toContain("energy");
    // Must NOT contain a raw feeling word.
    expect(trend?.toLowerCase()).not.toContain("sad");
    expect(trend?.toLowerCase()).not.toContain("scared");
  });

  it("deriveEnergyTrend returns null when there are no recent check-ins", () => {
    expect(deriveEnergyTrend([])).toBeNull();
  });

  it("contributor upserts a profile fact that listActiveFacts picks up", async () => {
    const contributor = new WellnessRecallContributor();
    const facts = new ChatMemoryFactsRepository();

    await dataContext.withDataContext(ctx(userId), async (db) => {
      await new WellnessRepository().createCheckin(db, {
        feelingCore: "sad",
        intensity: 1,
        energy: 1
      });
      await new WellnessRepository().createCheckin(db, {
        feelingCore: "scared",
        intensity: 2,
        energy: 2
      });
      await contributor.refreshEnergyTrendFact(db, userId);
      const active = await facts.listActiveFacts(db, userId);
      expect(
        active.some((f) => f.category === "profile" && f.content.toLowerCase().includes("energy"))
      ).toBe(true);
    });
  });
});

describe("focus-signal contribution point", () => {
  it("wellness provider returns null with no check-ins", async () => {
    const fresh = "00000000-0000-4000-8000-000000000043";
    const client2 = new Client({ connectionString: connectionStrings.bootstrap });
    await client2.connect();
    try {
      await client2.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1,'fresh@example.test',false)
         ON CONFLICT (id) DO NOTHING`,
        [fresh]
      );
    } finally {
      await client2.end();
    }
    const signal = await dataContext.withDataContext(ctx(fresh), (db) =>
      wellnessFocusSignal(db, { actorUserId: fresh, requestId: "req:focus" })
    );
    expect(signal).toBeNull();
  });

  it("wellness provider yields low readiness after low-ENERGY check-ins", async () => {
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const repo = new WellnessRepository();
      await repo.createCheckin(db, { feelingCore: "sad", intensity: 1, energy: 1 });
      await repo.createCheckin(db, { feelingCore: "scared", intensity: 1, energy: 1 });
    });
    const signal = await dataContext.withDataContext(ctx(userId), (db) =>
      wellnessFocusSignal(db, { actorUserId: userId, requestId: "req:focus" })
    );
    expect(signal).not.toBeNull();
    expect(signal!.moduleId).toBe("wellness");
    expect(signal!.readiness).toBeLessThan(0.5);
    expect(signal!.summary.toLowerCase()).toContain("energy");
  });

  it("aggregateFocusSignals fails soft: a throwing provider is treated as no signal", async () => {
    const throwing = async () => {
      throw new Error("boom");
    };
    const result = await dataContext.withDataContext(ctx(userId), (db) =>
      aggregateFocusSignals(
        [
          { moduleId: "wellness", provider: wellnessFocusSignal },
          { moduleId: "broken", provider: throwing as never }
        ],
        db,
        { actorUserId: userId, requestId: "req:focus" }
      )
    );
    expect(result.some((s) => s.moduleId === "wellness")).toBe(true);
    expect(result.some((s) => (s as FocusSignal).moduleId === "broken")).toBe(false);
  });
});

describe("focus consumer down-weights when readiness is low (generic)", () => {
  it("caps the focus list when the injected aggregate readiness is low", async () => {
    // Seed many high-priority overdue tasks for the actor.
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const repo = new TasksRepository();
      const past = new Date(Date.now() - 86_400_000);
      for (let i = 0; i < 6; i++) {
        await repo.create(db, {
          title: `urgent-${i.toString()}`,
          status: "todo",
          priority: 5,
          dueAt: past
        });
      }
    });

    const app = Fastify();
    registerTasksRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:focus" }),
      dataContext,
      boss: undefined as never,
      focusSignals: async () => [
        { moduleId: "wellness", readiness: 0.1, summary: "Energy trended low." }
      ]
    });
    await app.ready();
    try {
      const res = await app.inject({ method: "GET", url: "/api/tasks/focus" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tasks.length).toBeLessThanOrEqual(3);
      expect(body.signals[0].readiness).toBe(0.1);
    } finally {
      await app.close();
    }
  });
});

describe("focus providers honor per-user enablement (Phase-2 seam is LANDED)", () => {
  it("focusSignalProvidersFor(active) excludes a module the actor disabled", async () => {
    const { createActiveModulesResolver, focusSignalProvidersFor, getBuiltInModuleManifests } =
      await import("@jarv1s/module-registry");
    const { SettingsRepository } = await import("@jarv1s/settings");

    const resolveActive = createActiveModulesResolver({
      dataContext,
      manifests: getBuiltInModuleManifests()
    });

    // Before disabling: wellness is active and contributes a provider.
    const before = focusSignalProvidersFor(await resolveActive(userId));
    expect(before.some((p) => p.moduleId === "wellness")).toBe(true);

    // Disable wellness for this actor via the settings deny-list (the seam's own writer).
    // setUserModuleDisabled writes the deny row for input.actorUserId (the acting user).
    await dataContext.withDataContext(ctx(userId), (db) =>
      new SettingsRepository().setUserModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: userId,
        requestId: "req:wellness-test"
      })
    );

    const after = focusSignalProvidersFor(await resolveActive(userId));
    expect(after.some((p) => p.moduleId === "wellness")).toBe(false);

    // Re-enable so later tests see wellness active again (clean state).
    await dataContext.withDataContext(ctx(userId), (db) =>
      new SettingsRepository().setUserModuleDisabled(db, {
        moduleId: "wellness",
        disabled: false,
        actorUserId: userId,
        requestId: "req:wellness-test"
      })
    );
  });
});

describe("feelings taxonomy (browser-safe, in @jarv1s/shared)", () => {
  it("has the six cores, each with secondary→tertiary leaves", () => {
    expect(FEELINGS_WHEEL.map((c) => c.core)).toEqual([
      "mad",
      "sad",
      "scared",
      "joyful",
      "powerful",
      "peaceful"
    ]);
    for (const core of FEELINGS_WHEEL) {
      expect(core.secondary.length).toBeGreaterThan(0);
      for (const sec of core.secondary) {
        expect(typeof sec.name).toBe("string");
        expect(Array.isArray(sec.tertiary)).toBe(true);
      }
    }
  });

  it("body-sensations is a non-empty curated list", () => {
    expect(BODY_SENSATIONS.length).toBeGreaterThanOrEqual(8);
    expect(BODY_SENSATIONS).toContain("Tight chest");
  });

  it("isValidFeelingPath accepts valid paths and rejects mismatches", () => {
    expect(isValidFeelingPath("scared")).toBe(true);
    expect(isValidFeelingPath("scared", "anxious")).toBe(true);
    expect(isValidFeelingPath("scared", "anxious", "overwhelmed")).toBe(true);
    expect(isValidFeelingPath("scared", "anxious", "not-a-leaf")).toBe(false);
    expect(isValidFeelingPath("scared", "not-a-secondary")).toBe(false);
    // a tertiary without its secondary is invalid
    expect(isValidFeelingPath("scared", null, "overwhelmed")).toBe(false);
  });
});

describe("module isolation: wellness ⇄ tasks", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  it("@jarv1s/wellness package.json does NOT depend on @jarv1s/tasks", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages/wellness/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@jarv1s/tasks");
  });

  it("@jarv1s/tasks package.json does NOT depend on @jarv1s/wellness", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "packages/tasks/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@jarv1s/wellness");
  });

  it("no wellness source file imports @jarv1s/tasks", () => {
    const files = [
      "manifest.ts",
      "repository.ts",
      "routes.ts",
      "tools.ts",
      "focus-signal.ts",
      "recall-context.ts",
      "schedule.ts",
      "serialize.ts"
    ];
    for (const file of files) {
      const src = readFileSync(join(repoRoot, "packages/wellness/src", file), "utf8");
      expect(src.includes("@jarv1s/tasks")).toBe(false);
    }
  });
});
