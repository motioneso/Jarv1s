import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner, Note, NoteVisibility } from "@jarv1s/db";
import {
  createNoteRouteSchema,
  getNoteRouteSchema,
  listNotesRouteSchema,
  updateNoteRouteSchema,
  type NoteDto
} from "@jarv1s/shared";

import { NotesRepository } from "./repository.js";

export interface NotesRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: NotesRepository;
}

interface NoteParams {
  readonly id: string;
}

export function registerNotesRoutes(
  server: FastifyInstance,
  dependencies: NotesRoutesDependencies
): void {
  const repository = dependencies.repository ?? new NotesRepository();

  server.get("/api/notes", { schema: listNotesRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const notes = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.listVisible(scopedDb)
      );

      return { notes: notes.map(serializeNote) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/notes", { schema: createNoteRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = parseCreateNoteBody(request.body);
      ensureWorkspaceVisibilityContext(accessContext, input);
      const note = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.create(scopedDb, input)
      );

      return reply.code(201).send({ note: serializeNote(note) });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get<{ Params: NoteParams }>(
    "/api/notes/:id",
    { schema: getNoteRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const note = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getById(scopedDb, request.params.id)
        );

        if (!note) {
          return reply.code(404).send({ error: "Note not found" });
        }

        return { note: serializeNote(note) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: NoteParams }>(
    "/api/notes/:id",
    { schema: updateNoteRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseUpdateNoteBody(request.body);
        ensureWorkspaceVisibilityContext(accessContext, input);
        const note = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.update(scopedDb, request.params.id, input)
        );

        if (!note) {
          return reply.code(404).send({ error: "Note not found" });
        }

        return { note: serializeNote(note) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateNoteBody(body: unknown) {
  const value = requireObject(body);
  const visibility = optionalNoteVisibility(value.visibility) ?? "private";
  const workspaceId =
    visibility === "workspace" ? requiredString(value.workspaceId, "workspaceId") : null;

  return {
    title: requiredString(value.title, "title"),
    body: optionalNullableString(value.body, "body"),
    visibility,
    workspaceId
  };
}

function parseUpdateNoteBody(body: unknown) {
  const value = requireObject(body);
  const visibility = optionalNoteVisibility(value.visibility);

  if (visibility === "workspace" && value.workspaceId === undefined) {
    throw new HttpError(400, "workspaceId is required for workspace-visible notes");
  }

  return {
    title: optionalString(value.title, "title"),
    body: optionalNullableString(value.body, "body"),
    visibility,
    workspaceId: optionalNullableString(value.workspaceId, "workspaceId"),
    archived: optionalBoolean(value.archived, "archived")
  };
}

function ensureWorkspaceVisibilityContext(
  accessContext: AccessContext,
  input: { readonly visibility?: NoteVisibility; readonly workspaceId?: string | null }
): void {
  if (input.visibility !== "workspace") {
    return;
  }

  if (!accessContext.workspaceId || input.workspaceId !== accessContext.workspaceId) {
    throw new HttpError(400, "workspace-visible notes require the active workspace context");
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value, fieldName);

  if (!parsed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return parsed;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function optionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === null) {
    return null;
  }

  return optionalString(value, fieldName);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
}

function optionalNoteVisibility(value: unknown): NoteVisibility | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "private" && value !== "workspace") {
    throw new HttpError(400, "visibility must be private or workspace");
  }

  return value;
}

export function serializeNote(note: Note): NoteDto {
  return {
    id: note.id,
    ownerUserId: note.owner_user_id,
    workspaceId: note.workspace_id,
    visibility: note.visibility,
    title: note.title,
    body: note.body,
    archivedAt: toIsoString(note.archived_at),
    createdAt: toIsoString(note.created_at),
    updatedAt: toIsoString(note.updated_at)
  };
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  return reply.code(401).send({ error: "Session is missing or expired" });
}
