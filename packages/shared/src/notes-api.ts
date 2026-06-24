export interface GetNotesSourceResponse {
  readonly path: string | null;
}

export interface PutNotesSourceRequest {
  readonly path: string | null;
}

export interface PostNotesSyncResponse {
  readonly jobId: string;
}

export interface NotesLastSyncStats {
  readonly at: string | null;
  readonly ingested: number;
  readonly skipped: number;
  readonly errors: number;
  readonly lastError?: string;
}

export interface GetNotesLastSyncResponse {
  /** `null` when no sync has ever run for this actor. */
  readonly lastSync: NotesLastSyncStats | null;
}

export const getNotesSourceRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: ["string", "null"] }
      }
    }
  }
} as const;

export const putNotesSourceRouteSchema = {
  body: {
    type: ["object", "null"],
    properties: {
      path: { type: ["string", "null"] }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: ["string", "null"] }
      }
    }
  }
} as const;

export const postNotesSyncRouteSchema = {
  response: {
    202: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: {
        jobId: { type: "string" }
      }
    }
  }
} as const;

export const getNotesLastSyncRouteSchema = {
  response: {
    200: {
      // Fix 10 (#449): the route always sends `{ lastSync: <obj|null> }`, never a
      // top-level null. The outer type was `["object","null"]` which can't
      // satisfy `required: ["lastSync"]` — tightened to `"object"`. Inner
      // `lastSync` stays nullable (that's the real nullability).
      type: "object",
      additionalProperties: false,
      required: ["lastSync"],
      properties: {
        lastSync: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["at", "ingested", "skipped", "errors"],
          properties: {
            at: { type: ["string", "null"] },
            ingested: { type: "number" },
            skipped: { type: "number" },
            errors: { type: "number" },
            lastError: { type: "string" }
          }
        }
      }
    }
  }
} as const;

export const notesSearchInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string" },
    limit: { type: "number" }
  }
} as const;

export const notesSearchResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chunks"],
  properties: {
    chunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourcePath", "lineStart", "lineEnd", "text"],
        properties: {
          sourcePath: { type: "string" },
          lineStart: { type: "number" },
          lineEnd: { type: "number" },
          text: { type: "string" }
        }
      }
    }
  }
} as const;
