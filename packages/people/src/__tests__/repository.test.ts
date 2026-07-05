import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import type { Kysely } from "kysely";
import type { JarvisDatabase } from "@jarv1s/db";

import { resetFoundationDatabase, ids } from "../../../../tests/integration/test-database.js";
import { PeopleRepository } from "../repository.js";

const connectionStrings = getJarvisDatabaseUrls();
let db: Kysely<JarvisDatabase>;
let runner: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  runner = new DataContextRunner(db as never);
});

afterAll(async () => {
  await db?.destroy();
});

describe("PeopleRepository", () => {
  it("upsertPerson creates then returns existing on re-upsert", async () => {
    const repo = new PeopleRepository();
    const ac = { actorUserId: ids.userA, requestId: "r1" };

    let firstId: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const p = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Bob",
        status: "active"
      });
      firstId = p.id;
      expect(p.id).toBeDefined();
      expect(p.displayName).toBe("Bob");
    });

    await runner.withDataContext(ac, async (sdb) => {
      const p2 = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Bob",
        status: "active"
      });
      expect(p2.id).toBe(firstId);
    });
  });

  it("getPerson returns person by id", async () => {
    const repo = new PeopleRepository();
    const ac = { actorUserId: ids.userA, requestId: "r2" };

    let pid: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const p = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Carol",
        status: "active"
      });
      pid = p.id;
    });

    await runner.withDataContext(ac, async (sdb) => {
      const p = await repo.getPerson(sdb, ids.userA, pid!);
      expect(p.displayName).toBe("Carol");
    });
  });

  it("listPeople returns only the actor's people (RLS)", async () => {
    const repo = new PeopleRepository();

    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r3" }, async (sdb) => {
      await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "User A Person",
        status: "active"
      });
    });

    await runner.withDataContext({ actorUserId: ids.userB, requestId: "r4" }, async (sdb) => {
      const rows = await repo.listPeople(sdb, ids.userB, {});
      expect(rows.every((r) => r.ownerUserId === ids.userB)).toBe(true);
    });
  });

  it("upsertIdentity and listIdentities omit normalizedValue and sourceRef", async () => {
    const repo = new PeopleRepository();
    const ac = { actorUserId: ids.userA, requestId: "r5" };

    let pid: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const p = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Dave",
        status: "active"
      });
      pid = p.id;
      await repo.upsertIdentity(sdb, {
        ownerUserId: ids.userA,
        personId: pid!,
        identityKind: "email_address",
        sourceKind: "email",
        normalizedValue: "dave@example.com",
        displayValue: "Dave <dave@example.com>",
        sourceRef: null,
        sourceRefHash: null,
        status: "active",
        confidence: 0.9,
        provenance: "source"
      });
    });

    await runner.withDataContext(ac, async (sdb) => {
      const identities = await repo.listIdentities(sdb, ids.userA, pid!);
      expect(identities.length).toBeGreaterThan(0);
      expect("normalizedValue" in identities[0]!).toBe(false);
      expect("sourceRef" in identities[0]!).toBe(false);
    });
  });

  it("upsertPersonProjection's ON CONFLICT update is owner-scoped independent of RLS (#758/#749)", async () => {
    const repo = new PeopleRepository();
    const acA = { actorUserId: ids.userA, requestId: "r-owner-scope-1" };

    let personId: string | undefined;
    await runner.withDataContext(acA, async (sdb) => {
      const p = await repo.upsertPersonProjection(sdb, {
        ownerUserId: ids.userA,
        personId: randomUUID(),
        displayName: "Eve"
      });
      personId = p.id;
    });

    // The conflict target (`id`) is caller-controlled, so a second actor could supply an id that
    // collides with another user's existing row. RLS already blocks this in production, but to
    // prove the `.where("owner_user_id", ...)` predicate on the DO UPDATE SET clause is itself
    // doing work (not just RLS), run the attempted cross-owner update on the RLS-bypassing
    // bootstrap (superuser) connection: a zero-row update there can only come from the predicate.
    const bootstrapDb = createDatabase({ connectionString: connectionStrings.bootstrap });
    const bootstrapRunner = new DataContextRunner(bootstrapDb);
    try {
      await bootstrapRunner.withDataContext(
        { actorUserId: ids.userB, requestId: "r-owner-scope-2" },
        async (sdb) => {
          await expect(
            repo.upsertPersonProjection(sdb, {
              ownerUserId: ids.userB,
              personId: personId!,
              displayName: "Attacker overwrite"
            })
          ).rejects.toThrow();
        }
      );
    } finally {
      await bootstrapDb.destroy();
    }

    await runner.withDataContext(acA, async (sdb) => {
      const p = await repo.getPerson(sdb, ids.userA, personId!);
      expect(p.displayName).toBe("Eve");
    });
  });
});
