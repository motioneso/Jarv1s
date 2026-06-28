import { describe, it, expect, vi } from "vitest";
import { extractCommitmentsFromText } from "@jarv1s/commitments/extractor";

describe("extractCommitmentsFromText", () => {
  it("returns empty array for text that fails prefilter", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ text: '{"candidates":[]}' });
    const result = await extractCommitmentsFromText(mockGenerate, "Sounds good, thanks!", "chat", "2026-06-28T10:00:00Z");
    expect(result).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("calls AI and parses valid response", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          {
            kind: "deadline",
            title: "Send the report",
            dueLocalDate: "2026-07-01",
            counterpartyLabel: "Alice",
            evidenceExcerpt: "I need to send the report to Alice by July 1st",
            confidence: "high"
          }
        ]
      })
    });
    const result = await extractCommitmentsFromText(
      mockGenerate,
      "I need to send the report to Alice by July 1st",
      "chat",
      "2026-06-28T10:00:00Z"
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("deadline");
    expect(result[0]!.title).toBe("Send the report");
  });

  it("returns empty array on malformed AI response", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ text: "not json" });
    const result = await extractCommitmentsFromText(mockGenerate, "I need to submit by tomorrow", "chat", "2026-06-28T10:00:00Z");
    expect(result).toEqual([]);
  });

  it("returns empty array when AI throws", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API error"));
    const result = await extractCommitmentsFromText(mockGenerate, "I need to submit by tomorrow", "chat", "2026-06-28T10:00:00Z");
    expect(result).toEqual([]);
  });
});
