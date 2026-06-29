import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { sql, type Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createMemoryCandidateSignature,
  MemoryCandidatesRepository,
  MemoryGraphRepository,
  registerMemoryDashboardRoutes,
  type MemoryFactPredicate
} from "@jarv1s/memory";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let dashboardServer: FastifyInstance;
let originalEmbedProvider: string | undefined;

beforeAll(async () => {
  originalEmbedProvider = process.env.JARVIS_EMBED_PROVIDER;
  process.env.JARVIS_EMBED_PROVIDER = "stub";
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  appDataContext = new DataContextRunner(appDb);
  dashboardServer = Fastify();
  registerMemoryDashboardRoutes(dashboardServer, {
    dataContext: appDataContext,
    resolveAccessContext
  });
  await dashboardServer.ready();
});

afterAll(async () => {
  await dashboardServer?.close();
  await appDb?.destroy();
  if (originalEmbedProvider === undefined) {
    delete process.env.JARVIS_EMBED_PROVIDER;
  } else {
    process.env.JARVIS_EMBED_PROVIDER = originalEmbedProvider;
  }
});

async function resolveAccessContext(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (auth === "Bearer user-a") return { actorUserId: ids.userA, requestId: "dashboard-fixes" };
  if (auth === "Bearer user-b") return { actorUserId: ids.userB, requestId: "dashboard-fixes" };
  throw new Error("Unauthorized");
}

describe("self-entity delete protection (#560)", () => {
  const repo = new MemoryGraphRepository();

  it("returns 403 when deleting the self entity via dashboard route", async () => {
    let selfEntityId!: string;
    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "560:setup" },
      async (db) => {
        const self = await repo.ensureSelfEntity(db, ids.userA);
        selfEntityId = self.id;
      }
    );

    const response = await dashboardServer.inject({
      method: "DELETE",
      url: `/api/memory/graph/entities/${selfEntityId}`,
      headers: { authorization: "Bearer user-a" }
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toMatch(/self entity/i);
  });

  it("still allows deleting non-self entities with no facts", async () => {
    let projectEntityId!: string;
    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "560:allow-setup" },
      async (db) => {
        const entity = await repo.createEntity(db, ids.userA, {
          kind: "project",
          name: `deletable-project-${randomUUID()}`,
          summary: "test project",
          importance: 0.5,
          pinned: false
        });
        projectEntityId = entity.id;
      }
    );

    const response = await dashboardServer.inject({
      method: "DELETE",
      url: `/api/memory/graph/entities/${projectEntityId}`,
      headers: { authorization: "Bearer user-a" }
    });

    expect(response.statusCode).toBe(204);
  });
});

describe("acceptCandidate creates fact without superseding unrelated prefs (#561)", () => {
  const repo = new MemoryGraphRepository();
  const candidatesRepo = new MemoryCandidatesRepository();

  it("creates the candidate fact while leaving pre-existing same-predicate facts intact", async () => {
    // The memory model allows multiple independent active facts with the same predicate
    // (e.g. "prefers dark mode" and "prefers early mornings" are both valid simultaneously).
    // Accepting a candidate must NOT silently supersede unrelated memories.
    const existingObjectText = `existing-pref-${randomUUID()}`;
    const newObjectText = `new-pref-${randomUUID()}`;
    let existingFactId!: string;
    let candidateId!: string;

    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "561:setup" },
      async (db) => {
        const self = await repo.ensureSelfEntity(db, ids.userA);
        const existing = await repo.createFact(db, ids.userA, {
          subjectEntityId: self.id,
          predicate: "prefers",
          objectText: existingObjectText,
          confidence: 0.8,
          provenance: "confirmed",
          source: { sourceKind: "manual", sourceRef: "manual:561-existing", excerpt: "existing" }
        });
        existingFactId = existing.id;

        const sig = createMemoryCandidateSignature({
          kind: "fact",
          action: "create",
          fact: { predicate: "prefers", objectText: newObjectText }
        });
        const candidate = await candidatesRepo.insertPending(db, ids.userA, {
          episodeId: null,
          kind: "fact",
          action: "create",
          confidence: 0.9,
          importance: 0.5,
          provenance: "inferred",
          candidateSignature: sig,
          payloadJson: { kind: "fact", fact: { predicate: "prefers", objectText: newObjectText } }
        });
        candidateId = candidate.id;
      }
    );

    const response = await dashboardServer.inject({
      method: "POST",
      url: `/api/memory/candidates/${candidateId}/accept`,
      headers: { authorization: "Bearer user-a" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { accepted: boolean };
    expect(body.accepted).toBe(true);

    // Both facts must be active — the candidate was created without superseding the existing one.
    const statuses = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "561:check" },
      async (db) => {
        const result = await sql<{ id: string; object_text: string; status: string }>`
          SELECT id, object_text, status FROM app.memory_facts
          WHERE owner_user_id = ${ids.userA}::uuid
            AND id IN (
              ${existingFactId}::uuid,
              (SELECT id FROM app.memory_facts
                WHERE owner_user_id = ${ids.userA}::uuid
                  AND object_text = ${newObjectText}
                  AND predicate = 'prefers'
                  AND status = 'active'
                LIMIT 1)
            )
        `.execute(db.db);
        return result.rows;
      }
    );

    const existingRow = statuses.find((r) => r.id === existingFactId);
    const newRow = statuses.find((r) => r.object_text === newObjectText);
    expect(existingRow?.status).toBe("active");
    expect(newRow?.status).toBe("active");
  });
});

describe("factToItem sourceSummary privacy (#562)", () => {
  const repo = new MemoryGraphRepository();

  it("does not expose raw UUID sourceRef in sourceSummary when sourceLabel is absent", async () => {
    const rawUuid = randomUUID();
    let factId!: string;

    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "562:setup" },
      async (db) => {
        const self = await repo.ensureSelfEntity(db, ids.userA);
        const fact = await repo.createFact(db, ids.userA, {
          subjectEntityId: self.id,
          predicate: "related_to",
          objectText: `source-privacy-test-${randomUUID()}`,
          confidence: 0.6,
          provenance: "inferred",
          source: { sourceKind: "chat", sourceRef: rawUuid, sourceLabel: "", excerpt: "test" }
        });
        factId = fact.id;
      }
    );

    const response = await dashboardServer.inject({
      method: "GET",
      url: `/api/memory/dashboard?status=active&limit=100`,
      headers: { authorization: "Bearer user-a" }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      items: Array<{ id: string; sourceSummary: string }>;
    };
    const item = body.items.find((i) => i.id === factId);
    expect(item).toBeDefined();
    expect(item?.sourceSummary).not.toBe(rawUuid);
    expect(item?.sourceSummary).toBe("Chat");
  });

  it("uses sourceLabel when present even if sourceRef is a UUID", async () => {
    const rawUuid = randomUUID();
    let factId!: string;

    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "562:label-setup" },
      async (db) => {
        const self = await repo.ensureSelfEntity(db, ids.userA);
        const fact = await repo.createFact(db, ids.userA, {
          subjectEntityId: self.id,
          predicate: "related_to",
          objectText: `source-label-test-${randomUUID()}`,
          confidence: 0.6,
          provenance: "inferred",
          source: {
            sourceKind: "chat",
            sourceRef: rawUuid,
            sourceLabel: "My Chat",
            excerpt: "test"
          }
        });
        factId = fact.id;
      }
    );

    const response = await dashboardServer.inject({
      method: "GET",
      url: `/api/memory/dashboard?status=active&limit=100`,
      headers: { authorization: "Bearer user-a" }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      items: Array<{ id: string; sourceSummary: string }>;
    };
    const item = body.items.find((i) => i.id === factId);
    expect(item?.sourceSummary).toBe("My Chat");
  });
});
