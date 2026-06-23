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
      type: ["object", "null"],
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
