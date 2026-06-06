export const NOTE_VISIBILITIES = ["private", "workspace"] as const;

export type NoteApiVisibility = (typeof NOTE_VISIBILITIES)[number];

export interface NoteDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly visibility: NoteApiVisibility;
  readonly title: string;
  readonly body: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ListNotesResponse {
  readonly notes: readonly NoteDto[];
}

export interface CreateNoteRequest {
  readonly title: string;
  readonly body?: string | null;
  readonly visibility?: NoteApiVisibility;
  readonly workspaceId?: string | null;
}

export interface CreateNoteResponse {
  readonly note: NoteDto;
}

export interface GetNoteResponse {
  readonly note: NoteDto;
}

export interface UpdateNoteRequest {
  readonly title?: string;
  readonly body?: string | null;
  readonly visibility?: NoteApiVisibility;
  readonly workspaceId?: string | null;
  readonly archived?: boolean;
}

export interface UpdateNoteResponse {
  readonly note: NoteDto;
}

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

export const noteVisibilitySchema = {
  type: "string",
  enum: NOTE_VISIBILITIES
} as const;

export const noteParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const noteDtoSchema = {
  type: "object",
  required: [
    "id",
    "ownerUserId",
    "workspaceId",
    "visibility",
    "title",
    "body",
    "archivedAt",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    workspaceId: nullableStringSchema,
    visibility: noteVisibilitySchema,
    title: { type: "string" },
    body: nullableStringSchema,
    archivedAt: nullableStringSchema,
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema
  }
} as const;

export const listNotesResponseSchema = {
  type: "object",
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      items: noteDtoSchema
    }
  }
} as const;

export const createNoteRequestSchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string" },
    body: nullableStringSchema,
    visibility: noteVisibilitySchema,
    workspaceId: nullableStringSchema
  }
} as const;

export const createNoteResponseSchema = {
  type: "object",
  required: ["note"],
  properties: {
    note: noteDtoSchema
  }
} as const;

export const getNoteResponseSchema = createNoteResponseSchema;

export const updateNoteRequestSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: nullableStringSchema,
    visibility: noteVisibilitySchema,
    workspaceId: nullableStringSchema,
    archived: { type: "boolean" }
  }
} as const;

export const updateNoteResponseSchema = createNoteResponseSchema;

export const listNotesRouteSchema = {
  response: {
    200: listNotesResponseSchema
  }
} as const;

export const createNoteRouteSchema = {
  body: createNoteRequestSchema,
  response: {
    201: createNoteResponseSchema
  }
} as const;

export const getNoteRouteSchema = {
  params: noteParamsSchema,
  response: {
    200: getNoteResponseSchema
  }
} as const;

export const updateNoteRouteSchema = {
  params: noteParamsSchema,
  body: updateNoteRequestSchema,
  response: {
    200: updateNoteResponseSchema
  }
} as const;
