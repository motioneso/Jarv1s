import { expect, it } from "vitest";
import type { Person, PersonIdentity, PersonLink, MatchCandidate } from "../types.js";

it("domain types are importable", () => {
  const p: Pick<Person, "id" | "displayName" | "status"> = {
    id: "uuid",
    displayName: "Alice",
    status: "active"
  };
  expect(p.displayName).toBe("Alice");
});

it("PersonIdentity omits normalizedValue and sourceRef", () => {
  const identity: PersonIdentity = {
    id: "iid",
    ownerUserId: "u1",
    personId: null,
    identityKind: "email_address",
    sourceKind: "email",
    displayValue: "alice@example.com",
    sourceRefHash: null,
    status: "active",
    confidence: 0.9,
    provenance: "source",
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  expect(identity.displayValue).toBe("alice@example.com");
  // Type check: if normalizedValue were present, this would be a TS compile error
  expect("normalizedValue" in identity).toBe(false);
  expect("sourceRef" in identity).toBe(false);
});

it("PersonLink omits sourceRef", () => {
  const link: PersonLink = {
    id: "lid",
    ownerUserId: "u1",
    personId: "pid",
    sourceKind: "email",
    sourceRefHash: "deadbeef",
    sourceLabel: null,
    linkKind: "sender",
    summary: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    confidence: 0.8,
    provenance: "source",
    createdAt: new Date(),
    updatedAt: new Date()
  };
  expect(link.sourceRefHash).toBe("deadbeef");
  expect("sourceRef" in link).toBe(false);
});

it("MatchCandidate shape is correct", () => {
  const mc: MatchCandidate = {
    id: "mcid",
    ownerUserId: "u1",
    candidateKind: "link_identity",
    status: "pending",
    primaryPersonId: null,
    secondaryPersonId: null,
    identityId: null,
    suggestedDisplayName: null,
    reasonSummary: null,
    confidence: 0.7,
    candidateSignature: "abc123",
    createdAt: new Date(),
    updatedAt: new Date()
  };
  expect(mc.candidateKind).toBe("link_identity");
});
