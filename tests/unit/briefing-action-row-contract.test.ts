import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  briefingStructuredPayloadV1Schema,
  taskDtoSchema,
  taskSuggestionMetadataV1Schema
} from "@moss/shared";

async function validate(schema: unknown, payload: Record<string, unknown>): Promise<number> {
  const app = Fastify();
  app.post(
    "/probe",
    { schema: { body: schema as never } },
    async (request) => request.body as Record<string, unknown>
  );
  const response = await app.inject({
    method: "POST",
    url: "/probe",
    payload,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return response.statusCode;
}

const suggestionMetadata = {
  version: 1,
  category: "needs_reply",
  sourceLabel: "Gmail",
  sourceHref: "https://mail.google.com/mail/u/0/#inbox/abc",
  cacheMessageId: "cache-1",
  subjectSignature: "a".repeat(64),
  computedAt: "2026-07-30T12:00:00.000Z",
  resurfaceReason: null
};

describe("briefing action row contracts", () => {
  it("rejects malformed suggestion metadata and structured payloads", async () => {
    expect(
      await validate(taskSuggestionMetadataV1Schema, {
        ...suggestionMetadata,
        category: "unknown"
      })
    ).toBe(400);

    expect(
      await validate(briefingStructuredPayloadV1Schema, {
        version: 1,
        actionRows: [
          {
            taskId: "task-1",
            title: "Reply",
            explanation: "Needs a reply",
            category: "not-a-category",
            status: "suggested",
            primaryAction: { kind: "reply", cacheMessageId: "cache-1" },
            source: "email",
            sourceLabel: "Gmail",
            sourceRef: "message-1",
            sourceHref: "https://mail.google.com/mail/u/0/#inbox/abc",
            dueAt: null,
            computedAt: "2026-07-30T12:00:00.000Z",
            resurfaceReason: null
          }
        ],
        catchUp: null
      })
    ).toBe(400);
  });

  it("closes the task DTO around typed suggestion metadata", async () => {
    expect((taskDtoSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect(
      await validate(taskDtoSchema, {
        id: "task-1",
        ownerUserId: "user-1",
        listId: "list-1",
        parentTaskId: null,
        title: "Reply",
        description: null,
        status: "suggested",
        priority: null,
        position: 0,
        dueAt: null,
        doAt: null,
        effort: null,
        source: "email",
        sourceRef: "message-1",
        completedAt: null,
        createdAt: null,
        updatedAt: null,
        tags: [],
        suggestionMetadata
      })
    ).toBe(200);
  });
});
