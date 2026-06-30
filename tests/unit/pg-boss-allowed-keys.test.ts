import { describe, it, expect } from "vitest";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

describe("assertMetadataOnlyPayload", () => {
  it("allows sourceRef and sourceVersion", () => {
    expect(() =>
      assertMetadataOnlyPayload({
        actorUserId: "u1",
        idempotencyKey: "k1",
        sourceRef: "chat:abc",
        sourceVersion: 3
      })
    ).not.toThrow();
  });

  it("allows commitment extraction enqueue payload (actorUserId + sourceKind + idempotencyKey)", () => {
    expect(() =>
      assertMetadataOnlyPayload({
        actorUserId: "u1",
        sourceKind: "chat",
        idempotencyKey: "extract:u1:chat"
      })
    ).not.toThrow();
  });

  it("allows upgrade notification payload metadata", () => {
    expect(() =>
      assertMetadataOnlyPayload({
        kind: "upgrade-notify",
        actorUserId: "u1",
        version: "v1.2.3"
      })
    ).not.toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      assertMetadataOnlyPayload({ actorUserId: "u1", privateContent: "text" })
    ).toThrow();
  });
});
