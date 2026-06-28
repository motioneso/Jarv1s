import { describe, it, expect } from "vitest";
import { CommitmentsRepository } from "@jarv1s/commitments";

describe("CommitmentsRepository", () => {
  it("exports CommitmentsRepository with expected methods", () => {
    const repo = new CommitmentsRepository();
    expect(typeof repo.upsertCandidate).toBe("function");
    expect(typeof repo.addEvidenceRow).toBe("function");
    expect(typeof repo.listCandidates).toBe("function");
    expect(typeof repo.getCandidate).toBe("function");
    expect(typeof repo.updateStatus).toBe("function");
    expect(typeof repo.setResolutionRef).toBe("function");
    expect(typeof repo.getEvidenceForCandidate).toBe("function");
    expect(typeof repo.getExtractionState).toBe("function");
    expect(typeof repo.upsertExtractionState).toBe("function");
  });
});
