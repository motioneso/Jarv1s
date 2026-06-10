import { describe, expect, it } from "vitest";
import { applyRecencyDecay, hybridScore, renderMemorySeedBlock } from "@jarv1s/chat";

describe("hybridScore", () => {
  it("returns 0 when both sim and rec are 0", () => {
    expect(hybridScore(0, 0)).toBe(0);
  });

  it("weights similarity at 0.6 and recency at 0.25", () => {
    const score = hybridScore(1.0, 1.0);
    expect(score).toBeCloseTo(0.6 * 1.0 + 0.25 * 1.0, 5);
  });

  it("decays recency exponentially — 14 days ≈ half-life", () => {
    const decay14 = applyRecencyDecay(14);
    expect(decay14).toBeCloseTo(0.5, 1);
  });
});

describe("renderMemorySeedBlock", () => {
  it("returns empty string when no chunks and no facts", () => {
    expect(renderMemorySeedBlock([], [])).toBe("");
  });

  it("renders episodic chunks with provenance", () => {
    const result = renderMemorySeedBlock(
      [
        {
          text: "User mentioned TypeScript preference",
          date: "2026-05-01",
          threadId: "abc123",
          hybridScore: 0.9
        }
      ],
      []
    );
    expect(result).toContain("<memory>");
    expect(result).toContain("</memory>");
    expect(result).toContain("2026-05-01");
    expect(result).toContain("TypeScript preference");
  });

  it("renders facts section when facts are present", () => {
    const result = renderMemorySeedBlock(
      [],
      [{ category: "preference", content: "Prefers TypeScript" }]
    );
    expect(result).toContain("Prefers TypeScript");
    expect(result).toContain("<memory>");
  });

  it("renders both chunks and facts when both are present", () => {
    const result = renderMemorySeedBlock(
      [{ text: "Discussed React", date: "2026-06-01", threadId: "t1", hybridScore: 0.8 }],
      [{ category: "profile", content: "Senior engineer" }]
    );
    expect(result).toContain("Discussed React");
    expect(result).toContain("Senior engineer");
    expect(result).toContain("<memory>");
    expect(result).toContain("</memory>");
  });
});
