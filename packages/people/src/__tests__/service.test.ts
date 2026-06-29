import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import type { Kysely } from "kysely";
import type { JarvisDatabase } from "@jarv1s/db";

import { resetFoundationDatabase, ids } from "../../../../tests/integration/test-database.js";
import { PeopleRepository } from "../repository.js";
import { PersonContextService } from "../service.js";

const connectionStrings = getJarvisDatabaseUrls();
let db: Kysely<JarvisDatabase>;
let runner: DataContextRunner;
let repo: PeopleRepository;
let svc: PersonContextService;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  runner = new DataContextRunner(db as never);
  repo = new PeopleRepository();
  svc = new PersonContextService(repo);
});

afterAll(async () => {
  await db?.destroy();
});

describe("PersonContextService", () => {
  it("getPerson throws NOT_FOUND for unknown id", async () => {
    const ac = { actorUserId: ids.userA, requestId: "s1" };
    await expect(
      runner.withDataContext(ac, (sdb) =>
        svc.getPerson(sdb, ids.userA, "00000000-0000-4000-8000-000000099999")
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolve returns null for unknown email", async () => {
    const ac = { actorUserId: ids.userA, requestId: "s2" };
    const result = await runner.withDataContext(ac, (sdb) =>
      svc.resolve(sdb, ids.userA, "nobody@unknown.test")
    );
    expect(result).toBeNull();
  });

  it("acceptCandidate for link_identity succeeds", async () => {
    const ac = { actorUserId: ids.userA, requestId: "s3" };

    let pid: string | undefined;
    let cid: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const person = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Eve",
        status: "active"
      });
      pid = person.id;

      const candidate = await repo.upsertMatchCandidate(sdb, {
        ownerUserId: ids.userA,
        candidateKind: "link_identity",
        primaryPersonId: pid!,
        confidence: 0.8,
        ids: [pid!]
      });
      cid = candidate.id;
    });

    await runner.withDataContext(ac, async (sdb) => {
      await svc.acceptCandidate(sdb, ids.userA, cid!);
      const updated = await repo.getMatchCandidate(sdb, ids.userA, cid!);
      expect(updated?.status).toBe("accepted");
    });
  });

  it("acceptCandidate for merge_people throws RequiresExplicitActionError", async () => {
    const ac = { actorUserId: ids.userA, requestId: "s4" };

    let cid: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const p1 = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Frank A",
        status: "active"
      });
      const p2 = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Frank B",
        status: "active"
      });
      const candidate = await repo.upsertMatchCandidate(sdb, {
        ownerUserId: ids.userA,
        candidateKind: "merge_people",
        primaryPersonId: p1.id,
        secondaryPersonId: p2.id,
        confidence: 0.9,
        ids: [p1.id, p2.id]
      });
      cid = candidate.id;
    });

    await expect(
      runner.withDataContext(ac, (sdb) => svc.acceptCandidate(sdb, ids.userA, cid!))
    ).rejects.toMatchObject({ code: "REQUIRES_EXPLICIT_ACTION" });
  });

  it("rejectCandidate sets status to rejected", async () => {
    const ac = { actorUserId: ids.userA, requestId: "s5" };
    let cid: string | undefined;

    await runner.withDataContext(ac, async (sdb) => {
      const person = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Grace",
        status: "active"
      });
      const candidate = await repo.upsertMatchCandidate(sdb, {
        ownerUserId: ids.userA,
        candidateKind: "create_person",
        confidence: 0.5,
        ids: [person.id]
      });
      cid = candidate.id;
    });

    await runner.withDataContext(ac, async (sdb) => {
      await svc.rejectCandidate(sdb, ids.userA, cid!);
      const updated = await repo.getMatchCandidate(sdb, ids.userA, cid!);
      expect(updated?.status).toBe("rejected");
    });
  });
});
