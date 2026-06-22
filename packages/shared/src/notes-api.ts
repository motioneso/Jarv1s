export interface GetNotesSourceResponse {
  readonly path: string | null;
}

export interface PutNotesSourceRequest {
  readonly path: string | null;
}

export interface PostNotesSyncResponse {
  readonly jobId: string;
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
