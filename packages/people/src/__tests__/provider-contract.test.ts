import { expect, it } from "vitest";
import type { PersonContextProvider, PersonContextSignal } from "@jarv1s/module-sdk";

it("PersonContextProvider type is exported from module-sdk", () => {
  const _: PersonContextProvider = {
    sourceKind: "email",
    collectPersonSignals: async (_input) => ({ signals: [] }),
  };
  expect(_).toBeDefined();
});

it("PersonContextSignal shape is correct", () => {
  const s: PersonContextSignal = {
    identityKind: "email_address",
    displayValue: "Alice <alice@example.com>",
    normalizedValue: "alice@example.com",
    sourceRef: "msg:abc123",
    sourceRefHash: "deadbeef",
    sourceVersion: "1",
    linkKind: "sender",
    confidence: 0.95,
    provenance: "source",
  };
  expect(s.identityKind).toBe("email_address");
});
