import { describe, it, expect } from "vitest";
import { registerCommitmentExtractionWorker } from "@jarv1s/commitments/workers";
import { enqueueCommitmentExtraction } from "@jarv1s/commitments/jobs";

describe("commitment worker exports", () => {
  it("exports registerCommitmentExtractionWorker", () => {
    expect(typeof registerCommitmentExtractionWorker).toBe("function");
  });

  it("exports enqueueCommitmentExtraction", () => {
    expect(typeof enqueueCommitmentExtraction).toBe("function");
  });
});
