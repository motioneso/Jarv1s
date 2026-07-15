import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import type { PgBoss } from "pg-boss";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { listVaultDirectories, VaultPathError, type VaultContextRunner } from "@jarv1s/vault";
import { PeopleRepository } from "./repository.js";
import { PersonContextService } from "./service.js";
import {
  CanonicalNoteNotFoundError,
  PeopleNotesFolderUnavailableError,
  PeopleNotesService
} from "./notes-service.js";
import { enqueuePersonIndexBatch } from "./jobs.js";
import type { PersonSourceKind } from "./types.js";

export interface PeopleRouteDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly boss?: PgBoss;
  readonly repo?: PeopleRepository;
  readonly svc?: PersonContextService;
  readonly vaultRunner?: VaultContextRunner;
  readonly peopleNotesService?: PeopleNotesService;
}

function isUnavailableVaultError(error: unknown): boolean {
  const fsError = error as NodeJS.ErrnoException;
  return (
    error instanceof VaultPathError ||
    ["ENOENT", "ENOTDIR", "EACCES"].includes(fsError?.code ?? "") ||
    (typeof fsError?.code === "string" &&
      (typeof fsError.path === "string" || typeof fsError.syscall === "string"))
  );
}

export function registerPeopleRoutes(app: FastifyInstance, deps: PeopleRouteDependencies): void {
  const repo = deps.repo ?? new PeopleRepository();
  const svc = deps.svc ?? new PersonContextService(repo);
  const notesService =
    deps.peopleNotesService ?? new PeopleNotesService({ peopleRepository: repo });

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
  const indexRefreshSchema = Type.Object({
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
    { schema: { body: indexRefreshSchema } },
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

  const notesSettingsSchema = Type.Object({
    folder: Type.Union([Type.String(), Type.Null()])
  });
  const directoryEntrySchema = Type.Object({ name: Type.String(), path: Type.String() });
  const directoriesSchema = Type.Object({
    path: Type.Union([Type.String(), Type.Null()]),
    directories: Type.Array(directoryEntrySchema)
  });
  const peopleRefreshSchema = Type.Object({
    discovered: Type.Number(),
    projected: Type.Number(),
    ignored: Type.Number(),
    candidates: Type.Number()
  });
  const safeErrorSchema = Type.Object({ error: Type.String() });

  app.get(
    "/api/people/notes-directories",
    { schema: { response: { 200: directoriesSchema, 400: safeErrorSchema } } },
    async (request, reply) => {
      const ac = await deps.resolveAccessContext(request);
      if (!deps.vaultRunner) throw new Error("Vault runner is not configured");
      const requested = ((request.query as { path?: string }).path ?? "").trim();
      try {
        const path = requested || ".";
        const directories = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
          listVaultDirectories(vaultCtx, path)
        );
        return { path: requested ? requested : null, directories };
      } catch (error) {
        if (isUnavailableVaultError(error)) {
          return reply.status(400).send({ error: "People notes folder is unavailable" });
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/people/notes-settings",
    { schema: { response: { 200: notesSettingsSchema } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      return deps.dataContext.withDataContext(ac, (sdb) =>
        notesService.getSettings(sdb, ac.actorUserId)
      );
    }
  );

  app.put(
    "/api/people/notes-settings",
    {
      schema: {
        body: notesSettingsSchema,
        response: { 200: notesSettingsSchema, 400: safeErrorSchema }
      }
    },
    async (request, reply) => {
      const ac = await deps.resolveAccessContext(request);
      const body = request.body as { folder: string | null };
      if (
        body.folder &&
        (body.folder.startsWith("/") || body.folder.split(/[\\/]/).includes(".."))
      ) {
        return reply.status(400).send({ error: "People notes folder is unavailable" });
      }
      if (body.folder && body.folder !== "." && body.folder !== "People") {
        if (!deps.vaultRunner) throw new Error("Vault runner is not configured");
        const normalized = body.folder.replace(/^\/+|\/+$/g, "");
        const slash = normalized.lastIndexOf("/");
        const parent = slash < 0 ? "." : normalized.slice(0, slash);
        let directories: Awaited<ReturnType<typeof listVaultDirectories>>;
        try {
          directories = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
            listVaultDirectories(vaultCtx, parent)
          );
        } catch (error) {
          if (isUnavailableVaultError(error)) {
            return reply.status(400).send({ error: "People notes folder is unavailable" });
          }
          throw error;
        }
        if (!directories.some((directory) => directory.path === normalized)) {
          return reply.status(400).send({ error: "People notes folder is unavailable" });
        }
      }
      return deps.dataContext.withDataContext(ac, (sdb) =>
        notesService.putSettings(sdb, ac.actorUserId, body)
      );
    }
  );

  app.post(
    "/api/people/notes/refresh",
    { schema: { response: { 200: peopleRefreshSchema, 400: safeErrorSchema } } },
    async (request, reply) => {
      const ac = await deps.resolveAccessContext(request);
      if (!deps.vaultRunner) throw new Error("Vault runner is not configured");
      try {
        return await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
          deps.dataContext.withDataContext(ac, (sdb) =>
            notesService.refreshFromFolder(sdb, vaultCtx, ac.actorUserId)
          )
        );
      } catch (error) {
        if (error instanceof PeopleNotesFolderUnavailableError) {
          return reply.status(400).send({ error: "People notes folder is unavailable" });
        }
        throw error;
      }
    }
  );

  const createSchema = Type.Object({
    displayName: Type.String(),
    aliases: Type.Optional(Type.Array(Type.String())),
    emails: Type.Optional(Type.Array(Type.String())),
    phones: Type.Optional(Type.Array(Type.String()))
  });

  app.post(
    "/api/people",
    { schema: { body: createSchema, response: { 200: Type.Any() } } },
    async (request) => {
      const ac = await deps.resolveAccessContext(request);
      if (!deps.vaultRunner) throw new Error("Vault runner is not configured");
      const body = request.body as {
        displayName: string;
        aliases?: string[];
        emails?: string[];
        phones?: string[];
      };
      return deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
        deps.dataContext.withDataContext(ac, async (sdb) => {
          const result = await notesService.createPersonNote(sdb, vaultCtx, ac.actorUserId, body);
          return { person: result.person, notePath: result.notePath };
        })
      );
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
        const settings = await notesService.getSettings(sdb, ac.actorUserId);
        if (settings.folder && deps.vaultRunner) {
          try {
            const result = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
              notesService.updatePersonNote(sdb, vaultCtx, ac.actorUserId, id, updates)
            );
            return { person: result.person, notePath: result.notePath };
          } catch (err) {
            if (!(err instanceof CanonicalNoteNotFoundError)) throw err;
          }
        }
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
        const settings = await notesService.getSettings(sdb, ac.actorUserId);
        if (settings.folder && deps.vaultRunner) {
          try {
            const result = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
              notesService.archivePersonNote(sdb, vaultCtx, ac.actorUserId, id)
            );
            return { archived: true, person: result.person, notePath: result.notePath };
          } catch (err) {
            if (!(err instanceof CanonicalNoteNotFoundError)) throw err;
          }
        }
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
