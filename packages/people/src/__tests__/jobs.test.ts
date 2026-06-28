import { describe, expect, it } from "vitest";
import {
  assertMetadataOnlyPersonPayload,
  enqueuePersonIndex,
  PERSON_INDEX_QUEUE,
  SYNC_PERSON_MEMORY_QUEUE
} from "../jobs.js";

describe("assertMetadataOnlyPersonPayload", () => {
  it("accepts valid payload", () => {
    expect(() =>
      assertMetadataOnlyPersonPayload({
        actorUserId: "u1",
        source: "email",
        sourceRefHash: "abc",
        reason: "new_message",
        idempotencyKey: "k"
      })
    ).not.toThrow();
  });

  it("throws if source_ref is present", () => {
    expect(() =>
      assertMetadataOnlyPersonPayload({
        actorUserId: "u1",
        source: "email",
        sourceRefHash: "abc",
        reason: "r",
        idempotencyKey: "k",
        source_ref: "FORBIDDEN"
      })
    ).toThrow();
  });

  it("throws if normalizedValue is present", () => {
    expect(() =>
      assertMetadataOnlyPersonPayload({
        actorUserId: "u1",
        source: "email",
        sourceRefHash: "abc",
        reason: "r",
        idempotencyKey: "k",
        normalizedValue: "FORBIDDEN"
      })
    ).toThrow();
  });
});

it("queue names are defined", () => {
  expect(PERSON_INDEX_QUEUE).toBe("person-index");
  expect(SYNC_PERSON_MEMORY_QUEUE).toBe("sync-person-memory");
});

it("enqueuePersonIndex sends metadata-only payload", async () => {
  const sent: unknown[] = [];
  const mockBoss = {
    send: async (_q: string, d: unknown) => {
      sent.push(d);
      return "job-id";
    }
  } as never;

  await enqueuePersonIndex(mockBoss, {
    actorUserId: "00000000-0000-4000-8000-000000000001",
    source: "email",
    sourceRefHash: "abc123",
    reason: "new_message",
    idempotencyKey: "u1:email:abc123"
  });

  expect(sent.length).toBe(1);
  expect(sent[0]).not.toHaveProperty("source_ref");
  expect(sent[0]).not.toHaveProperty("normalizedValue");
  expect((sent[0] as Record<string, unknown>)["source"]).toBe("email");
});
