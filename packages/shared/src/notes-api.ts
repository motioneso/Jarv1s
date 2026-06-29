export interface GetNotesSourceResponse {
  readonly path: string | null;
}

export interface NotesSourceDirectory {
  readonly name: string;
  readonly path: string;
}

export interface GetNotesSourceDirectoriesResponse {
  readonly path: string | null;
  readonly directories: readonly NotesSourceDirectory[];
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

export const getNotesSourceDirectoriesRouteSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["path", "directories"],
      properties: {
        path: { type: ["string", "null"] },
        directories: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "path"],
            properties: {
              name: { type: "string" },
              path: { type: "string" }
            }
          }
        }
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

export interface NotesCreateInput {
  readonly path: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface NotesEditInput {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
}

export interface NotesDeleteInput {
  readonly path: string;
}

export interface NotesWriteResult {
  readonly path: string;
  readonly synced: boolean;
}

const relativeMarkdownPathProperty = {
  type: "string",
  description:
    'Vault-relative Markdown path (e.g. "Journal/2026-06-29.md"). Absolute sourcePath values returned by notes.search are also accepted.',
  minLength: 1,
  pattern: "^[^\\0]+\\.md$"
} as const;

export const notesCreateInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "content"],
  properties: {
    path: relativeMarkdownPathProperty,
    content: { type: "string" },
    overwrite: { type: "boolean" }
  }
} as const;

export const notesEditInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "oldText", "newText"],
  properties: {
    path: relativeMarkdownPathProperty,
    oldText: { type: "string", minLength: 1 },
    newText: { type: "string" }
  }
} as const;

export const notesDeleteInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: relativeMarkdownPathProperty
  }
} as const;

export const notesWriteResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "synced"],
  properties: {
    path: { type: "string" },
    synced: { type: "boolean" }
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
