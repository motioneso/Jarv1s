import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import type { PgBoss } from "pg-boss";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { PeopleRepository } from "./repository.js";
import { PersonContextService } from "./service.js";
import { enqueuePersonIndexBatch } from "./jobs.js";
import type { PersonSourceKind } from "./types.js";

export interface PeopleRouteDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly boss?: PgBoss;
  readonly repo?: PeopleRepository;
  readonly svc?: PersonContextService;
}

export function registerPeopleRoutes(app: FastifyInstance, deps: PeopleRouteDependencies): void {
  const repo = deps.repo ?? new PeopleRepository();
  const svc = deps.svc ?? new PersonContextService(repo);

  // GET /api/people
  app.get("/api/people", { schema: { response: { 200: Type.Any() } } }, async (request) => {
    const ac = await deps.resolveAccessContext(request);
    const { search, status, limit } = request.query as {
      search?: string;
      status?: string;
      limit?: string;
    };
    return deps.dataContext.withDataContext(ac, async (sdb) => {
      const people = await svc.listPeople(sdb, ac.actorUserId, {
        search,
        status: status as "active" | "archived" | undefined,
        limit: limit ? parseInt(limit, 10) : undefined
      });
      return { people };
    });
  });

  // GET /api/people/resolve
  app.get("/api/people/resolve", { schema: { response: { 200: Type.Any() } } }, async (request) => {
    const ac = await deps.resolveAccessContext(request);
    const { q } = request.query as { q: string };
    return deps.dataContext.withDataContext(ac, async (sdb) => {
      const person = await svc.resolve(sdb, ac.actorUserId, q);
      return { person: person ?? null };
    });
  });

  // GET /api/people/match-candidates
  app.get(
    "/api/people/match-candidates",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const candidates = await svc.listMatchCandidates(sdb, ac.actorUserId);
        return { candidates };
      });
    }
  );

  // POST /api/people/match-candidates/:id/accept
  app.post(
    "/api/people/match-candidates/:id/accept",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        await svc.acceptCandidate(sdb, ac.actorUserId, id);
        return { accepted: true };
      });
    }
  );

  // POST /api/people/match-candidates/:id/reject
  app.post(
    "/api/people/match-candidates/:id/reject",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        await svc.rejectCandidate(sdb, ac.actorUserId, id);
        return { rejected: true };
      });
    }
  );

  // POST /api/people/match-candidates/:id/suppress
  app.post(
    "/api/people/match-candidates/:id/suppress",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        await svc.suppressCandidate(sdb, ac.actorUserId, id);
        return { suppressed: true };
      });
    }
  );

  // POST /api/people/index/refresh
  const refreshSchema = Type.Object({
    sourceRefs: Type.Array(
      Type.Object({
        source: Type.String(),
        sourceRefHash: Type.String(),
        sourceVersion: Type.Optional(Type.String()),
        reason: Type.String()
      }),
      { maxItems: 50 }
    )
  });
  app.post(
    "/api/people/index/refresh",
    { schema: { body: refreshSchema } },
    async (request, reply) => {
      const ac = await deps.resolveAccessContext(request);
      const { sourceRefs } = request.body as {
        sourceRefs: Array<{
          source: string;
          sourceRefHash: string;
          sourceVersion?: string;
          reason: string;
        }>;
      };
      if (deps.boss) {
        await enqueuePersonIndexBatch(
          deps.boss,
          sourceRefs.map((ref) => ({
            actorUserId: ac.actorUserId,
            source: ref.source as PersonSourceKind,
            sourceRefHash: ref.sourceRefHash,
            sourceVersion: ref.sourceVersion,
            reason: ref.reason,
            idempotencyKey: `person-index:${ac.actorUserId}:${ref.sourceRefHash}`
          }))
        );
      }
      reply.status(202);
      return { enqueued: sourceRefs.length };
    }
  );

  // GET /api/people/:id
  app.get("/api/people/:id", { schema: { response: { 200: Type.Any() } } }, async (request) => {
    const ac = await deps.resolveAccessContext(request);
    const { id } = request.params as { id: string };
    return deps.dataContext.withDataContext(ac, async (sdb) => {
      const person = await svc.getPerson(sdb, ac.actorUserId, id);
      return { person };
    });
  });

  // GET /api/people/:id/links
  app.get(
    "/api/people/:id/links",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      const { sourceKind, linkKind, limit } = request.query as {
        sourceKind?: string;
        linkKind?: string;
        limit?: string;
      };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const links = await svc.listLinks(sdb, ac.actorUserId, id, {
          sourceKind: sourceKind as "email" | undefined,
          linkKind: linkKind as "sender" | undefined,
          limit: limit ? parseInt(limit, 10) : undefined
        });
        return { links };
      });
    }
  );

  // PATCH /api/people/:id
  const updateSchema = Type.Object({
    displayName: Type.Optional(Type.String()),
    status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("archived")]))
  });
  app.patch(
    "/api/people/:id",
    { schema: { body: updateSchema, response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      const updates = request.body as { displayName?: string; status?: "active" | "archived" };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const person = await repo.updatePerson(sdb, ac.actorUserId, id, updates);
        return { person };
      });
    }
  );

  // POST /api/people/:id/archive
  app.post(
    "/api/people/:id/archive",
    { schema: { response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        await repo.archivePerson(sdb, ac.actorUserId, id);
        return { archived: true };
      });
    }
  );

  // POST /api/people/:id/merge
  const mergeSchema = Type.Object({ secondaryPersonId: Type.String() });
  app.post(
    "/api/people/:id/merge",
    { schema: { body: mergeSchema, response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      const { secondaryPersonId } = request.body as { secondaryPersonId: string };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const person = await svc.mergePeople(sdb, ac.actorUserId, id, secondaryPersonId);
        return { person };
      });
    }
  );

  // POST /api/people/:id/split-identity
  const splitSchema = Type.Object({
    identityId: Type.String(),
    targetPersonId: Type.Optional(Type.String()),
    newPersonDisplayName: Type.Optional(Type.String())
  });
  app.post(
    "/api/people/:id/split-identity",
    { schema: { body: splitSchema, response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      const { identityId, targetPersonId, newPersonDisplayName } = request.body as {
        identityId: string;
        targetPersonId?: string;
        newPersonDisplayName?: string;
      };
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const person = await svc.splitIdentity(
          sdb,
          ac.actorUserId,
          identityId,
          targetPersonId,
          newPersonDisplayName
        );
        return { person };
      });
    }
  );
}
