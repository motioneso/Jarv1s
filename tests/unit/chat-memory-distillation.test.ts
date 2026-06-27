import { describe, expect, it } from "vitest";

import {
  buildDistillationPrompt,
  decideCandidatePromotion,
  parseMemoryCandidates,
  shouldDistillTurn
} from "@jarv1s/chat";
import { createMemoryCandidateSignature } from "@jarv1s/memory";

describe("chat memory distillation helpers", () => {
  it("skips social chatter", () => {
    expect(shouldDistillTurn("hi", "hello")).toBe(false);
    expect(shouldDistillTurn("thanks, that helps", "anytime")).toBe(false);
  });

  it("triggers on explicit memory, preference, decision, and correction phrases", () => {
    expect(shouldDistillTurn("Remember that I prefer brief answers.", "Noted.")).toBe(true);
    expect(shouldDistillTurn("I hate morning meetings.", "Got it.")).toBe(true);
    expect(shouldDistillTurn("We decided to go with Postgres.", "Okay.")).toBe(true);
    expect(shouldDistillTurn("Actually, not Apollo, use Hermes.", "Updated.")).toBe(true);
  });

  it("triggers on long concrete action/date text", () => {
    const text =
      "Project Atlas status update for June 27: I approved the memory distillation lane, " +
      "need to finish the candidate store before tomorrow, and the deadline remains Friday. " +
      "This should become durable project context for later planning and review.";

    expect(shouldDistillTurn(text, "Recorded.")).toBe(true);
  });

  it("rejects non-json and invalid candidate shapes", () => {
    expect(parseMemoryCandidates("not json")).toEqual([]);
    expect(parseMemoryCandidates(JSON.stringify([{ kind: "fact", action: "create" }]))).toEqual([]);
  });

  it("parses valid candidates and clamps scores", () => {
    const parsed = parseMemoryCandidates(
      JSON.stringify([
        {
          kind: "fact",
          action: "create",
          fact: {
            subject: "Ben",
            predicate: "prefers",
            objectText: "brief updates"
          },
          provenance: "volunteered",
          confidence: 2,
          importance: -1,
          sourceExcerpt: "I prefer brief updates.",
          rationale: "User directly stated preference.",
          isSensitive: false
        }
      ])
    );

    expect(parsed).toEqual([
      expect.objectContaining({
        kind: "fact",
        action: "create",
        confidence: 1,
        importance: 0,
        provenance: "volunteered"
      })
    ]);
  });

  it("normalizes candidate signatures", () => {
    const a = createMemoryCandidateSignature({
      kind: "fact",
      action: "create",
      fact: { subject: " Ben ", predicate: "prefers", objectText: "Brief   Updates" }
    });
    const b = createMemoryCandidateSignature({
      kind: "fact",
      action: "create",
      fact: { subject: "ben", predicate: "prefers", objectText: "brief updates" }
    });

    expect(a).toBe(b);
  });

  it("keeps risky candidates pending and promotes clear volunteered facts", () => {
    const base = {
      kind: "fact" as const,
      action: "create" as const,
      fact: { subject: "Ben", predicate: "prefers" as const, objectText: "brief updates" },
      sourceExcerpt: "remember that I prefer brief updates",
      rationale: "User explicitly asked to remember it",
      importance: 0.8
    };

    expect(
      decideCandidatePromotion({
        candidate: {
          ...base,
          provenance: "volunteered",
          confidence: 0.7,
          isSensitive: false
        },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      })
    ).toEqual({ status: "promote", reason: "explicit_memory_command" });

    expect(
      decideCandidatePromotion({
        candidate: { ...base, provenance: "inferred", confidence: 0.99, isSensitive: false },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      }).status
    ).toBe("pending");

    expect(
      decideCandidatePromotion({
        candidate: {
          ...base,
          fact: { subject: "Ben", predicate: "owes", objectText: "Alex a follow up" },
          provenance: "volunteered",
          confidence: 0.99,
          isSensitive: false
        },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      }).status
    ).toBe("pending");
  });

  it("builds a prompt that excludes secrets and asks for json only", () => {
    const prompt = buildDistillationPrompt({
      userText: "remember my project",
      assistantText: "noted",
      activeMemory: [],
      threadTitle: "Memory test"
    });

    expect(prompt).toContain("Return ONLY JSON");
    expect(prompt).toContain("passwords");
    expect(prompt).toContain("OAuth");
    expect(prompt).not.toContain("api-key");
  });
});
