import { type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { WellnessRepository, WellnessRecallContributor } from "@jarv1s/wellness";
import { ChatMemoryFactsRepository } from "@jarv1s/memory";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const consentOffUser = "00000000-0000-4000-8000-000000000045";
const consentRevokeUser = "00000000-0000-4000-8000-000000000046";

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:wellness-energy-trend-consent-test" };
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
       VALUES ($1, 'consent-off@example.test', false), ($2, 'consent-revoke@example.test', false)`,
      [consentOffUser, consentRevokeUser]
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

// #769: WellnessRecallContributor.refreshEnergyTrendFact wrote a [wellness:energy-trend]
// chat-memory fact (an AI-prompt surface) with no consent check, regardless of
// wellness.ai_consent_granted. These tests exercise the fixed unit directly — the route-level
// wiring (POST/PATCH checkins, PUT ai-consent) is covered in wellness-phase2.test.ts.
describe("WellnessRecallContributor consent gating (#769)", () => {
  it("refreshEnergyTrendFact(consentGranted=false) does not write a new energy-trend fact", async () => {
    const contributor = new WellnessRecallContributor();
    const facts = new ChatMemoryFactsRepository();

    await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      new WellnessRepository().createCheckin(db, {
        feelingCore: "sad",
        intensity: 2,
        energy: 2
      })
    );

    await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      contributor.refreshEnergyTrendFact(db, consentOffUser, false)
    );

    const active = await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      facts.listActiveFacts(db, consentOffUser)
    );
    expect(
      active.some((f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]"))
    ).toBe(false);
  });

  it("refreshEnergyTrendFact(consentGranted=true) still writes the fact — no regression", async () => {
    const contributor = new WellnessRecallContributor();
    const facts = new ChatMemoryFactsRepository();

    await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      new WellnessRepository().createCheckin(db, {
        feelingCore: "happy",
        intensity: 4,
        energy: 5
      })
    );

    await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      contributor.refreshEnergyTrendFact(db, consentOffUser, true)
    );

    const active = await dataContext.withDataContext(ctx(consentOffUser), (db) =>
      facts.listActiveFacts(db, consentOffUser)
    );
    expect(
      active.some((f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]"))
    ).toBe(true);
  });

  it("revoking consent after a fact was already written supersedes it (invalidateEnergyTrendFact)", async () => {
    const contributor = new WellnessRecallContributor();
    const facts = new ChatMemoryFactsRepository();

    await dataContext.withDataContext(ctx(consentRevokeUser), (db) =>
      new WellnessRepository().createCheckin(db, {
        feelingCore: "sad",
        intensity: 2,
        energy: 2
      })
    );

    // Consent ON — writes an active energy-trend fact.
    await dataContext.withDataContext(ctx(consentRevokeUser), (db) =>
      contributor.refreshEnergyTrendFact(db, consentRevokeUser, true)
    );
    const afterGrant = await dataContext.withDataContext(ctx(consentRevokeUser), (db) =>
      facts.listActiveFacts(db, consentRevokeUser)
    );
    expect(
      afterGrant.some(
        (f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]")
      )
    ).toBe(true);

    // Consent revoked — the previously-written fact must be superseded (invalidated), not
    // left active, so it stops reaching prompts (#769 core requirement).
    await dataContext.withDataContext(ctx(consentRevokeUser), (db) =>
      contributor.invalidateEnergyTrendFact(db, consentRevokeUser)
    );
    const afterRevoke = await dataContext.withDataContext(ctx(consentRevokeUser), (db) =>
      facts.listActiveFacts(db, consentRevokeUser)
    );
    expect(
      afterRevoke.some(
        (f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]")
      )
    ).toBe(false);
  });

  it("refreshEnergyTrendFact(consentGranted=false) also supersedes a stale fact written earlier", async () => {
    // Defense in depth: if a check-in fires while consent is off and a fact from a prior
    // consent-ON period is still active, it must not linger.
    const owner = "00000000-0000-4000-8000-000000000047";
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'consent-off-stale@example.test', false) ON CONFLICT (id) DO NOTHING`,
        [owner]
      );
    } finally {
      await client.end();
    }

    const contributor = new WellnessRecallContributor();
    const facts = new ChatMemoryFactsRepository();

    await dataContext.withDataContext(ctx(owner), (db) =>
      new WellnessRepository().createCheckin(db, { feelingCore: "happy", intensity: 4, energy: 5 })
    );
    await dataContext.withDataContext(ctx(owner), (db) =>
      contributor.refreshEnergyTrendFact(db, owner, true)
    );
    const afterGrant = await dataContext.withDataContext(ctx(owner), (db) =>
      facts.listActiveFacts(db, owner)
    );
    expect(
      afterGrant.some(
        (f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]")
      )
    ).toBe(true);

    // A later check-in fires with consent now off.
    await dataContext.withDataContext(ctx(owner), (db) =>
      new WellnessRepository().createCheckin(db, { feelingCore: "sad", intensity: 2, energy: 1 })
    );
    await dataContext.withDataContext(ctx(owner), (db) =>
      contributor.refreshEnergyTrendFact(db, owner, false)
    );

    const afterOffCheckin = await dataContext.withDataContext(ctx(owner), (db) =>
      facts.listActiveFacts(db, owner)
    );
    expect(
      afterOffCheckin.some(
        (f) => f.category === "profile" && f.content.includes("[wellness:energy-trend]")
      )
    ).toBe(false);
  });
});
