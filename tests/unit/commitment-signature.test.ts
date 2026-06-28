import { describe, it, expect } from "vitest";
import { buildCandidateSignature } from "@jarv1s/commitments/signature";

describe("buildCandidateSignature", () => {
  it("produces deterministic signature for same inputs", () => {
    const s1 = buildCandidateSignature({ kind: "deadline", counterpartyLabel: "Alice", title: "Send Report", dueLocalDate: "2026-07-01", sourceKind: "chat", sourceRef: "msg-123" });
    const s2 = buildCandidateSignature({ kind: "deadline", counterpartyLabel: "Alice", title: "Send Report", dueLocalDate: "2026-07-01", sourceKind: "chat", sourceRef: "msg-123" });
    expect(s1).toBe(s2);
  });

  it("normalizes title case and whitespace", () => {
    const s1 = buildCandidateSignature({ kind: "deadline", counterpartyLabel: null, title: "Send  Report", dueLocalDate: null, sourceKind: "chat", sourceRef: "ref-1" });
    const s2 = buildCandidateSignature({ kind: "deadline", counterpartyLabel: null, title: "send report", dueLocalDate: null, sourceKind: "chat", sourceRef: "ref-1" });
    expect(s1).toBe(s2);
  });

  it("differs for different kinds", () => {
    const s1 = buildCandidateSignature({ kind: "deadline", counterpartyLabel: null, title: "finish project", dueLocalDate: null, sourceKind: "chat", sourceRef: "r" });
    const s2 = buildCandidateSignature({ kind: "promise", counterpartyLabel: null, title: "finish project", dueLocalDate: null, sourceKind: "chat", sourceRef: "r" });
    expect(s1).not.toBe(s2);
  });
});
